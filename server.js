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

// Configure multer for file uploads (memory storage)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Routes

// Upload file
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({
    message: 'File uploaded successfully',
    file: {
      originalName: req.file.originalname,
      filename: req.file.filename,
      size: req.file.size
    }
  });
});

// List all files (recursive)
function addParentDirectories(items) {
  const dirs = new Set(items.filter((i) => i.type === 'directory').map((i) => i.path));
  const files = items.filter((i) => i.type === 'file');

  files.forEach((file) => {
    const parts = file.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!dirs.has(dir)) {
        dirs.add(dir);
        items.push({ path: dir, type: 'directory', size: 0, updatedAt: file.updatedAt || null });
      }
    }
  });

  return items;
}

async function listLocalFiles(dir, base = '') {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const result = [];

  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dir, entry.name);
    const relativePath = path.join(base, entry.name);

    // Skip .keep files (placeholders for empty folders)
    if (entry.name === '.keep') return;

    if (entry.isDirectory()) {
      result.push({ path: relativePath, type: 'directory', size: 0, updatedAt: (await fs.promises.stat(entryPath)).mtime.toISOString() });
      const inner = await listLocalFiles(entryPath, relativePath);
      result.push(...inner);
    } else if (entry.isFile()) {
      const stats = await fs.promises.stat(entryPath);
      result.push({ path: relativePath, type: 'file', size: stats.size, updatedAt: stats.mtime.toISOString() });
    }
  }));

  return addParentDirectories(result);
}

app.get('/api/files', async (req, res) => {
  try {
    const fileList = await listLocalFiles(uploadsDir);
    res.json(fileList);
  } catch (err) {
    res.status(500).json({ error: 'Could not read local files', details: err.message });
  }
});

// Download file
app.get('/api/download/*', (req, res) => {
  const filename = req.params[0];
  const filepath = path.join(uploadsDir, filename);

  // Security: prevent directory traversal
  if (!filepath.startsWith(uploadsDir)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.download(filepath, (err) => {
    if (err && err.code !== 'ERR_HTTP_HEADERS_SENT') {
      res.status(500).json({ error: 'Download failed' });
    }
  });
});

// Delete file or folder
app.delete('/api/delete/*', async (req, res) => {
  const filename = req.params[0];
  const filepath = path.join(uploadsDir, filename);

  // Security: prevent directory traversal
  if (!filepath.startsWith(uploadsDir)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const stats = await fs.promises.stat(filepath);
    if (stats.isDirectory()) {
      // Delete directory recursively
      await fs.promises.rm(filepath, { recursive: true, force: true });
    } else {
      // Delete file
      await fs.promises.unlink(filepath);
    }
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Could not delete file/folder' });
  }
});

// Delete multiple files (local)
app.post('/api/delete-multiple', async (req, res) => {
  const filenames = req.body.filenames;
  if (!Array.isArray(filenames)) {
    return res.status(400).json({ error: 'filenames must be an array' });
  }
  try {
    await Promise.all(
      filenames.map(async (filename) => {
        const filepath = path.join(uploadsDir, filename);
        if (!filepath.startsWith(uploadsDir)) throw new Error('Access denied');
        await fs.promises.unlink(filepath);
      })
    );
    res.json({ message: 'Files deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Could not delete files', details: error.message });
  }
});

// Rename local file
app.post('/api/rename', async (req, res) => {
  const { oldPath, newPath } = req.body;
  if (!oldPath || !newPath) {
    return res.status(400).json({ error: 'oldPath and newPath are required' });
  }
  const src = path.join(uploadsDir, oldPath);
  const dest = path.join(uploadsDir, newPath);
  if (!src.startsWith(uploadsDir) || !dest.startsWith(uploadsDir)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.rename(src, dest);
    res.json({ message: 'Renamed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Could not rename file', details: error.message });
  }
});

// Upload multiple files locally (folder upload)
app.post('/api/upload-multiple', upload.array('files'), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const paths = Array.isArray(req.body.paths) ? req.body.paths : (req.body.paths ? [req.body.paths] : []);

  try {
    const results = [];

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const targetPath = paths[i] || file.originalname;
      const normalized = path.normalize(targetPath).replace(/\\/g, '/');

      if (normalized.includes('..')) {
        return res.status(400).json({ error: 'Invalid path' });
      }

      const fullPath = path.join(uploadsDir, normalized);
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.promises.writeFile(fullPath, file.buffer);

      results.push({ path: normalized, size: file.size });
    }

    res.json({ message: 'Files uploaded successfully', files: results });
  } catch (error) {
    console.error('Upload multiple error:', error);
    res.status(500).json({ error: 'Could not save files', details: error.message });
  }
});

// Create folder locally
app.post('/api/create-folder', async (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath) {
    return res.status(400).json({ error: 'folderPath is required' });
  }
  const fullPath = path.join(uploadsDir, folderPath);
  if (!fullPath.startsWith(uploadsDir)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    await fs.promises.mkdir(fullPath, { recursive: true });
    res.json({ message: 'Folder created successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Could not create folder', details: error.message });
  }
});

// Move files locally
app.post('/api/move', async (req, res) => {
  const { files, destination } = req.body;
  if (!Array.isArray(files) || !destination) {
    return res.status(400).json({ error: 'files array and destination are required' });
  }
  try {
    await Promise.all(
      files.map(async (filePath) => {
        const src = path.join(uploadsDir, filePath);
        const dest = path.join(uploadsDir, destination, path.basename(filePath));
        if (!src.startsWith(uploadsDir) || !dest.startsWith(uploadsDir)) throw new Error('Access denied');
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        await fs.promises.rename(src, dest);
      })
    );
    res.json({ message: 'Files moved successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Could not move files', details: error.message });
  }
});

// Hugging Face Bucket routes
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
    for await (const item of listFiles({ repo: `buckets/${HF_BUCKET}`, recursive: true, accessToken: HF_TOKEN })) {
      output.push({
        path: item.path,
        type: item.type,
        size: item.size,
        uploadedAt: item.uploadedAt || null,
      });
    }
    res.json(addParentDirectories(output));
  } catch (error) {
    console.error('HF list error', error);
    res.status(500).json({ error: 'Could not list HF bucket files' });
  }
});

app.post('/api/hf/upload', upload.single('file'), async (req, res) => {
  if (!hfCheckConfig(res)) return;
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const blob = new Blob([req.file.buffer]);
    await uploadFiles({
      repo: `buckets/${HF_BUCKET}`,
      files: [{ path: req.file.originalname, content: blob }],
      accessToken: HF_TOKEN,
      useXet: true,
    });

    res.json({ message: 'Uploaded to HF bucket successfully', key: req.file.originalname });
  } catch (error) {
    console.error('HF upload error', error);
    res.status(500).json({ error: 'Could not upload to HF bucket' });
  }
});

app.get('/api/hf/download/*', async (req, res) => {
  if (!hfCheckConfig(res)) return;
  const filename = req.params[0];

  try {
    const blob = await downloadFile({ repo: `buckets/${HF_BUCKET}`, path: filename, accessToken: HF_TOKEN });
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
    res.status(500).json({ error: 'Could not download from HF bucket' });
  }
});

app.get('/api/hf/public-url/*', (req, res) => {
  if (!hfCheckConfig(res)) return;
  const filename = req.params[0];
  if (!filename) {
    return res.status(400).json({ error: 'Filename required' });
  }

  const baseUrl = `https://huggingface.co/buckets/${HF_BUCKET}/resolve/main/${encodeURIComponent(filename)}`;
  const tokenUrl = HF_TOKEN ? `${baseUrl}?token=${encodeURIComponent(HF_TOKEN)}` : baseUrl;
  const proxyUrl = `${req.protocol}://${req.get('host')}/api/hf/download/${encodeURIComponent(filename)}`;

  res.json({ url: tokenUrl, proxyUrl });
});

app.delete('/api/hf/delete/*', async (req, res) => {
  if (!hfCheckConfig(res)) return;
  const filename = req.params[0];
  try {
    await deleteFile({ repo: `buckets/${HF_BUCKET}`, path: filename, accessToken: HF_TOKEN });
    res.json({ message: 'Deleted from HF bucket successfully' });
  } catch (error) {
    console.error('HF delete error', error);
    res.status(500).json({ error: 'Could not delete file from HF bucket' });
  }
});

app.post('/api/hf/delete-multiple', async (req, res) => {
  if (!hfCheckConfig(res)) return;
  const filenames = req.body.filenames;
  if (!Array.isArray(filenames)) {
    return res.status(400).json({ error: 'filenames must be an array' });
  }
  try {
    await Promise.all(
      filenames.map((filename) =>
        deleteFile({ repo: `buckets/${HF_BUCKET}`, path: filename, accessToken: HF_TOKEN })
      )
    );
    res.json({ message: 'HF files deleted successfully' });
  } catch (error) {
    console.error('HF delete-multiple error', error);
    res.status(500).json({ error: 'Could not delete files from HF bucket' });
  }
});

app.post('/api/hf/rename', async (req, res) => {
  if (!hfCheckConfig(res)) return;
  const { oldPath, newPath } = req.body;
  if (!oldPath || !newPath) {
    return res.status(400).json({ error: 'oldPath and newPath are required' });
  }
  try {
    const blob = await downloadFile({ repo: `buckets/${HF_BUCKET}`, path: oldPath, accessToken: HF_TOKEN });
    if (!blob) {
      return res.status(404).json({ error: 'Source file not found in HF bucket' });
    }
    await uploadFiles({
      repo: `buckets/${HF_BUCKET}`,
      files: [{ path: newPath, content: blob }],
      accessToken: HF_TOKEN,
      useXet: true,
    });
    await deleteFile({ repo: `buckets/${HF_BUCKET}`, path: oldPath, accessToken: HF_TOKEN });
    res.json({ message: 'HF file renamed successfully' });
  } catch (error) {
    console.error('HF rename error', error);
    res.status(500).json({ error: 'Could not rename file in HF bucket' });
  }
});

app.post('/api/hf/upload-multiple', upload.array('files'), async (req, res) => {
  if (!hfCheckConfig(res)) return;
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const paths = Array.isArray(req.body.paths) ? req.body.paths : (req.body.paths ? [req.body.paths] : []);

  try {
    const filesToUpload = req.files.map((f, i) => {
      const targetPath = paths[i] || f.originalname;
      return { path: targetPath, content: new Blob([f.buffer]) };
    });

    await uploadFiles({ repo: `buckets/${HF_BUCKET}`, files: filesToUpload, accessToken: HF_TOKEN, useXet: true });
    res.json({ message: 'HF bucket files uploaded successfully' });
  } catch (error) {
    console.error('HF upload-multiple error', error);
    res.status(500).json({ error: 'Could not upload multiple files to HF bucket' });
  }
});

app.post('/api/hf/create-folder', async (req, res) => {
  if (!hfCheckConfig(res)) return;
  const { folderPath } = req.body;
  if (!folderPath) {
    return res.status(400).json({ error: 'folderPath is required' });
  }
  // For HF buckets, folders are implicit, so just create a dummy file to ensure the path exists, then delete it
  try {
    await uploadFiles({
      repo: `buckets/${HF_BUCKET}`,
      files: [{ path: `${folderPath}/.keep`, content: new Blob(['']) }],
      accessToken: HF_TOKEN,
      useXet: true,
    });
    await deleteFile({ repo: `buckets/${HF_BUCKET}`, path: `${folderPath}/.keep`, accessToken: HF_TOKEN });
    res.json({ message: 'HF folder created successfully' });
  } catch (error) {
    console.error('HF create-folder error', error);
    res.status(500).json({ error: 'Could not create folder in HF bucket' });
  }
});

app.post('/api/hf/move', async (req, res) => {
  if (!hfCheckConfig(res)) return;
  const { files, destination } = req.body;
  if (!Array.isArray(files) || !destination) {
    return res.status(400).json({ error: 'files array and destination are required' });
  }
  try {
    await Promise.all(
      files.map(async (filePath) => {
        const blob = await downloadFile({ repo: `buckets/${HF_BUCKET}`, path: filePath, accessToken: HF_TOKEN });
        if (!blob) throw new Error(`File ${filePath} not found`);
        const newPath = `${destination}/${path.basename(filePath)}`;
        await uploadFiles({
          repo: `buckets/${HF_BUCKET}`,
          files: [{ path: newPath, content: blob }],
          accessToken: HF_TOKEN,
          useXet: true,
        });
        await deleteFile({ repo: `buckets/${HF_BUCKET}`, path: filePath, accessToken: HF_TOKEN });
      })
    );
    res.json({ message: 'HF files moved successfully' });
  } catch (error) {
    console.error('HF move error', error);
    res.status(500).json({ error: 'Could not move files in HF bucket' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});