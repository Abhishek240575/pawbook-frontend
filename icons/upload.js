/* ==========================================================================
   PAWBOOK  upload.js  — Cloudinary image/video uploader (frontend helper)
   Works with backend POST /api/v1/media/upload  (single)
                        POST /api/v1/media/upload-multiple  (batch)
   Usage:
     uploadToCloudinary(file, type)          → { url, public_id }
     uploadToCloudinaryDirect(file)          → same (alias, type='post')
     uploadAvatar(file)                      → updates user avatar_url
     uploadCover(file)                       → updates user cover_url
     uploadMultiple(files)                   → [{ url, public_id }, …]
   ========================================================================== */

const _UP_BASE = (typeof API_BASE !== 'undefined') ? API_BASE
               : 'https://pawbook-api-cquc.onrender.com/api/v1';

function _upToken() {
  return localStorage.getItem('pb_token') || localStorage.getItem('token') || '';
}

/**
 * Upload a single file to Cloudinary via the backend.
 * @param {File}   file  - browser File object
 * @param {string} type  - 'avatar' | 'cover' | 'post' | 'pet' | 'vet' | 'event'
 * @returns {Promise<{url:string, public_id:string, type:string}>}
 */
async function uploadToCloudinary(file, type = 'post') {
  const fd = new FormData();
  fd.append('file', file);

  const res = await fetch(`${_UP_BASE}/media/upload?type=${type}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + _upToken() },
    body: fd,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Upload failed');

  // Response shape: { success:true, data:{ url, public_id, type } }
  return data.data || data;
}

/** Alias — same as uploadToCloudinary(file, 'post') */
async function uploadToCloudinaryDirect(file) {
  return uploadToCloudinary(file, 'post');
}

/**
 * Upload avatar — updates user record on backend, refreshes pb_user in localStorage.
 */
async function uploadAvatar(file) {
  const result = await uploadToCloudinary(file, 'avatar');

  // Patch cached user
  try {
    const u = JSON.parse(localStorage.getItem('pb_user') || '{}');
    u.avatar_url = result.url;
    localStorage.setItem('pb_user', JSON.stringify(u));
  } catch (_) {}

  return result;
}

/**
 * Upload cover photo — updates user record on backend, refreshes pb_user.
 */
async function uploadCover(file) {
  const result = await uploadToCloudinary(file, 'cover');

  try {
    const u = JSON.parse(localStorage.getItem('pb_user') || '{}');
    u.cover_url = result.url;
    localStorage.setItem('pb_user', JSON.stringify(u));
  } catch (_) {}

  return result;
}

/**
 * Upload multiple files (up to 5).
 * @param {File[]} files
 * @returns {Promise<Array<{url, public_id, resource_type, original_name}>>}
 */
async function uploadMultiple(files) {
  const fd = new FormData();
  files.forEach(f => fd.append('files', f));

  const res = await fetch(`${_UP_BASE}/media/upload-multiple`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + _upToken() },
    body: fd,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Upload failed');

  return (data.data || data).files || [];
}

/**
 * Reusable avatar-upload-button wirer.
 * Adds a hidden <input type="file"> that triggers on btn click,
 * uploads the chosen image, and calls onSuccess(url).
 *
 * @param {HTMLElement} btn        - clickable element (camera icon, edit btn, etc.)
 * @param {string}      uploadType - 'avatar' | 'cover' | 'post'
 * @param {Function}    onSuccess  - called with (url, public_id) after upload
 * @param {Function}    onError    - optional error handler
 */
function wireUploadButton(btn, uploadType, onSuccess, onError) {
  if (!btn) return;

  // Create hidden file input
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/jpeg,image/png,image/gif,image/webp';
  inp.style.display = 'none';
  document.body.appendChild(inp);

  btn.addEventListener('click', () => inp.click());

  inp.addEventListener('change', async () => {
    const file = inp.files[0];
    if (!file) return;

    // Show loading state on button
    const orig = btn.innerHTML;
    btn.innerHTML = '<span style="opacity:.6">Uploading…</span>';
    btn.disabled = true;

    try {
      const result = await uploadToCloudinary(file, uploadType);
      onSuccess(result.url, result.public_id);
    } catch (err) {
      console.error('[upload.js]', err);
      if (typeof onError === 'function') onError(err);
      else if (typeof toast === 'function') toast('Upload failed: ' + err.message, 'error');
    } finally {
      btn.innerHTML = orig;
      btn.disabled = false;
      inp.value = '';
    }
  });
}
