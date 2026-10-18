// server/routes/recommendations.js
const express = require('express');
const db = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const { buildRecommendations, branchTrends } = require('../lib/recommend');
const { calcCgpa } = require('../lib/gradeScales');
const { peerBenchmark, skillGraph } = require('../lib/stats');
const llm = require('../lib/llm');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const user = db.find('users', (u) => u.id === req.userId);
  const certificates = db.filter('certificates', (c) => c.userId === req.userId);
  const courses = db.filter('courses', (c) => c.userId === req.userId);
  const cgpa = calcCgpa(user, courses);

  const bt = branchTrends(user.branch || user.degreeType);
  // Real Claude call when ANTHROPIC_API_KEY is set (reasons over the
  // student's actual grades/certificates against current trends); falls
  // back automatically to the rule-based tag-matching in recommend.js
  // otherwise, or if the call fails for any reason.
  const llmResult = await llm.generateRecommendations({ user, certificates, courses, cgpa, bt });
  const recommendations = llmResult
    ? { branch: bt.label, signals: bt.signals, ...llmResult }
    : buildRecommendations(user, certificates, cgpa);

  const benchmark = peerBenchmark(user);
  const skills = skillGraph(certificates, courses);

  res.json({ recommendations, benchmark, skills, cgpa, recommendationMethod: llmResult ? `llm-${llm.activeProvider()}` : 'heuristic' });
});

module.exports = router;
