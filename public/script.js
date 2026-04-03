const fileInput = document.getElementById('fileInput');
const folderInput = document.getElementById('folderInput');
const uploadArea = document.getElementById('uploadArea');
const uploadBtn = document.getElementById('uploadBtn');
const uploadFolderBtn = document.getElementById('uploadFolderBtn');
const uploadStatus = document.getElementById('uploadStatus');
const filesList = document.getElementById('filesList');
const hfStatus = document.getElementById('hfStatus');
const loadHfBtn = document.getElementById('loadHfBtn');
const showLocalBtn = document.getElementById('showLocalBtn');
const showHfBtn = document.getElementById('showHfBtn');
const sortBySelect = document.getElementById('sortBy');
const sortOrderSelect = document.getElementById('sortOrder');
const selectAllCheckbox = document.getElementById('selectAll');
const createFolderBtn = document.getElementById('createFolderBtn');
const moveSelectedBtn = document.getElementById('moveSelectedBtn');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
const clearSelectionBtn = document.getElementById('clearSelectionBtn');

let currentTarget = 'local';
let currentPath = ''; // Current folder path for navigation
let selectedFiles = new Set();
let cachedFiles = [];

function setStatus(message, type = 'success', target = uploadStatus) {
  target.textContent = message;
  target.className = `status show ${type}`;
  setTimeout(() => {
    target.classList.remove('show');
  }, 3000);
}

function sortFileList(items) {
  const field = sortBySelect.value;
  const order = sortOrderSelect.value;
  return [...items].sort((a, b) => {
    if (field === 'size') {
      return order === 'asc' ? a.size - b.size : b.size - a.size;
    }
    if (field === 'date') {
      const da = new Date(a.updatedAt || a.uploadedAt || 0).getTime();
      const db = new Date(b.updatedAt || b.uploadedAt || 0).getTime();
      return order === 'asc' ? da - db : db - da;
    }
    const na = a.path || a.filename || '';
    const nb = b.path || b.filename || '';
    if (na < nb) return order === 'asc' ? -1 : 1;
    if (na > nb) return order === 'asc' ? 1 : -1;
    return 0;
  });
}

function updateSelectionControls() {
  const allCount = cachedFiles.length;
  const selectedCount = selectedFiles.size;
  selectAllCheckbox.checked = selectedCount === allCount && allCount > 0;
  selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < allCount;
  deleteSelectedBtn.disabled = selectedCount === 0;
}

function readAllDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    const entries = [];

    function readEntries() {
      reader.readEntries((results) => {
        if (!results.length) {
          resolve(entries);
        } else {
          entries.push(...results);
          readEntries();
        }
      }, reject);
    }

    readEntries();
  });
}

async function traverseFileTree(entry, path = '') {
  if (entry.isFile) {
    return new Promise((resolve, reject) => {
      entry.file((file) => {
        const relativePath = path ? `${path}/${file.name}` : file.name;
        // Modify the original file object to have the correct webkitRelativePath
        Object.defineProperty(file, 'webkitRelativePath', {
          value: relativePath,
          writable: false,
          enumerable: true,
          configurable: true
        });
        resolve([file]);
      }, reject);
    });
  }

  if (entry.isDirectory) {
    const reader = entry.createReader();
    const entries = await readAllDirectoryEntries(reader);
    const files = [];
    
    for (const entr of entries) {
      const nestedFiles = await traverseFileTree(entr, path ? `${path}/${entry.name}` : entry.name);
      files.push(...nestedFiles);
    }
    return files;
  }

  return [];
}

async function getDroppedFiles(dataTransfer) {
  const files = [];

  if (dataTransfer.items && dataTransfer.items.length) {
    for (const item of dataTransfer.items) {
      const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      if (entry) {
        if (entry.isFile) {
          const file = item.getAsFile();
          if (file) {
            // For single files dropped, set webkitRelativePath to just the filename
            if (!file.webkitRelativePath) {
              Object.defineProperty(file, 'webkitRelativePath', {
                value: file.name,
                writable: false,
                enumerable: true,
                configurable: true
              });
            }
            files.push(file);
          }
        } else if (entry.isDirectory) {
          const folderFiles = await traverseFileTree(entry);
          files.push(...folderFiles);
        }
      } else {
        // fallback to direct file list
        const fallbackFiles = Array.from(dataTransfer.files);
        // Set webkitRelativePath for fallback files
        fallbackFiles.forEach(file => {
          if (!file.webkitRelativePath) {
            Object.defineProperty(file, 'webkitRelativePath', {
              value: file.name,
              writable: false,
              enumerable: true,
              configurable: true
            });
          }
        });
        return fallbackFiles;
      }
    }
  } else {
    const fallbackFiles = Array.from(dataTransfer.files);
    fallbackFiles.forEach(file => {
      if (!file.webkitRelativePath) {
        Object.defineProperty(file, 'webkitRelativePath', {
          value: file.name,
          writable: false,
          enumerable: true,
          configurable: true
        });
      }
    });
    return fallbackFiles;
  }

  return files;
}

uploadArea.addEventListener('click', () => fileInput.click());

uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', async (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');

  const droppedFiles = await getDroppedFiles(e.dataTransfer);
  if (droppedFiles.length === 0) {
    setStatus('No files found in dropped data', 'error');
    return;
  }

  await uploadFiles(droppedFiles, true);
});

uploadBtn.addEventListener('click', async () => {
  if (fileInput.files.length === 0) {
    setStatus('Please select at least one file', 'error');
    return;
  }
  await uploadFiles(fileInput.files);
});

uploadFolderBtn.addEventListener('click', () => folderInput.click());

folderInput.addEventListener('change', async () => {
  if (folderInput.files.length === 0) {
    return;
  }
  await uploadFiles(folderInput.files, true);
  folderInput.value = '';
});

async function uploadFiles(fileList, isFolder = false) {
  const target = document.querySelector('input[name="uploadTarget"]:checked').value;
  const baseUrl = target === 'hf' ? '/api/hf' : '/api';
  const formData = new FormData();

  for (const file of fileList) {
    const relativePath = file.webkitRelativePath || file.name;
    // Prepend current path if we're in a subfolder
    const fullPath = currentPath ? `${currentPath}/${relativePath}` : relativePath;
    // Create a new file with the correct name to ensure multer gets the right originalname
    const renamedFile = new File([file], fullPath, { type: file.type });
    formData.append('files', renamedFile, fullPath);
    formData.append('paths', fullPath);
  }

  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Uploading...';

  try {
    const response = await fetch(`${baseUrl}/upload-multiple`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Upload failed');
    }
    setStatus(`Uploaded ${fileList.length} file(s) to ${target.toUpperCase()}`, 'success');
    fileInput.value = '';
    await loadFiles(currentTarget);
  } catch (error) {
    setStatus('Error uploading files: ' + error.message, 'error');
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload';
  }
}

loadHfBtn.addEventListener('click', () => {
  currentTarget = 'hf';
  currentPath = '';
  loadFiles('hf');
});

showLocalBtn.addEventListener('click', () => {
  currentTarget = 'local';
  currentPath = '';
  loadFiles('local');
});

showHfBtn.addEventListener('click', () => {
  currentTarget = 'hf';
  currentPath = '';
  loadFiles('hf');
});

sortBySelect.addEventListener('change', () => loadFiles(currentTarget));
sortOrderSelect.addEventListener('change', () => loadFiles(currentTarget));

selectAllCheckbox.addEventListener('change', (event) => {
  const checked = event.target.checked;
  selectedFiles.clear();
  for (const file of cachedFiles) {
    if (checked) selectedFiles.add(file.path || file.filename);
  }
  loadFiles(currentTarget);
  updateSelectionControls();
});

deleteSelectedBtn.addEventListener('click', async () => {
  if (selectedFiles.size === 0) return;

  if (!confirm(`Delete ${selectedFiles.size} selected file(s)?`)) return;
  const target = currentTarget;
  const body = JSON.stringify({ filenames: Array.from(selectedFiles) });

  try {
    const res = await fetch(`${target === 'hf' ? '/api/hf/delete-multiple' : '/api/delete-multiple'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Delete selected failed');
    }
    setStatus('Selected files deleted successfully', 'success');
    selectedFiles.clear();
    await loadFiles(currentTarget);
  } catch (err) {
    setStatus('Error deleting selected files: ' + err.message, 'error');
  }
});

clearSelectionBtn.addEventListener('click', () => {
  selectedFiles.clear();
  selectAllCheckbox.checked = false;
  loadFiles(currentTarget);
});

createFolderBtn.addEventListener('click', async () => {
  const folderName = prompt('Enter folder name:');
  if (!folderName) return;
  // Prepend current path if we're in a subfolder
  const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName;
  try {
    const response = await fetch(currentTarget === 'hf' ? '/api/hf/create-folder' : '/api/create-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath })
    });
    if (!response.ok) throw new Error(await response.text());
    setStatus('Folder created successfully', 'success');
    await loadFiles(currentTarget);
  } catch (err) {
    setStatus('Error creating folder: ' + err.message, 'error');
  }
});

moveSelectedBtn.addEventListener('click', async () => {
  if (selectedFiles.size === 0) {
    setStatus('No files selected', 'error');
    return;
  }
  const destination = prompt('Enter destination folder path (leave empty for root):');
  if (destination === null) return; // Cancelled
  try {
    const response = await fetch(currentTarget === 'hf' ? '/api/hf/move' : '/api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: Array.from(selectedFiles), destination: destination || '' })
    });
    if (!response.ok) throw new Error(await response.text());
    setStatus('Files moved successfully', 'success');
    selectedFiles.clear();
    selectAllCheckbox.checked = false;
    await loadFiles(currentTarget);
  } catch (err) {
    setStatus('Error moving files: ' + err.message, 'error');
  }
});

async function loadFiles(target = currentTarget) {
  try {
    const response = await fetch(target === 'hf' ? '/api/hf/files' : '/api/files');
    const allFiles = await response.json();

    if (!Array.isArray(allFiles) || allFiles.length === 0) {
      filesList.innerHTML = '<p>No files yet. Upload one to get started!</p>';
      cachedFiles = [];
      selectedFiles.clear();
      updateSelectionControls();
      return;
    }

    const prefix = currentPath ? `${currentPath}/` : '';

    // Build direct child view (one level-depth) with deduped folders & files
    const directMap = new Map();

    for (const file of allFiles) {
      const fullPath = file.path || file.filename || '';
      if (!fullPath.startsWith(prefix) || fullPath === currentPath) continue;

      const relative = fullPath.slice(prefix.length);
      const firstSegment = relative.split('/')[0];
      const isDirect = relative === firstSegment;

      if (!directMap.has(firstSegment)) {
        if (isDirect) {
          directMap.set(firstSegment, {
            ...file,
            path: firstSegment,
            originalPath: fullPath,
          });
        } else {
          directMap.set(firstSegment, {
            path: firstSegment,
            type: 'directory',
            size: 0,
            updatedAt: file.updatedAt || file.uploadedAt || null,
            originalPath: `${prefix}${firstSegment}`,
          });
        }
      } else if (!isDirect) {
        const existing = directMap.get(firstSegment);
        if (existing.type !== 'directory') {
          directMap.set(firstSegment, {
            path: firstSegment,
            type: 'directory',
            size: 0,
            updatedAt: file.updatedAt || file.uploadedAt || null,
            originalPath: `${prefix}${firstSegment}`,
          });
        }
      }
    }

    const files = Array.from(directMap.values());

    if (files.length === 0) {
      filesList.innerHTML = '<p>This folder is empty.</p>';
      cachedFiles = [];
      selectedFiles.clear();
      updateSelectionControls();
      return;
    }

    cachedFiles = sortFileList(files.map((file) => ({ ...file, path: file.path || file.filename })));

    // Add breadcrumb navigation
    const breadcrumb = currentPath ? 
      `<div class="breadcrumb">
        <button class="btn btn-link" onclick="navigateToPath('')">🏠 Root</button> / 
        ${currentPath.split('/').map((part, index) => {
          const pathUpToHere = currentPath.split('/').slice(0, index + 1).join('/');
          return `<button class="btn btn-link" onclick="navigateToPath('${pathUpToHere}')">${part}</button>`;
        }).join(' / ')}
      </div>` : '';

    filesList.innerHTML = breadcrumb + cachedFiles
      .map((file) => {
        const name = file.path;
        const fullPath = file.originalPath || file.path;
        const size = file.size || 0;
        const date = file.updatedAt || file.uploadedAt || 'unknown';
        const selected = selectedFiles.has(fullPath);
        const encoded = encodeURIComponent(fullPath);
        const isFolder = file.type === 'directory';

        return `
          <div class="file-item">
            <label class="checkbox-container">
              <input type="checkbox" onchange="toggleSelection('${encoded}')" ${selected ? 'checked' : ''}>
            </label>
            <div class="file-info">
              <div class="file-name">${isFolder ? '📁' : '📄'} ${escapeHtml(name)}</div>
              <div class="file-size">${isFolder ? 'Folder' : formatBytes(size)} ${date ? '| ' + date : ''}</div>
            </div>
            <div class="file-actions">
              ${isFolder ? `
                <button class="btn btn-primary" onclick="openFolder('${encoded}', '${target}')">Open</button>
                <button class="btn btn-warning" onclick="renameFile('${encoded}', '${target}')">Rename</button>
                <button class="btn btn-danger" onclick="deleteFile('${encoded}', '${target}')">Delete</button>
              ` : `
                <button class="btn btn-success" onclick="downloadFile('${encoded}', '${target}')">Download</button>
                <button class="btn btn-secondary" onclick="copyLink('${encoded}', '${target}')">Copy link</button>
                <button class="btn btn-warning" onclick="renameFile('${encoded}', '${target}')">Rename</button>
                <button class="btn btn-danger" onclick="deleteFile('${encoded}', '${target}')">Delete</button>
              `}
            </div>
          </div>
        `;
      })
      .join('');

    updateSelectionControls();
  } catch (error) {
    filesList.innerHTML = `<p>Error loading ${target === 'hf' ? 'HF' : 'local'} files</p>`;
  }
}

window.toggleSelection = (encodedName) => {
  const name = decodeURIComponent(encodedName);
  if (selectedFiles.has(name)) {
    selectedFiles.delete(name);
  } else {
    selectedFiles.add(name);
  }
  updateSelectionControls();
};

window.downloadFile = async (encodedName, target) => {
  const name = decodeURIComponent(encodedName);

  if (target === 'hf') {
    try {
      const resp = await fetch(`/api/hf/public-url/${encodeURIComponent(name)}`);
      if (!resp.ok) throw new Error('Cannot get HF URL');
      const json = await resp.json();
      // For private buckets (with token), use proxy download to avoid third-party cookie issues
      // For public buckets, use direct HF URL
      const downloadUrl = window.APP_CONFIG?.hasHfToken ? json.proxyUrl : json.url;
      if (window.APP_CONFIG?.hasHfToken) {
        // Use proxy download for private buckets
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = name.split('/').pop();
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setStatus('Downloading via proxy', 'success');
      } else {
        // Use direct HF URL for public buckets
        window.open(downloadUrl, '_blank');
        setStatus('Opening direct HF download', 'success');
      }
      return;
    } catch (err) {
      setStatus('HF download failed: ' + err.message, 'error');
      return;
    }
  }

  const a = document.createElement('a');
  a.href = `/api/download/${encodeURIComponent(name)}`;
  a.download = name.split('/').pop();
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

window.copyLink = async (encodedName, target) => {
  const name = decodeURIComponent(encodedName);

  if (target === 'hf') {
    try {
      const resp = await fetch(`/api/hf/public-url/${encodeURIComponent(name)}`);
      if (!resp.ok) throw new Error('Cannot get HF URL');
      const json = await resp.json();
      // For private buckets, copy proxy URL; for public, copy direct HF URL
      const linkUrl = window.APP_CONFIG?.hasHfToken ? json.proxyUrl : json.url;
      await navigator.clipboard.writeText(linkUrl);
      setStatus('HF link copied to clipboard', 'success');
      return;
    } catch (err) {
      setStatus('HF copy link failed: ' + err.message, 'error');
      return;
    }
  }

  const url = `${window.location.origin}/api/download/${encodeURIComponent(name)}`;
  try {
    await navigator.clipboard.writeText(url);
    setStatus('Link copied to clipboard', 'success');
  } catch {
    setStatus('Copy link failed', 'error');
  }
};

window.renameFile = async (encodedName, target) => {
  const name = decodeURIComponent(encodedName);
  const newName = prompt('Enter new name (including folders):', name);
  if (!newName || newName === name) return;

  try {
    const endpoint = target === 'hf' ? '/api/hf/rename' : '/api/rename';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath: name, newPath: newName }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Rename failed');
    }
    setStatus('File renamed successfully', 'success');
    selectedFiles.delete(name);
    await loadFiles(currentTarget);
  } catch (err) {
    setStatus('Rename error: ' + err.message, 'error');
  }
};

window.openFolder = async (encodedName, target) => {
  const fullPath = decodeURIComponent(encodedName);
  // fullPath is already absolute from root, based on list items
  navigateToPath(fullPath);
};

function navigateToPath(path) {
  currentPath = path;
  selectedFiles.clear();
  selectAllCheckbox.checked = false;
  loadFiles(currentTarget);
}

window.deleteFile = async (encodedName, target) => {
  const name = decodeURIComponent(encodedName);
  if (!confirm(`Delete ${name}?`)) return;

  try {
    const endpoint = target === 'hf' ? `/api/hf/delete/${encodeURIComponent(name)}` : `/api/delete/${encodeURIComponent(name)}`;
    const res = await fetch(endpoint, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Delete failed');
    }
    setStatus('Deleted successfully', 'success');
    selectedFiles.delete(name);
    await loadFiles(currentTarget);
  } catch (err) {
    setStatus('Delete error: ' + err.message, 'error');
  }
};

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

loadFiles();
setInterval(() => loadFiles(currentTarget), 5000);

