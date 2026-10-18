// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { router: authRouter } = require('./routes/auth');
const profileRouter = require('./routes/profile');
const gradesRouter = require('./routes/grades');
const foldersRouter = require('./routes/folders');
const certificatesRouter = require('./routes/certificates');
const recommendationsRouter = require('./routes/recommendations');
const resumeRouter = require('./routes/resume');

// Safety net: a third-party async error (e.g. tesseract.js failing to fetch
// its language data over a flaky/blocked network) can otherwise throw
// outside any request's promise chain and kill the whole process, taking
// down every user's session. Log it and keep the server alive instead.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException — server continues]', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection — server continues]', err);
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);
app.use('/api/grades', gradesRouter);
app.use('/api/folders', foldersRouter);
app.use('/api/certificates', certificatesRouter);
app.use('/api/recommendations', recommendationsRouter);
app.use('/api/resume', resumeRouter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'), (err) => { if (err) next(); });
});

// central error handler (multer file-type errors etc.)
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || 'Something went wrong' });
  next();
});

app.listen(PORT, () => {
  console.log(`SkillVault running at http://localhost:${PORT}`);
});
