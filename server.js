const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url'); 
const { Readable } = require('stream'); 
const { listFiles, uploadFiles, deleteFile, downloadFile } = require('@huggingface/hub');

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_HF_BUCKET = process.env.HF_BUCKET || ''; 
const AVAILABLE_BUCKETS = process.env.AVAILABLE_BUCKETS || ''; // Allows setting a list of buckets in Render
const HF_TOKEN = process.env.HF_TOKEN || '';

app.use(cors());
app.use(express.json({ limit: '1000mb' }));
app.use(express.urlencoded({ limit: '1000mb', extended: true }));
app.use(express.static('public'));

const uploadsDir = path.join(__dirname, 'uploads');
const tempUploadsDir = path.join(__dirname, 'temp_uploads');
[uploadsDir, tempUploadsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const upload = multer({ dest: tempUploadsDir, limits: { fileSize: 2000 * 1024 * 1024 } });

const cleanup = (files) => {
  const filesToDelete = Array.isArray(files) ? files : [files];
  filesToDelete.forEach(f => {
    if (f && f.path) fs.promises.unlink(f.path).catch(e => console.error('Failed to delete temp file:', f.path));
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
                pathMap.set(currentPath, { path: currentPath, type: 'directory', size: 0, updatedAt: item.updatedAt || new Date().toISOString() });
            }
        }
    });
    return Array.from(pathMap.values());
}

function getHfBucket(req) {
  return req.query.bucket || DEFAULT_HF_BUCKET;
}

function hfCheckConfig(req, res) {
  const targetBucket = getHfBucket(req);
  if (!targetBucket || !HF_TOKEN) {
    res.status(400).json({ error: 'Missing Target Bucket Name or HF_TOKEN.' });
    return null;
  }
  return targetBucket;
}

async function hfDeletePaths(targetPaths, targetBucket) {
  const targets = Array.isArray(targetPaths) ? targetPaths : [targetPaths];
  const toDelete = new Set();
  
  for await (const item of listFiles({ repo: `buckets/${targetBucket}`, repoType: 'bucket', recursive: true, accessToken: HF_TOKEN })) {
    for (const target of targets) {
      if (item.path === target || item.path.startsWith(target + '/')) toDelete.add(item.path);
    }
  }
  for (const p of toDelete) {
    await deleteFile({ repo: `buckets/${targetBucket}`, repoType: 'bucket', path: p, accessToken: HF_TOKEN });
  }
}

app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  fs.readFile(indexPath, 'utf8', (err, data) => {
    if (err) return res.status(500).send('Error loading page');
    const configScript = `<script>window.APP_CONFIG = { hasHfToken: ${!!HF_TOKEN}, defaultBucket: "${DEFAULT_HF_BUCKET}", envBuckets: "${AVAILABLE_BUCKETS}" };</script>`;
    const finalHtml = data.replace('<link rel="stylesheet" href="style.css">', `${configScript}\n<link rel="stylesheet" href="style.css">`);
    res.send(finalHtml);
  });
});

app.get('/api/hf/files', async (req, res) => {
  const targetBucket = hfCheckConfig(req, res); if (!targetBucket) return;
  try {
    const output = [];
    for await (const item of listFiles({ repo: `buckets/${targetBucket}`, repoType: 'bucket', recursive: true, accessToken: HF_TOKEN })) {
      output.push({ path: item.path, type: item.type, size: item.size, updatedAt: item.lastModified || item.updatedAt || null });
    }
    res.json(addParentDirectories(output));
  } catch (error) { res.status(500).json({ error: 'Could not list HF files', details: error.message }); }
});

app.post('/api/hf/upload-multiple', upload.array('files'), async (req, res) => {
  const targetBucket = hfCheckConfig(req, res); if (!targetBucket) return;
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
  const tempFiles = req.files;
  try {
    const paths = req.body.paths ? (Array.isArray(req.body.paths) ? req.body.paths : [req.body.paths]) : [];
    const filesToUpload = tempFiles.map((f, i) => ({ path: paths[i] || f.originalname, content: pathToFileURL(f.path) }));
    await uploadFiles({ repo: `buckets/${targetBucket}`, repoType: 'bucket', files: filesToUpload, accessToken: HF_TOKEN });
    res.json({ message: 'Uploaded successfully' });
  } catch (error) { res.status(500).json({ error: error.message }); } finally { cleanup(tempFiles); }
});

app.post('/api/hf/create-folder', async (req, res) => {
  const targetBucket = hfCheckConfig(req, res); if (!targetBucket) return;
  try {
    await uploadFiles({ repo: `buckets/${targetBucket}`, repoType: 'bucket', files: [{ path: `${req.body.folderPath}/.keep`, content: new Blob(['']) }], accessToken: HF_TOKEN });
    res.json({ message: 'Folder created' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/hf/delete/*', async (req, res) => {
  const targetBucket = hfCheckConfig(req, res); if (!targetBucket) return;
  try {
    await hfDeletePaths(req.params[0], targetBucket);
    res.json({ message: 'Deleted successfully' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/hf/delete-multiple', async (req, res) => {
  const targetBucket = hfCheckConfig(req, res); if (!targetBucket) return;
  try {
    await hfDeletePaths(req.body.filenames, targetBucket);
    res.json({ message: 'Deleted successfully' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/hf/download/*', async (req, res) => {
  const targetBucket = hfCheckConfig(req, res); if (!targetBucket) return;
  const filePath = req.params[0];
  try {
    let targetUrl = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => { targetUrl = url.toString(); throw new Error("INTERCEPTED"); };
    try { await downloadFile({ repo: `buckets/${targetBucket}`, repoType: 'bucket', path: filePath, accessToken: HF_TOKEN }); } 
    catch (e) { if (e.message !== "INTERCEPTED") throw e; } 
    finally { globalThis.fetch = originalFetch; }

    if (!targetUrl) return res.status(500).json({ error: "URL resolution failed" });

    const fetchHeaders = { 'Authorization': `Bearer ${HF_TOKEN}` };
    if (req.headers.range) fetchHeaders['Range'] = req.headers.range;

    const response = await fetch(targetUrl, { headers: fetchHeaders });
    if (!response.ok) return res.status(response.status).json({ error: 'Not found' });

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    if (response.headers.has('content-type')) res.setHeader('Content-Type', response.headers.get('content-type'));
    if (response.headers.has('content-length')) res.setHeader('Content-Length', response.headers.get('content-length'));
    if (response.headers.has('content-range')) res.setHeader('Content-Range', response.headers.get('content-range'));
    
    res.status(response.status);
    Readable.fromWeb(response.body).pipe(res);
  } catch (error) { if (!res.headersSent) res.status(500).json({ error: error.message }); }
});

app.get('/api/hf/public-url/*', async (req, res) => {
  const targetBucket = getHfBucket(req);
  const proxyUrl = `${req.protocol}://${req.get('host')}/api/hf/download/${encodeURIComponent(req.params[0])}?bucket=${encodeURIComponent(targetBucket)}`;
  res.json({ proxyUrl, url: proxyUrl }); 
});

app.post('/api/hf/rename', async (req, res) => {
  const targetBucket = hfCheckConfig(req, res); if (!targetBucket) return;
  const { oldPath, newPath } = req.body;
  try {
    const blob = await downloadFile({ repo: `buckets/${targetBucket}`, repoType: 'bucket', path: oldPath, accessToken: HF_TOKEN });
    await uploadFiles({ repo: `buckets/${targetBucket}`, repoType: 'bucket', files: [{ path: newPath, content: blob }], accessToken: HF_TOKEN });
    await deleteFile({ repo: `buckets/${targetBucket}`, repoType: 'bucket', path: oldPath, accessToken: HF_TOKEN });
    res.json({ message: 'Renamed' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/hf/move', async (req, res) => {
  const targetBucket = hfCheckConfig(req, res); if (!targetBucket) return;
  const { files, destination } = req.body;
  try {
    for (const file of files) {
      const newPath = destination ? `${destination}/${path.basename(file)}` : path.basename(file);
      const blob = await downloadFile({ repo: `buckets/${targetBucket}`, repoType: 'bucket', path: file, accessToken: HF_TOKEN });
      if (blob) {
        await uploadFiles({ repo: `buckets/${targetBucket}`, repoType: 'bucket', files: [{ path: newPath, content: blob }], accessToken: HF_TOKEN });
        await deleteFile({ repo: `buckets/${targetBucket}`, repoType: 'bucket', path: file, accessToken: HF_TOKEN });
      }
    }
    res.json({ message: 'Moved' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));