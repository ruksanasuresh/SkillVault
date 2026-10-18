// server/routes/certificates.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const { verifyCertificate } = require('../lib/verifyCert');

const router = express.Router();

const certDir = path.join(__dirname, '..', 'storage', 'uploads', 'certificates');
fs.mkdirSync(certDir, { recursive: true });
const upload = multer({
  dest: certDir,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Only PDF, PNG, JPEG or WEBP certificates are supported'), ok);
  },
});

function publicCert(c) {
  const { storedPath, ...rest } = c;
  return rest;
}

router.get('/', requireAuth, (req, res) => {
  const certs = db.filter('certificates', (c) => c.userId === req.userId);
  res.json({ certificates: certs.map(publicCert) });
});

router.post('/', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const otherCertificates = db.all('certificates');
    const verification = await verifyCertificate({
      filePath: req.file.path,
      mimeType: req.file.mimetype,
      userId: req.userId,
      otherCertificates,
    });

    const cert = db.insert('certificates', {
      userId: req.userId,
      folderId: req.body.folderId || null,
      filename: req.file.originalname,
      storedPath: req.file.path,
      mimeType: req.file.mimetype,
      size: req.file.size,
      hash: verification.hash,
      extractedText: verification.extractedText || null,
      verification: {
        status: verification.status,
        confidence: verification.confidence,
        method: verification.method,
        qrUrl: verification.qrUrl || null,
        issues: verification.issues || [],
        extractedFields: verification.extractedFields || {},
      },
    });
    res.status(201).json({ certificate: publicCert(cert) });
  } catch (err) {
    res.status(500).json({ error: 'Verification failed', detail: err.message });
  }
});

router.put('/:id/folder', requireAuth, (req, res) => {
  const cert = db.find('certificates', (c) => c.id === req.params.id && c.userId === req.userId);
  if (!cert) return res.status(404).json({ error: 'Certificate not found' });
  const updated = db.update('certificates', cert.id, { folderId: req.body.folderId || null });
  res.json({ certificate: publicCert(updated) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const cert = db.find('certificates', (c) => c.id === req.params.id && c.userId === req.userId);
  if (!cert) return res.status(404).json({ error: 'Certificate not found' });
  fs.unlink(cert.storedPath, () => {});
  db.remove('certificates', cert.id);
  res.json({ ok: true });
});

// re-open the original uploaded document (owner only)
router.get('/:id/file', requireAuth, (req, res) => {
  const cert = db.find('certificates', (c) => c.id === req.params.id && c.userId === req.userId);
  if (!cert || !fs.existsSync(cert.storedPath)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', cert.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${cert.filename}"`);
  fs.createReadStream(cert.storedPath).pipe(res);
});

// public verification lookup — what a recruiter sees after scanning a QR / opening a share link.
// No auth: only exposes verification status + hash + non-sensitive extracted fields.
router.get('/:id/verify-info', (req, res) => {
  const cert = db.find('certificates', (c) => c.id === req.params.id);
  if (!cert) return res.status(404).json({ error: 'Certificate not found' });
  const owner = db.find('users', (u) => u.id === cert.userId);
  res.json({
    filename: cert.filename,
    hash: cert.hash,
    uploadedAt: cert.createdAt,
    ownerName: owner ? owner.name : 'Unknown',
    verification: cert.verification,
  });
});

module.exports = router;
