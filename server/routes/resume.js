// server/routes/resume.js
// One-click resume data: pulls the best, verified data the student already
// has into a single structured payload. The client renders it into a
// printable resume page (public/resume.html) — "Print > Save as PDF"
// stands in for server-side PDF generation in this prototype.
const express = require('express');
const db = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const { calcCgpa } = require('../lib/gradeScales');
const { skillGraph } = require('../lib/stats');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const user = db.find('users', (u) => u.id === req.userId);
  const semesters = db.filter('semesters', (s) => s.userId === req.userId);
  const courses = db.filter('courses', (c) => c.userId === req.userId);
  const certificates = db.filter('certificates', (c) => c.userId === req.userId);

  const cgpa = calcCgpa(user, courses);
  const verifiedCerts = certificates
    .filter((c) => c.verification?.status === 'verified')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const skills = skillGraph(certificates, courses).filter((s) => s.pct >= 40);

  res.json({
    profile: {
      name: user.name, email: user.email, college: user.college, degreeType: user.degreeType,
      branch: user.branch, year: user.year, bio: user.bio, location: user.location, links: user.links || {},
    },
    cgpa,
    semesters: semesters.map((s) => ({ name: s.name, courses: courses.filter((c) => c.semesterId === s.id) })),
    certificates: verifiedCerts.map((c) => ({
      filename: c.filename,
      event: c.verification?.extractedFields?.event_name || null,
      achievement: c.verification?.extractedFields?.position_achievement || null,
      date: c.verification?.extractedFields?.date || null,
    })),
    skills,
  });
});

module.exports = router;
