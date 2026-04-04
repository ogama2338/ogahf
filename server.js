const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url'); 
const { listFiles, uploadFiles, deleteFile, downloadFile } = require('@huggingface/hub');

const app = express();
const PORT = process.env.PORT || 3000;
const HF_BUCKET = process.env.HF_BUCKET || ''; 
const HF_TOKEN = process.env.HF_TOKEN || '';

// --- CORE MIDDLEWARE & SETUP ---
app.use(cors());

app.use(express.json({ limit: '1000mb' }));
app.use(express.urlencoded({ limit: '1000mb', extended: true }));
app.use(express.static('public'));

const uploadsDir = path.join(__dirname, 'uploads');
const tempUploadsDir = path.join(__dirname, 'temp_uploads');
[uploadsDir, tempUploadsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const upload = multer({ 
  dest: tempUploadsDir,
  limits: { fileSize: 2000 * 1024 * 1024 } 
});

// --- HELPERS ---
const cleanup = (files) => {
  const filesToDelete = Array.isArray(files) ? files : [files];
  filesToDelete.forEach(f => {
    if (f && f.path) {
      fs.promises.unlink(f.path).catch(e => console.error('Failed to delete temp file:', f.path, e));
    }
  });
};

function addParentDirectories(items) {
    const pathMap = new Map();
    items.forEach(item => pathMap.set(item.path, item));

    items.forEach(item => {
        const parts = item.path.split('/');
        let currentPath = '';
        for (let i = 0; i < parts.length - 1; i++) {
            currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
            if (!pathMap.has(currentPath)) {
                pathMap.set(currentPath, {
                    path: currentPath,
                    type: 'directory',
                    size: 0,
                    updatedAt: item.updatedAt || new Date().toISOString()
                });
            }
        }
    });
    return Array.from(pathMap.values());
}

function hfCheckConfig(res) {
  if (!HF_BUCKET || !HF_TOKEN) {
    res.status(400).json({ error: 'Server is not configured. Missing HF_BUCKET or HF_TOKEN in Render Environment.' });
    return false;
  }
  return true;
}

// --- SERVER ROUTES ---

app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  fs.readFile(indexPath, 'utf8', (err, data) => {
    if (err) return res.status(500).send('Error loading page');
    const configScript = `<script>window.APP_CONFIG = { hasHfToken: ${!!HF_TOKEN} };</script>`;
    const finalHtml = data.replace('<link rel="stylesheet" href="style.css">', `${configScript}\n<link rel="stylesheet" href="style.css">`);
    res.send(finalHtml);
  });
});

// --- HUGGING FACE BUCKET ROUTES ---

app.get('/api/hf/files', async (req, res) => {
  if (!hfCheckConfig(res)) return;
  try {
    const output = [];
    for await (const item of listFiles({ repo: `buckets/${HF_BUCKET}`, repoType: 'bucket', recursive: true, accessToken: HF_TOKEN })) {
      output.push({ path: item.path, type: item.type, size: item.size, updatedAt: item.updatedAt || null });
    }
    res.json(addParentDirectories(output));
  } catch (error) {
    res.status(500).json({ error: 'Could not list HF bucket files', details: error.message });
  }
});

app.post('/api/hf/upload-multiple', upload.array('files'), async (req, res) => {
  if (!hfCheckConfig(res)) return;
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  const tempFiles = req.files;
  try {
    const paths = req.body.paths ? (Array.isArray(req.body.paths) ? req.body.paths : [req.body.paths]) : [];
    
    const filesToUpload = tempFiles.map((f, i) => {
        return {
            path: paths[i] || f.originalname,
            content: pathToFileURL(f.path) 
        };
    });

    // FIX: Removed useXet: false
    await uploadFiles({ 
      repo: `buckets/${HF_BUCKET}`, 
      repoType: 'bucket', 
      files: filesToUpload, 
      accessToken: HF_TOKEN 
    });
    
    res.json({ message: 'HF bucket files uploaded successfully' });
  } catch (error) {
    console.error('HF upload-multiple error:', error);
    res.status(500).json({ error: error.message || 'Could not upload multiple files to HF bucket' });
  } finally {
    cleanup(tempFiles);
  }
});

app.post('/api/hf/create-folder', async (req, res) => {
  if (!hfCheckConfig(res)) return;
  const { folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: 'folderPath is required' });

  try {
    await uploadFiles({
      repo: `buckets/${HF_BUCKET}`,
      repoType: 'bucket',
      files: [{ path: `${folderPath}/.keep`, content: new Blob(['']) }],
      accessToken: HF_TOKEN,
    });
    res.json({ message: 'HF folder created successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Could not create folder in HF bucket', details: error.message });
  }
});

app.delete('/api/hf/delete/*', async (req, res) => {
  if (!hfCheckConfig(res)) return;
  const filePath = req.params[0];
  try {
    await deleteFile({ repo: `buckets/${HF_BUCKET}`, repoType: 'bucket', path: filePath, accessToken: HF_TOKEN });
    res.json({ message: 'Deleted from HF bucket successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Could not delete file from HF bucket', details: error.message });
  }
});

app.get('/api/hf/download/*', async (req, res) => {
  if (!hfCheckConfig(res)) return;
  const filePath = req.params[0];
  try {
    const blob = await downloadFile({ repo: `buckets/${HF_BUCKET}`, repoType: 'bucket', path: filePath, accessToken: HF_TOKEN });
    if (!blob) return res.status(404).json({ error: 'File not found in HF bucket' });

    const buffer = Buffer.from(await blob.arrayBuffer());
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: 'Could not download from HF bucket', details: error.message });
  }
});

// --- SERVER START ---
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});