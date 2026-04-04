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
const pinFoldersCheckbox = document.getElementById('pinFolders'); // <-- NEW
const selectAllCheckbox = document.getElementById('selectAll');
const createFolderBtn = document.getElementById('createFolderBtn');
const moveSelectedBtn = document.getElementById('moveSelectedBtn');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
const clearSelectionBtn = document.getElementById('clearSelectionBtn');
const uploadProgressContainer = document.getElementById('uploadProgressContainer');
const progressBar = document.getElementById('progressBar');
const speedElement = document.getElementById('speed');
const timeRemainingElement = document.getElementById('timeRemaining');

let currentTarget = 'hf';
let currentPath = ''; // Current folder path for navigation
let selectedFiles = new Set();
let cachedFiles = [];
let bucketFilesMap = new Map(); // <-- NEW: For instant conflict checks

function setStatus(message, type = 'success', target = uploadStatus) {
  target.textContent = message;
  target.className = `status show ${type}`;
  setTimeout(() => {
    target.classList.remove('show');
  }, 3000);
}

// <-- NEW: Dynamic File Icons
function getFileIcon(name, isFolder) {
  if (isFolder) return '📁';
  const ext = name.split('.').pop().toLowerCase();
  if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return '🎬';
  if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return '🎵';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦';
  if (['txt', 'md', 'csv', 'json', 'xml'].includes(ext)) return '📝';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return '🖼️';
  return '📄';
}

function sortFileList(items) {
  const field = sortBySelect.value;
  const order = sortOrderSelect.value;
  const pinFolders = pinFoldersCheckbox ? pinFoldersCheckbox.checked : false; // <-- NEW

  return [...items].sort((a, b) => {
    // <-- NEW: Pin Folders Logic
    if (pinFolders) {
      const aIsDir = a.type === 'directory';
      const bIsDir = b.type === 'directory';
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
    }

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
  if (folderInput.files.length === 0) return;
  await uploadFiles(folderInput.files, true);
  folderInput.value = '';
});

async function uploadFiles(fileList, isFolder = false) {
  const target = document.querySelector('input[name="uploadTarget"]:checked').value;
  const baseUrl = target === 'hf' ? '/api/hf' : '/api';
  const formData = new FormData();

  // <-- NEW: Conflict Check logic integrated into your original loop
  const filesToProcess = [];
  for (const file of fileList) {
    const relativePath = file.webkitRelativePath || file.name;
    let fullPath = currentPath ? `${currentPath}/${relativePath}` : relativePath;

    // Only check conflicts if uploading to HF
    if (target === 'hf' && bucketFilesMap.has(fullPath)) {
        const existingSize = formatBytes(bucketFilesMap.get(fullPath));
        const userInput = prompt(
            `⚠️ CONFLICT: "${fullPath}" exists!\nSize: ${existingSize}\n\n- To REPLACE: Click OK\n- To RENAME: Type new name and click OK\n- To SKIP: Click Cancel`, 
            fullPath
        );
        if (userInput === null) continue; // Skip
        fullPath = userInput;
    }

    const renamedFile = new File([file], fullPath, { type: file.type });
    filesToProcess.push({ file: renamedFile, path: fullPath });
  }

  if (filesToProcess.length === 0) return;

  filesToProcess.forEach(item => {
    formData.append('files', item.file, item.path);
    formData.append('paths', item.path);
  });

  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Uploading...';
  uploadProgressContainer.style.display = 'block';
  progressBar.style.width = '0%';
  speedElement.textContent = '';
  timeRemainingElement.textContent = '';

  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${baseUrl}/upload-multiple`, true);

  let startTime = Date.now();

  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) {
      const percentComplete = (event.loaded / event.total) * 100;
      progressBar.style.width = `${percentComplete}%`;
      const elapsedTime = (Date.now() - startTime) / 1000;
      if (elapsedTime > 0) {
        const speed = event.loaded / elapsedTime;
        speedElement.textContent = `${formatBytes(speed)}/s`;
        const remainingBytes = event.total - event.loaded;
        const timeRemaining = remainingBytes / speed;
        timeRemainingElement.textContent = `${Math.round(timeRemaining)}s remaining`;
      }
    }
  };

  xhr.onload = async () => {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload Selected';
    uploadProgressContainer.style.display = 'none';
    if (xhr.status >= 200 && xhr.status < 300) {
      setStatus(`Uploaded successfully to ${target.toUpperCase()}`, 'success');
      fileInput.value = '';
      if(folderInput) folderInput.value = '';
      await loadFiles(currentTarget);
    } else {
      try {
        const err = JSON.parse(xhr.responseText);
        setStatus(`Error: ${err.error || 'Upload failed'}`, 'error');
      } catch (e) {
        setStatus(`Error: ${xhr.statusText}`, 'error');
      }
    }
  };

  xhr.onerror = () => {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload Selected';
    uploadProgressContainer.style.display = 'none';
    setStatus('Network error.', 'error');
  };

  xhr.send(formData);
}

loadHfBtn.addEventListener('click', () => { currentTarget = 'hf'; currentPath = ''; loadFiles('hf'); });
showLocalBtn.addEventListener('click', () => { currentTarget = 'local'; currentPath = ''; loadFiles('local'); });
showHfBtn.addEventListener('click', () => { currentTarget = 'hf'; currentPath = ''; loadFiles('hf'); });

sortBySelect.addEventListener('change', () => loadFiles(currentTarget));
sortOrderSelect.addEventListener('change', () => loadFiles(currentTarget));
if(pinFoldersCheckbox) pinFoldersCheckbox.addEventListener('change', () => loadFiles(currentTarget)); // <-- NEW

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
    if (!res.ok) throw new Error((await res.json()).error || 'Delete failed');
    setStatus('Selected files deleted', 'success');
    selectedFiles.clear();
    await loadFiles(currentTarget);
  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
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
  const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName;
  try {
    const response = await fetch(currentTarget === 'hf' ? '/api/hf/create-folder' : '/api/create-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath })
    });
    if (!response.ok) throw new Error(await response.text());
    setStatus('Folder created', 'success');
    await loadFiles(currentTarget);
  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
  }
});

moveSelectedBtn.addEventListener('click', async () => {
  if (selectedFiles.size === 0) return setStatus('No files selected', 'error');
  const destination = prompt('Enter destination folder path:');
  if (destination === null) return; 
  try {
    const response = await fetch(currentTarget === 'hf' ? '/api/hf/move' : '/api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: Array.from(selectedFiles), destination: destination || '' })
    });
    if (!response.ok) throw new Error(await response.text());
    setStatus('Files moved', 'success');
    selectedFiles.clear();
    selectAllCheckbox.checked = false;
    await loadFiles(currentTarget);
  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
  }
});

async function loadFiles(target = currentTarget) {
  try {
    const response = await fetch(target === 'hf' ? '/api/hf/files' : '/api/files');
    const allFiles = await response.json();

    // <-- NEW: Update conflict map instantly
    bucketFilesMap.clear();
    if (Array.isArray(allFiles)) {
      allFiles.forEach(f => { if(f.type !== 'directory') bucketFilesMap.set(f.path, f.size); });
    }

    if (!Array.isArray(allFiles) || allFiles.length === 0) {
      filesList.innerHTML = '<p>No files yet.</p>';
      cachedFiles = [];
      selectedFiles.clear();
      updateSelectionControls();
      return;
    }

    const prefix = currentPath ? `${currentPath}/` : '';
    const directMap = new Map();

    for (const file of allFiles) {
      const fullPath = file.path || file.filename || '';
      if (!fullPath.startsWith(prefix) || fullPath === currentPath) continue;
      const relative = fullPath.slice(prefix.length);
      const firstSegment = relative.split('/')[0];
      const isDirect = relative === firstSegment;
      if (!directMap.has(firstSegment)) {
        if (isDirect) {
          directMap.set(firstSegment, { ...file, path: firstSegment, originalPath: fullPath });
        } else {
          directMap.set(firstSegment, { path: firstSegment, type: 'directory', size: 0, updatedAt: file.updatedAt || file.uploadedAt || null, originalPath: `${prefix}${firstSegment}` });
        }
      } else if (!isDirect) {
        const existing = directMap.get(firstSegment);
        if (existing.type !== 'directory') {
          directMap.set(firstSegment, { path: firstSegment, type: 'directory', size: 0, updatedAt: file.updatedAt || file.uploadedAt || null, originalPath: `${prefix}${firstSegment}` });
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
        const selected = selectedFiles.has(fullPath);
        const encoded = encodeURIComponent(fullPath);
        const isFolder = file.type === 'directory';

        // <-- NEW: Beautiful Date formatting
        let dateText = '';
        if (file.updatedAt || file.uploadedAt) {
          const d = new Date(file.updatedAt || file.uploadedAt);
          if (!isNaN(d.getTime())) dateText = d.toLocaleString();
        }

        return `
          <div class="file-item">
            <label class="checkbox-container">
              <input type="checkbox" onchange="toggleSelection('${encoded}')" ${selected ? 'checked' : ''}>
            </label>
            <div class="file-info">
              <!-- NEW: Icons added here -->
              <div class="file-name">${getFileIcon(name, isFolder)} ${escapeHtml(name)}</div>
              <div class="file-size">${isFolder ? 'Folder' : formatBytes(size)} ${dateText ? '| ' + dateText : ''}</div>
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
    filesList.innerHTML = `<p>Error loading files</p>`;
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
      const downloadUrl = window.APP_CONFIG?.hasHfToken ? json.proxyUrl : json.url;
      if (window.APP_CONFIG?.hasHfToken) {
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = name.split('/').pop();
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setStatus('Downloading via proxy', 'success');
      } else {
        window.open(downloadUrl, '_blank');
        setStatus('Opening download', 'success');
      }
      return;
    } catch (err) {
      setStatus('Download failed: ' + err.message, 'error');
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
      const linkUrl = window.APP_CONFIG?.hasHfToken ? json.proxyUrl : json.url;
      await navigator.clipboard.writeText(linkUrl);
      setStatus('Link copied', 'success');
      return;
    } catch (err) {
      setStatus('Copy failed: ' + err.message, 'error');
      return;
    }
  }
  const url = `${window.location.origin}/api/download/${encodeURIComponent(name)}`;
  try {
    await navigator.clipboard.writeText(url);
    setStatus('Link copied', 'success');
  } catch { setStatus('Copy failed', 'error'); }
};

window.renameFile = async (encodedName, target) => {
  const name = decodeURIComponent(encodedName);
  const newName = prompt('Enter new name:', name);
  if (!newName || newName === name) return;
  try {
    const endpoint = target === 'hf' ? '/api/hf/rename' : '/api/rename';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath: name, newPath: newName }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Rename failed');
    setStatus('Renamed successfully', 'success');
    selectedFiles.delete(name);
    await loadFiles(currentTarget);
  } catch (err) { setStatus('Error: ' + err.message, 'error'); }
};

window.openFolder = async (encodedName, target) => {
  const fullPath = decodeURIComponent(encodedName);
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
    const res = await fetch(endpoint, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error || 'Delete failed');
    setStatus('Deleted', 'success');
    selectedFiles.delete(name);
    await loadFiles(currentTarget);
  } catch (err) { setStatus('Error: ' + err.message, 'error'); }
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
setInterval(() => loadFiles(currentTarget), 10000); // 10 seconds refresh