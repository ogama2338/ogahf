const fileInput = document.getElementById('fileInput');
const uploadArea = document.getElementById('uploadArea');
const uploadBtn = document.getElementById('uploadBtn');
const uploadStatus = document.getElementById('uploadStatus');
const filesList = document.getElementById('filesList');

// Drag and drop
uploadArea.addEventListener('click', () => fileInput.click());

uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  fileInput.files = e.dataTransfer.files;
});

// Upload file
uploadBtn.addEventListener('click', async () => {
  if (fileInput.files.length === 0) {
    showStatus('Please select a file', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  try {
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) throw new Error('Upload failed');

    showStatus('File uploaded successfully!', 'success');
    fileInput.value = '';
    loadFiles();
  } catch (error) {
    showStatus('Error uploading file: ' + error.message, 'error');
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload';
  }
});

// Load files
async function loadFiles() {
  try {
    const response = await fetch('/api/files');
    const files = await response.json();

    if (files.length === 0) {
      filesList.innerHTML = '<p>No files yet. Upload one to get started!</p>';
      return;
    }

    filesList.innerHTML = files.map(file => `
      <div class="file-item">
        <div class="file-info">
          <div class="file-name">📄 ${escapeHtml(file.filename)}</div>
          <div class="file-size">${formatBytes(file.size)}</div>
        </div>
        <div class="file-actions">
          <button class="btn btn-success" onclick="downloadFile('${escapeHtml(file.filename)}')">Download</button>
          <button class="btn btn-danger" onclick="deleteFile('${escapeHtml(file.filename)}')">Delete</button>
        </div>
      </div>
    `).join('');
  } catch (error) {
    filesList.innerHTML = '<p>Error loading files</p>';
  }
}

// Download file
async function downloadFile(filename) {
  const a = document.createElement('a');
  a.href = `/api/download/${encodeURIComponent(filename)}`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Delete file
async function deleteFile(filename) {
  if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;

  try {
    const response = await fetch(`/api/delete/${encodeURIComponent(filename)}`, {
      method: 'DELETE'
    });

    if (!response.ok) throw new Error('Delete failed');

    showStatus('File deleted successfully!', 'success');
    loadFiles();
  } catch (error) {
    showStatus('Error deleting file: ' + error.message, 'error');
  }
}

// Utility functions
function showStatus(message, type) {
  uploadStatus.textContent = message;
  uploadStatus.className = `status show ${type}`;
  setTimeout(() => {
    uploadStatus.classList.remove('show');
  }, 3000);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Load files on page load
loadFiles();

// Refresh files every 5 seconds
setInterval(loadFiles, 5000);