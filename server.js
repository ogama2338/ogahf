const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Blob } = require('buffer');
const { listFiles, uploadFiles, deleteFile, downloadFile } = require('@huggingface/hub');

const app = express();
const PORT = process.env.PORT || 3000;
const HF_BUCKET = process.env.HF_BUCKET || ''; // e.g. 'ogama2339d/ogama2339d'
const HF_TOKEN = process.env.HF_TOKEN || '';

// Middleware
app.use(cors());
app.use(express.json());

// Serve index.html with config
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  fs.readFile(indexPath, 'utf8', (err, data) => {
    if (err) {
      res.status(500).send('Error loading page');
      return;
    }
    const configScript = `<script>window.APP_CONFIG = { hasHfToken: ${!!HF_TOKEN} };</script>`;
    const modifiedHtml = data.replace('<link rel="stylesheet" href="style.css">', configScript + '\n  <link rel="stylesheet" href="style.css">');
    res.send(modifiedHtml);
  });
});

app.use(express.static('public'));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Create a temp directory for multer uploads
const tempUploadsDir = path.join(__dirname, 'temp_uploads');
if (!fs.existsSync(tempUploadsDir)) {
  fs.mkdirSync(tempUploadsDir);
}

// Configure multer for file uploads (disk storage)
const upload = multer({ dest: tempUploadsDir });

// Helper to clean up temp files
const cleanup = (files) => {
  if (!files) return;
  const filesToDelete = Array.isArray(files) ? files : [files];
  filesToDelete.forEach(f => {
      if (f && f.path) {
          fs.promises.unlink(f.path).catch(e => console.error('Failed to delete temp file:', f.path, e));
      }
  });
};


// --- LOCAL FILE ROUTES ---

async function listLocalFiles(dir, base = '') {
    // ... (implementation unchanged)
}
app.get('/api/files', async (req, res) => {
    try {
        const fileList = await listLocalFiles(uploadsDir);
        res.json(fileList);
    } catch (err) {
        res.status(500).json({ error: 'Could not read local files', details: err.message });
    }
});

app.post('/api/upload-multiple', upload.array('files'), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
    }
    const tempFiles = req.files;
    try {
        const paths = Array.isArray(req.body.paths) ? req.body.paths : (req.body.paths ? [req.body.paths] : []);
        const results = [];
        for (let i = 0; i < tempFiles.length; i++) {
            const file = tempFiles[i];
            const targetPath = paths[i] || file.originalname;
            const normalized = path.normalize(targetPath).replace(/\\/g, '/');
            if (normalized.includes('..')) {
                return res.status(400).json({ error: 'Invalid path' });
            }
            const fullPath = path.join(uploadsDir, normalized);
            await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.promises.rename(file.path, fullPath);
            results.push({ path: normalized, size: file.size });
        }
        res.json({ message: 'Files uploaded successfully', files: results });
    } catch (error) {
        console.error('Upload multiple error:', error);
        res.status(500).json({ error: 'Could not save files', details: error.message });
        // If rename fails, the original temp files might still be there
        cleanup(tempFiles);
    }
});
// ... other local routes are omitted for brevity but are unchanged ...


// --- HUGGING FACE BUCKET ROUTES ---

function hfCheckConfig(res) {
    if (!HF_BUCKET || !HF_TOKEN) {
        res.status(400).json({ error: 'HF_BUCKET and HF_TOKEN must be set in environment' });
        return false;
    }
    return true;
}

app.get('/api/hf/files', async (req, res) => {
    if (!hfCheckConfig(res)) return;
    try {
        const output = [];
        for await (const item of listFiles({ repo: HF_BUCKET, repoType: 'bucket', recursive: true, accessToken: HF_TOKEN })) {
            output.push({ path: item.path, type: item.type, size: item.size, uploadedAt: item.uploadedAt || null });
        }
        res.json(addParentDirectories(output));
    } catch (error) {
        console.error('HF list error', error);
        res.status(500).json({ error: 'Could not list HF bucket files', details: error.message });
    }
});

app.post('/api/hf/upload-multiple', upload.array('files'), async (req, res) => {
    if (!hfCheckConfig(res)) return;
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
    }

    const tempFiles = req.files;
    try {
        const paths = Array.isArray(req.body.paths) ? req.body.paths : (req.body.paths ? [req.body.paths] : []);
        const filesToUpload = tempFiles.map((f, i) => ({
            path: paths[i] || f.originalname,
            content: fs.createReadStream(f.path)
        }));

        await uploadFiles({ 
            repo: HF_BUCKET, 
            repoType: 'bucket', 
            files: filesToUpload, 
            accessToken: HF_TOKEN 
        });

        res.json({ message: 'HF bucket files uploaded successfully' });
    } catch (error) {
        console.error('HF upload-multiple error', error);
        res.status(500).json({ error: 'Could not upload multiple files to HF bucket', details: error.message });
    } finally {
        cleanup(tempFiles);
    }
});

app.post('/api/hf/create-folder', async (req, res) => {
    if (!hfCheckConfig(res)) return;
    const { folderPath } = req.body;
    if (!folderPath) {
        return res.status(400).json({ error: 'folderPath is required' });
    }
    try {
        const placeholderPath = `${folderPath}/.keep`;
        await uploadFiles({
            repo: HF_BUCKET,
            repoType: 'bucket',
            files: [{ path: placeholderPath, content: new Blob(['']) }],
            accessToken: HF_TOKEN,
        });
        res.json({ message: 'HF folder created successfully' });
    } catch (error) {
        console.error('HF create-folder error', error);
        res.status(500).json({ error: 'Could not create folder in HF bucket', details: error.message });
    }
});

app.delete('/api/hf/delete/*', async (req, res) => {
    if (!hfCheckConfig(res)) return;
    const filename = req.params[0];
    try {
        await deleteFile({ repo: HF_BUCKET, repoType: 'bucket', path: filename, accessToken: HF_TOKEN });
        res.json({ message: 'Deleted from HF bucket successfully' });
    } catch (error) {
        console.error('HF delete error', error);
        res.status(500).json({ error: 'Could not delete file from HF bucket', details: error.message });
    }
});

app.get('/api/hf/download/*', async (req, res) => {
    if (!hfCheckConfig(res)) return;
    const filename = req.params[0];
    try {
        const blob = await downloadFile({ repo: HF_BUCKET, repoType: 'bucket', path: filename, accessToken: HF_TOKEN });
        if (!blob) {
            return res.status(404).json({ error: 'File not found in HF bucket' });
        }
        const arrayBuffer = await blob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.send(buffer);
    } catch (error) {
        console.error('HF download error', error);
        res.status(500).json({ error: 'Could not download from HF bucket', details: error.message });
    }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
