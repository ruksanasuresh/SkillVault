// server/routes/grades.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const { extract } = require('../lib/gradeParser');
const llm = require('../lib/llm');
const { extractText } = require('../lib/ocr');
const { isValidGrade, calcCgpa, getScale } = require('../lib/gradeScales');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'storage', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 15 * 1024 * 1024 } });

function currentUser(req) {
  return db.find('users', (u) => u.id === req.userId);
}

// --- list semesters + courses, with CGPA ---
router.get('/summary', requireAuth, (req, res) => {
  const user = currentUser(req);
  const semesters = db.filter('semesters', (s) => s.userId === req.userId);
  const courses = db.filter('courses', (c) => c.userId === req.userId);
  const withCourses = semesters
    .map((s) => {
      const semCourses = courses.filter((c) => c.semesterId === s.id);
      return { ...s, courses: semCourses, gpa: calcCgpa(user, semCourses) };
    })
    // newest semester first — the one you just added should be the one you see
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const cgpa = calcCgpa(user, courses);
  res.json({ semesters: withCourses, cgpa, scale: getScale(user) });
});

// --- manual entry: create semester ---
router.post('/semesters', requireAuth, (req, res) => {
  const { name, startDate, endDate } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Semester name is required' });
  const semester = db.insert('semesters', { userId: req.userId, name: name.trim(), startDate: startDate || null, endDate: endDate || null });
  res.status(201).json({ semester });
});

router.delete('/semesters/:id', requireAuth, (req, res) => {
  const sem = db.find('semesters', (s) => s.id === req.params.id && s.userId === req.userId);
  if (!sem) return res.status(404).json({ error: 'Semester not found' });
  db.remove('semesters', sem.id);
  db.removeWhere('courses', (c) => c.semesterId === sem.id);
  res.json({ ok: true });
});

// --- manual entry: add a course row (validated) ---
router.post('/semesters/:id/courses', requireAuth, (req, res) => {
  const user = currentUser(req);
  const sem = db.find('semesters', (s) => s.id === req.params.id && s.userId === req.userId);
  if (!sem) return res.status(404).json({ error: 'Semester not found' });

  const { code, name, credits, grade } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Course name is required' });
  if (credits !== null && credits !== undefined && (Number(credits) < 0 || Number(credits) > 10)) {
    return res.status(400).json({ error: 'Credits must be between 0 and 10' });
  }
  if (grade && !isValidGrade(user, grade)) {
    return res.status(400).json({ error: `"${grade}" is not valid for the ${getScale(user).label} scale` });
  }

  let warning = null;
  if (code) {
    const dup = db.find('courses', (c) => c.semesterId === sem.id && c.code === code);
    if (dup) warning = 'A course with this code already exists in this semester';
  }

  const course = db.insert('courses', {
    userId: req.userId, semesterId: sem.id, code: code || null, name: name.trim(),
    credits: credits === undefined || credits === null || credits === '' ? null : Number(credits),
    grade: grade || null,
  });
  res.status(201).json({ course, warning });
});

router.put('/courses/:id', requireAuth, (req, res) => {
  const user = currentUser(req);
  const course = db.find('courses', (c) => c.id === req.params.id && c.userId === req.userId);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const { code, name, credits, grade } = req.body;
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'Course name cannot be empty' });
  if (grade && !isValidGrade(user, grade)) return res.status(400).json({ error: `"${grade}" is not valid for the current grading scale` });
  if (credits !== undefined && credits !== null && (Number(credits) < 0 || Number(credits) > 10)) {
    return res.status(400).json({ error: 'Credits must be between 0 and 10' });
  }
  const updated = db.update('courses', course.id, {
    ...(code !== undefined && { code }),
    ...(name !== undefined && { name: name.trim() }),
    ...(credits !== undefined && { credits: credits === '' ? null : Number(credits) }),
    ...(grade !== undefined && { grade }),
  });
  res.json({ course: updated });
});

router.delete('/courses/:id', requireAuth, (req, res) => {
  const course = db.find('courses', (c) => c.id === req.params.id && c.userId === req.userId);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  db.remove('courses', course.id);
  res.json({ ok: true });
});

// --- Method 2: paste-parse (returns a preview only — nothing is saved) ---
router.post('/parse-text', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Paste some text to extract from' });
  // Uses Gemini or Claude (whichever key is set) when available; otherwise
  // falls back to the deterministic heuristic parser automatically.
  const llmResult = await llm.extractGrades(text);
  const preview = llmResult || extract(text);
  res.json({ ...preview, extractionMethod: llmResult ? `llm-${llm.activeProvider()}` : 'heuristic' });
});

// --- Method 3: document upload (PDF/image) -> extract text -> parse -> preview ---
router.post('/parse-document', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const { text, source } = await extractText(req.file.path, req.file.mimetype);
    fs.unlink(req.file.path, () => {}); // don't keep the transient upload
    if (!text || text.trim().length < 5) {
      return res.json({ semester_name: null, courses: [], source, warning: 'Could not read any text from this document — try pasting the text manually instead.' });
    }
    const llmResult = await llm.extractGrades(text);
    const preview = llmResult || extract(text);
    res.json({ ...preview, source, extractionMethod: llmResult ? `llm-${llm.activeProvider()}` : 'heuristic' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process document', detail: err.message });
  }
});

// --- confirm a parsed preview: save semester + rows in one go ---
router.post('/confirm', requireAuth, (req, res) => {
  const user = currentUser(req);
  const { semester_name, courses } = req.body;
  if (!semester_name || !Array.isArray(courses)) return res.status(400).json({ error: 'semester_name and courses[] are required' });

  const semester = db.insert('semesters', { userId: req.userId, name: semester_name, startDate: null, endDate: null });
  const saved = [];
  const warnings = [];
  const seenCodes = new Set();

  for (const row of courses) {
    if (!row.course_name || !row.course_name.trim()) { warnings.push(`Skipped a row with no course name`); continue; }
    if (row.grade && !isValidGrade(user, row.grade)) { warnings.push(`"${row.grade}" is not a valid grade — saved without a grade for ${row.course_name}`); row.grade = null; }
    if (row.course_code) {
      if (seenCodes.has(row.course_code)) warnings.push(`Duplicate course code ${row.course_code}`);
      seenCodes.add(row.course_code);
    }
    const credits = row.credits !== null && row.credits !== undefined && row.credits >= 0 && row.credits <= 10 ? Number(row.credits) : null;
    saved.push(db.insert('courses', {
      userId: req.userId, semesterId: semester.id, code: row.course_code || null,
      name: row.course_name.trim(), credits, grade: row.grade || null,
    }));
  }

  res.status(201).json({ semester, courses: saved, warnings });
});

module.exports = router;
