// upload.js — shared media upload utility for PawBook frontend
// Include AFTER api.js: <script src="upload.js"></script>
// Provides: uploadMedia(file, onProgress) → Promise<{ url, public_id, ... }>
//           uploadMultipleMedia(files, onProgress) → Promise<[...]>
//           uploadToCloudinaryDirect(file, onProgress) → Promise<{ url, ... }>  (unsigned preset, no auth)

// ── Single file upload via backend (authenticated) ──────────────────
async function uploadMedia(file, onProgress) {
  const formData = new FormData();
  formData.append('file', file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open('POST', `${API_BASE}/media/upload`);

    // Auth header
    const token = localStorage.getItem('pawbook_token');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    if (typeof onProgress === 'function') {
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.success) {
          resolve(data);
        } else {
          reject(new Error(data.message || 'Upload failed'));
        }
      } catch {
        reject(new Error('Invalid server response'));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(formData);
  });
}

// ── Multiple files via backend (authenticated) ──────────────────────
async function uploadMultipleMedia(files, onProgress) {
  const formData = new FormData();
  Array.from(files).forEach(f => formData.append('files', f));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/media/upload-multiple`);

    const token = localStorage.getItem('pawbook_token');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    if (typeof onProgress === 'function') {
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.success) {
          resolve(data.files);
        } else {
          reject(new Error(data.message || 'Upload failed'));
        }
      } catch {
        reject(new Error('Invalid server response'));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(formData);
  });
}

// ── Direct unsigned upload to Cloudinary (no backend, no auth token needed) ──
// Use for avatar / cover photo previews before profile save
const CLOUDINARY_UPLOAD_URL = 'https://api.cloudinary.com/v1_1/pawbook-api/upload';
const CLOUDINARY_PRESET    = 'pawbook_uploads';

async function uploadToCloudinaryDirect(file, onProgress) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_PRESET);
  formData.append('folder', 'pawbook');

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', CLOUDINARY_UPLOAD_URL);

    if (typeof onProgress === 'function') {
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status === 200) {
          resolve({
            url:           data.secure_url,
            public_id:     data.public_id,
            resource_type: data.resource_type,
            width:         data.width,
            height:        data.height,
            format:        data.format,
          });
        } else {
          reject(new Error(data.error?.message || 'Cloudinary upload failed'));
        }
      } catch {
        reject(new Error('Invalid Cloudinary response'));
      }
    };

    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(formData);
  });
}

// ── Helper: show upload progress ring on an <img> element ───────────
function showUploadProgress(imgEl, pct) {
  imgEl.style.opacity = '0.5';
  imgEl.title = `Uploading… ${pct}%`;
  if (pct >= 100) {
    imgEl.style.opacity = '1';
    imgEl.title = '';
  }
}

// ── Helper: validate file before upload ────────────────────────────
function validateImageFile(file, maxMB = 10) {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowed.includes(file.type)) {
    return 'Please choose a JPG, PNG, GIF, or WebP image.';
  }
  if (file.size > maxMB * 1024 * 1024) {
    return `Image must be under ${maxMB} MB.`;
  }
  return null; // valid
}

function validateVideoFile(file, maxMB = 50) {
  const allowed = ['video/mp4', 'video/quicktime', 'video/webm'];
  if (!allowed.includes(file.type)) {
    return 'Please choose an MP4, MOV, or WebM video.';
  }
  if (file.size > maxMB * 1024 * 1024) {
    return `Video must be under ${maxMB} MB.`;
  }
  return null;
}
