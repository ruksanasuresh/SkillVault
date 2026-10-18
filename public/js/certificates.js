// public/js/certificates.js

if (!requireAuthOrRedirect()) { /* redirected */ }

let allCerts = [];
let allFolders = [];
let activeFolder = 'all';

async function loadAll() {
  const errorBox = document.getElementById('error-box');
  errorBox.innerHTML = '';
  try {
    const [me, foldersRes, certsRes] = await Promise.all([
      API.get('/api/auth/me'),
      API.get('/api/folders'),
      API.get('/api/certificates'),
    ]);
    document.getElementById('side-name').textContent = me.user.name;
    allFolders = foldersRes.folders;
    allCerts = certsRes.certificates;
    renderFolders();
    renderCerts();
  } catch (err) {
    errorBox.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
}

function renderFolders() {
  const uncategorized = allCerts.filter((c) => !c.folderId).length;
  const rows = [
    `<a href="#" data-folder="all" class="${activeFolder === 'all' ? 'active' : ''}">All certificates <span class="count">${allCerts.length}</span></a>`,
    `<a href="#" data-folder="none" class="${activeFolder === 'none' ? 'active' : ''}">Uncategorized <span class="count">${uncategorized}</span></a>`,
    ...allFolders.map((f) => `<a href="#" data-folder="${f.id}" class="${activeFolder === f.id ? 'active' : ''}">${f.name} <span class="count">${f.certificateCount}</span></a>`),
  ];
  document.getElementById('folder-list').innerHTML = rows.join('');
  document.querySelectorAll('#folder-list a').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      activeFolder = a.dataset.folder;
      renderFolders();
      renderCerts();
    });
  });
}

function certStatusPill(v) {
  const label = v.status === 'verified' ? '✓ Verified' : v.status === 'suspicious' ? 'Suspicious' : 'Not verified';
  return `<span class="status-pill ${v.status}">${label}</span>`;
}

function renderCerts() {
  const filtered = activeFolder === 'all' ? allCerts
    : activeFolder === 'none' ? allCerts.filter((c) => !c.folderId)
    : allCerts.filter((c) => c.folderId === activeFolder);

  document.getElementById('folder-title').textContent = activeFolder === 'all' ? 'All certificates' : activeFolder === 'none' ? 'Uncategorized' : (allFolders.find((f) => f.id === activeFolder)?.name || 'Folder');
  document.getElementById('cert-count').textContent = filtered.length;

  const el = document.getElementById('cert-grid');
  if (filtered.length === 0) { el.innerHTML = '<div class="empty-state">No certificates in this folder yet.</div>'; return; }

  el.innerHTML = filtered.map((c) => `
    <div class="cert-card">
      <div class="cert-thumb"><div class="ring"></div></div>
      <div class="cert-body">
        <h4 class="h3" style="font-size:0.92rem;">${c.filename}</h4>
        <p class="caption">${new Date(c.createdAt).toLocaleDateString()}</p>
        ${certStatusPill(c.verification)}
        <div class="cert-actions">
          <button onclick="viewCert('${c.id}')">View</button>
          <button onclick="openDetail('${c.id}')">Details</button>
          <button onclick="deleteCert('${c.id}')" style="color:var(--error);">Delete</button>
        </div>
      </div>
    </div>
  `).join('');
}

window.viewCert = (id) => API.openFile(`/api/certificates/${id}/file`).catch((e) => alert(e.message));

window.deleteCert = async (id) => {
  if (!confirm('Delete this certificate?')) return;
  await API.del(`/api/certificates/${id}`);
  loadAll();
};

window.openDetail = (id) => {
  const c = allCerts.find((x) => x.id === id);
  if (!c) return;
  document.getElementById('detail-title').textContent = c.filename;
  const v = c.verification;
  const fields = v.extractedFields || {};
  const fieldRows = Object.entries(fields).filter(([, val]) => val).map(([k, val]) => `<div class="mock-row"><span>${k.replace(/_/g, ' ')}</span><span>${val}</span></div>`).join('');
  document.getElementById('detail-body').innerHTML = `
    <div style="margin-bottom:16px;">${certStatusPill(v)} <span class="caption" style="margin-left:8px;">Confidence: ${Math.round((v.confidence || 0) * 100)}% · Method: ${v.method}</span></div>
    ${v.qrUrl ? `<p class="body-sm">Verification link: <a href="${v.qrUrl}" target="_blank" style="color:var(--primary);">${v.qrUrl}</a></p>` : ''}
    ${fieldRows ? `<div class="mock-list" style="margin:16px 0;">${fieldRows}</div>` : ''}
    ${v.issues && v.issues.length ? `<div class="issues-list"><strong>Notes:</strong><br>${v.issues.map((i) => `• ${i}`).join('<br>')}</div>` : ''}
    <div style="margin-top:16px;">
      <label class="label">Move to folder</label>
      <select id="detail-folder-select" style="width:100%; padding:10px; border:1px solid var(--border); border-radius:8px; margin-top:6px;">
        <option value="">Uncategorized</option>
        ${allFolders.map((f) => `<option value="${f.id}" ${c.folderId === f.id ? 'selected' : ''}>${f.name}</option>`).join('')}
      </select>
    </div>
    <div class="row-actions">
      <button class="btn btn-primary" onclick="moveCert('${c.id}')">Save</button>
    </div>
  `;
  document.getElementById('detail-modal').classList.remove('hidden');
};

window.moveCert = async (id) => {
  const folderId = document.getElementById('detail-folder-select').value || null;
  await API.put(`/api/certificates/${id}/folder`, { folderId });
  document.getElementById('detail-modal').classList.add('hidden');
  loadAll();
};

document.getElementById('detail-close').addEventListener('click', () => document.getElementById('detail-modal').classList.add('hidden'));
document.getElementById('detail-modal').addEventListener('click', (e) => { if (e.target.id === 'detail-modal') e.target.classList.add('hidden'); });

document.getElementById('new-folder-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-folder-name').value.trim();
  if (!name) return;
  await API.post('/api/folders', { name });
  document.getElementById('new-folder-name').value = '';
  loadAll();
});

document.getElementById('upload-btn').addEventListener('click', () => document.getElementById('cert-file').click());
document.getElementById('cert-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const statusBox = document.getElementById('upload-status');
  statusBox.innerHTML = `<div class="alert alert-success">Verifying "${file.name}"…</div>`;
  const fd = new FormData();
  fd.append('file', file);
  if (activeFolder && activeFolder !== 'all' && activeFolder !== 'none') fd.append('folderId', activeFolder);
  try {
    const res = await API.postForm('/api/certificates', fd);
    statusBox.innerHTML = `<div class="alert alert-success">Uploaded — status: ${res.certificate.verification.status}</div>`;
    e.target.value = '';
    loadAll();
  } catch (err) {
    statusBox.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
});

loadAll();
