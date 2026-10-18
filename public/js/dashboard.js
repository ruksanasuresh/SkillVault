// public/js/dashboard.js

if (!requireAuthOrRedirect()) { /* redirected */ }

let currentScale = { grades: ['S', 'A+', 'A', 'B+', 'B', 'C', 'P', 'F', 'N'] };

async function loadAll() {
  const errorBox = document.getElementById('error-box');
  errorBox.innerHTML = '';
  try {
    const [me, summary, certs, recs] = await Promise.all([
      API.get('/api/auth/me'),
      API.get('/api/grades/summary'),
      API.get('/api/certificates'),
      API.get('/api/recommendations'),
    ]);

    currentScale = summary.scale;
    renderUser(me.user);
    renderStats(summary, certs.certificates);
    renderSemesters(summary.semesters);
    renderSkills(recs.skills);
    renderCertPreview(certs.certificates);
    renderRecommendations(recs.recommendations);
  } catch (err) {
    errorBox.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
}

function renderUser(user) {
  document.getElementById('welcome-name').textContent = `${user.name.split(' ')[0]}'s Vault`;
  document.getElementById('side-name').textContent = user.name;
  document.getElementById('side-meta').textContent = [user.branch ? user.branch.toUpperCase() : null, user.college].filter(Boolean).join(' · ') || 'Complete your profile';
}

function renderStats(summary, certificates) {
  // summary.cgpa can legitimately be 0 (no graded courses yet) — `|| '—'`
  // treated that as falsy and always showed a dash, which is one of the
  // ways this looked like "CGPA isn't updating". Check for null/undefined
  // explicitly instead.
  document.getElementById('stat-cgpa').textContent = (summary.cgpa === null || summary.cgpa === undefined) ? '—' : summary.cgpa;
  document.getElementById('stat-scale').textContent = summary.scale.label;

  const verified = certificates.filter((c) => c.verification?.status === 'verified').length;
  document.getElementById('stat-certs').textContent = certificates.length;
  document.getElementById('stat-certs-sub').textContent = `${verified} verified · ${certificates.length - verified} other`;
}

function renderSemesters(semesters) {
  document.getElementById('sem-count').textContent = `${semesters.length} semester${semesters.length === 1 ? '' : 's'}`;
  const el = document.getElementById('semesters-list');
  if (semesters.length === 0) {
    el.innerHTML = '<div class="empty-state">No semesters yet — add your first one.</div>';
    return;
  }
  el.innerHTML = semesters.map((s) => `
    <details class="sem-card" open>
      <summary class="sem-card-head">
        <span class="sem-name">${s.name}</span>
        <span class="sem-gpa-badge">${s.gpa || '0'} <span class="sem-gpa-label">SGPA</span></span>
        <button class="sem-remove" onclick="event.preventDefault(); deleteSemester('${s.id}')" title="Remove semester">✕</button>
      </summary>
      <table class="sem-table">
        <thead><tr><th>Course</th><th>Code</th><th>Credits</th><th>Grade</th></tr></thead>
        <tbody>
          ${s.courses.map((c) => `<tr><td>${c.name}</td><td>${c.code || '—'}</td><td>${c.credits ?? '<span class="no-grade">missing</span>'}</td><td>${c.grade ? `<span class="grade-pill">${c.grade}</span>` : '<span class="no-grade">not graded</span>'}</td></tr>`).join('')}
        </tbody>
      </table>
    </details>
  `).join('');
}

async function deleteSemester(id) {
  if (!confirm('Remove this semester and all its courses?')) return;
  await API.del(`/api/grades/semesters/${id}`);
  loadAll();
}

function renderSkills(skills) {
  document.getElementById('skill-bars').innerHTML = skills.map((s) => `
    <div class="skill-bar-row">
      <span class="name">${s.name}</span>
      <span class="skill-track"><span class="skill-fill" style="width:${s.pct}%"></span></span>
      <span class="pct">${s.pct}%</span>
    </div>
  `).join('');
}

function certStatusPill(v) {
  const cls = v.status;
  const label = v.status === 'verified' ? '✓ Verified' : v.status === 'suspicious' ? 'Suspicious' : 'Not verified';
  return `<span class="status-pill ${cls}">${label}</span>`;
}

function renderCertPreview(certificates) {
  const el = document.getElementById('cert-grid-preview');
  if (certificates.length === 0) { el.innerHTML = '<div class="empty-state">No certificates yet. <a href="certificates.html" style="color:var(--primary);">Upload one →</a></div>'; return; }
  el.innerHTML = certificates.slice(0, 3).map((c) => `
    <div class="cert-card">
      <div class="cert-thumb"><div class="ring"></div></div>
      <div class="cert-body">
        <h4 class="h3" style="font-size:0.92rem;">${c.filename}</h4>
        <p class="caption">${new Date(c.createdAt).toLocaleDateString()}</p>
        ${certStatusPill(c.verification)}
      </div>
    </div>
  `).join('');
}

function renderRecommendations(rec) {
  document.getElementById('rec-branch').textContent = rec.branch;
  const icons = ['!', '↗', '✎'];
  const items = [
    ...rec.skillGaps.map((s) => ({ title: s.title, detail: s.detail, tag: s.growth })),
    ...rec.eventRecs.map((e) => ({ title: e.title, detail: e.detail, tag: 'Event match' })),
    ...rec.resumeTips.map((r) => ({ title: r.title, detail: r.detail, tag: 'Resume tip' })),
  ];
  document.getElementById('rec-list').innerHTML = items.map((it, i) => `
    <div class="rec-item">
      <div class="rec-ic">${icons[i % icons.length]}</div>
      <div>
        <h4>${it.title}</h4>
        <p>${it.detail}</p>
        <span class="tag-trend">${it.tag}</span>
      </div>
    </div>
  `).join('') || '<div class="empty-state">Add grades and certificates to unlock personalized recommendations.</div>';
}

document.getElementById('logout-btn').addEventListener('click', () => {
  API.clearToken();
  window.location.href = 'index.html';
});

// ---------- Add Semester modal ----------
const modal = document.getElementById('modal');
document.getElementById('add-semester-btn').addEventListener('click', () => modal.classList.remove('hidden'));
document.getElementById('modal-close').addEventListener('click', () => modal.classList.add('hidden'));
modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// --- Manual entry ---
function gradeOptions(selected) {
  return currentScale.grades
    ? `<option value=""></option>` + currentScale.grades.map((g) => `<option ${g === selected ? 'selected' : ''}>${g}</option>`).join('')
    : `<input type="number" min="0" max="100" value="${selected || ''}">`;
}

function addManualRow(row = {}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input value="${row.course_code || ''}" class="m-code"></td>
    <td><input value="${row.course_name || ''}" class="m-name"></td>
    <td><input type="number" min="0" max="10" value="${row.credits ?? ''}" class="m-credits"></td>
    <td><select class="m-grade">${gradeOptions(row.grade)}</select></td>
    <td><button style="background:none;border:none;color:var(--error);cursor:pointer;" onclick="this.closest('tr').remove()">✕</button></td>
  `;
  document.getElementById('manual-rows').appendChild(tr);
}
document.getElementById('manual-add-row').addEventListener('click', () => addManualRow());
addManualRow(); addManualRow(); // start with two blank rows

// Courses saved without BOTH credits and a grade don't contribute to CGPA
// — the math is correct (nothing to average in), but saving them silently
// makes "add a semester" look like it did nothing to the CGPA number.
// Flag it explicitly, whichever piece is missing.
function warnIfMissingGrades(rows) {
  const missing = rows.filter((r) => !r.credits || !r.grade).length;
  if (missing > 0) {
    alert(`${missing} course(s) are missing credits and/or a grade — they were saved, but won't count toward your CGPA until both are filled in.`);
  }
}

document.getElementById('manual-save').addEventListener('click', async () => {
  const semester_name = document.getElementById('manual-sem-name').value.trim();
  if (!semester_name) return alert('Give this semester a name first.');
  const rows = [...document.querySelectorAll('#manual-rows tr')].map((tr) => ({
    course_code: tr.querySelector('.m-code').value || null,
    course_name: tr.querySelector('.m-name').value,
    credits: tr.querySelector('.m-credits').value === '' ? null : Number(tr.querySelector('.m-credits').value),
    grade: tr.querySelector('.m-grade').value || null,
  })).filter((r) => r.course_name.trim());

  if (rows.length === 0) return alert('Add at least one course.');
  try {
    const res = await API.post('/api/grades/confirm', { semester_name, courses: rows });
    if (res.warnings.length) alert(res.warnings.join('\n'));
    warnIfMissingGrades(rows);
    modal.classList.add('hidden');
    document.getElementById('manual-rows').innerHTML = '';
    document.getElementById('manual-sem-name').value = '';
    addManualRow(); addManualRow();
    loadAll();
  } catch (err) {
    alert(err.message);
  }
});

// --- shared preview renderer for paste + upload ---
function renderExtractPreview(container, data, onSaved) {
  const rows = data.courses || [];
  container.innerHTML = `
    ${data.warning ? `<div class="alert alert-error" style="margin-top:16px;">${data.warning}</div>` : ''}
    ${rows.length === 0 ? '' : `
    <div class="field" style="margin-top:16px;"><label>Semester name</label><input id="ep-sem-name" value="${data.semester_name || ''}" placeholder="e.g. Semester 5"></div>
    <table class="preview-table">
      <thead><tr><th>Code</th><th>Course name</th><th>Credits</th><th>Grade</th><th>Conf.</th><th></th></tr></thead>
      <tbody id="ep-rows">
        ${rows.map((r) => `
          <tr>
            <td><input value="${r.course_code || ''}" class="ep-code"></td>
            <td><input value="${r.course_name || ''}" class="ep-name"></td>
            <td><input type="number" min="0" max="10" value="${r.credits ?? ''}" class="ep-credits"></td>
            <td><select class="ep-grade">${gradeOptions(r.grade)}</select></td>
            <td>${r.confidence < 0.7 ? `<span class="chip-low">${Math.round(r.confidence * 100)}%</span>` : `${Math.round(r.confidence * 100)}%`}</td>
            <td><button style="background:none;border:none;color:var(--error);cursor:pointer;" onclick="this.closest('tr').remove()">✕</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="row-actions">
      <button class="btn btn-primary" id="ep-save">Save semester</button>
    </div>`}
  `;
  if (rows.length === 0) return;
  document.getElementById('ep-save').addEventListener('click', async () => {
    const semester_name = document.getElementById('ep-sem-name').value.trim();
    if (!semester_name) return alert('Give this semester a name first.');
    const finalRows = [...document.querySelectorAll('#ep-rows tr')].map((tr) => ({
      course_code: tr.querySelector('.ep-code').value || null,
      course_name: tr.querySelector('.ep-name').value,
      credits: tr.querySelector('.ep-credits').value === '' ? null : Number(tr.querySelector('.ep-credits').value),
      grade: tr.querySelector('.ep-grade').value || null,
    })).filter((r) => r.course_name.trim());
    try {
      const res = await API.post('/api/grades/confirm', { semester_name, courses: finalRows });
      if (res.warnings.length) alert(res.warnings.join('\n'));
      warnIfMissingGrades(finalRows);
      modal.classList.add('hidden');
      container.innerHTML = '';
      onSaved();
      loadAll();
    } catch (err) { alert(err.message); }
  });
}

// --- Paste & extract ---
document.getElementById('paste-extract').addEventListener('click', async () => {
  const text = document.getElementById('paste-text').value;
  if (!text.trim()) return alert('Paste some text first.');
  try {
    const data = await API.post('/api/grades/parse-text', { text });
    renderExtractPreview(document.getElementById('paste-preview'), data, () => { document.getElementById('paste-text').value = ''; });
  } catch (err) { alert(err.message); }
});

// --- Upload document ---
let chosenFile = null;
document.getElementById('dropzone').addEventListener('click', () => document.getElementById('doc-file').click());
document.getElementById('doc-file').addEventListener('change', (e) => {
  chosenFile = e.target.files[0];
  document.getElementById('doc-filename').textContent = chosenFile ? chosenFile.name : '';
});
document.getElementById('doc-extract').addEventListener('click', async () => {
  if (!chosenFile) return alert('Choose a file first.');
  const fd = new FormData();
  fd.append('file', chosenFile);
  try {
    const data = await API.postForm('/api/grades/parse-document', fd);
    renderExtractPreview(document.getElementById('doc-preview'), data, () => { chosenFile = null; document.getElementById('doc-filename').textContent = ''; document.getElementById('doc-file').value = ''; });
  } catch (err) { alert(err.message); }
});

loadAll();
