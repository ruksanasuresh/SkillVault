// server/routes/folders.js
const express = require('express');
const db = require('../lib/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const folders = db.filter('folders', (f) => f.userId === req.userId);
  const certs = db.filter('certificates', (c) => c.userId === req.userId);
  res.json({
    folders: folders.map((f) => ({ ...f, certificateCount: certs.filter((c) => c.folderId === f.id).length })),
  });
});

router.post('/', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Folder name is required' });
  const folder = db.insert('folders', { userId: req.userId, name: name.trim() });
  res.status(201).json({ folder });
});

router.put('/:id', requireAuth, (req, res) => {
  const folder = db.find('folders', (f) => f.id === req.params.id && f.userId === req.userId);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });
  const updated = db.update('folders', folder.id, { name: (req.body.name || folder.name).trim() });
  res.json({ folder: updated });
});

router.delete('/:id', requireAuth, (req, res) => {
  const folder = db.find('folders', (f) => f.id === req.params.id && f.userId === req.userId);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });
  db.remove('folders', folder.id);
  // certificates in the deleted folder fall back to Uncategorized (folderId: null)
  const certs = db.filter('certificates', (c) => c.folderId === folder.id);
  for (const c of certs) db.update('certificates', c.id, { folderId: null });
  res.json({ ok: true });
});

module.exports = router;
