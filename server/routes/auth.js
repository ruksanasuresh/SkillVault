// server/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

const STRENGTH_RULES = {
  basic: { re: /^.{8,}$/, label: 'At least 8 characters' },
  medium: { re: /^(?=.*[A-Za-z])(?=.*\d).{8,}$/, label: '8+ characters, at least 1 letter and 1 number' },
  strong: { re: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/, label: '8+ characters, upper, lower, number, symbol' },
  extra: { re: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/, label: 'Strong rules + breach check' },
};

async function isPwned(password) {
  // k-anonymity check against Have I Been Pwned — best-effort, never blocks
  // signup if the network call fails (e.g. offline dev environment).
  try {
    const crypto = require('crypto');
    const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return false;
    const text = await res.text();
    return text.split('\n').some((line) => line.split(':')[0].trim() === suffix);
  } catch {
    return false; // fail open — don't block registration if the check errors out
  }
}

router.post('/register', async (req, res) => {
  const { email, password, name, passwordLevel = 'medium', college, rollNumber, degreeType, branch, year, gradingScale = 'vit' } = req.body;

  if (!email || !password || !name) return res.status(400).json({ error: 'Name, email and password are required' });
  if (db.find('users', (u) => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const rule = STRENGTH_RULES[passwordLevel] || STRENGTH_RULES.medium;
  if (!rule.re.test(password)) {
    return res.status(400).json({ error: `Password does not meet the "${passwordLevel}" rule: ${rule.label}` });
  }
  if (passwordLevel === 'extra' && (await isPwned(password))) {
    return res.status(400).json({ error: 'This password has appeared in a known data breach. Choose a different one.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = db.insert('users', {
    email, passwordHash, name, college: college || null, rollNumber: rollNumber || null,
    degreeType: degreeType || null, branch: branch || null, year: year || null,
    bio: null, location: null, links: {}, gradingScale, customScale: null,
  });

  const token = signToken(user.id);
  res.status(201).json({ token, user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.find('users', (u) => u.email.toLowerCase() === (email || '').toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  const ok = await bcrypt.compare(password || '', user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
  const token = signToken(user.id);
  res.json({ token, user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.find('users', (u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(user) });
});

router.get('/colleges', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const list = require('../data/colleges.json');
  res.json(q ? list.filter((c) => c.toLowerCase().includes(q)) : list.slice(0, 10));
});

function publicUser(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}

module.exports = { router, publicUser };
