// server/routes/profile.js
const express = require('express');
const db = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const { publicUser } = require('./auth');

const router = express.Router();

const ALLOWED_FIELDS = [
  'name', 'college', 'rollNumber', 'degreeType', 'branch', 'year',
  'bio', 'location', 'links', 'gradingScale', 'customScale',
];

router.put('/', requireAuth, (req, res) => {
  const patch = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in req.body) patch[key] = req.body[key];
  }
  const updated = db.update('users', req.userId, patch);
  if (!updated) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(updated) });
});

module.exports = router;
