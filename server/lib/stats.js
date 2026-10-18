// server/lib/stats.js
const db = require('./db');
const { calcCgpa } = require('./gradeScales');

// percentile rank of `value` within `values` (higher value = higher percentile)
function percentileRank(values, value) {
  if (values.length === 0) return null;
  const below = values.filter((v) => v < value).length;
  return Math.round((below / values.length) * 100);
}

function peerBenchmark(user) {
  const peers = db.filter('users', (u) => u.branch === user.branch && u.branch);
  const certs = db.all('certificates');

  const certCounts = peers.map((p) => certs.filter((c) => c.userId === p.id).length);
  const myCertCount = certs.filter((c) => c.userId === user.id).length;
  const certPercentile = percentileRank(certCounts, myCertCount);

  const cgpas = peers.map((p) => {
    const courses = db.filter('courses', (c) => c.userId === p.id);
    return calcCgpa(p, courses);
  });
  const myCourses = db.filter('courses', (c) => c.userId === user.id);
  const myCgpa = calcCgpa(user, myCourses);
  const cgpaPercentile = percentileRank(cgpas, myCgpa);

  return {
    peerCount: peers.length,
    certificatePercentile: certPercentile,
    cgpaPercentile,
  };
}

// crude skill-graph: percentage coverage per skill area, from certificate
// tags + course names. Deterministic and explainable, not ML-based.
function skillGraph(certificates, courses) {
  const AREAS = {
    'Data Structures': /data structures|algorithms|dsa/i,
    'Web Development': /web|react|frontend|full[\s-]?stack|javascript/i,
    'Cloud / DevOps': /cloud|aws|azure|gcp|devops|docker|kubernetes/i,
    'Machine Learning': /machine learning|\bai\b|deep learning|neural|nlp/i,
    'Systems Design': /system design|networks|operating systems|distributed/i,
  };
  const corpus = [
    ...certificates.map((c) => `${c.filename} ${c.verification?.extractedFields?.event_name || ''}`),
    ...courses.map((c) => c.name),
  ].join(' ');

  const result = [];
  for (const [area, re] of Object.entries(AREAS)) {
    const hits = (corpus.match(new RegExp(re, 'gi')) || []).length;
    const pct = Math.min(95, 20 + hits * 18); // baseline 20%, grows with evidence, caps at 95%
    result.push({ name: area, pct: hits > 0 ? pct : Math.max(10, pct - 15) });
  }
  return result;
}

module.exports = { peerBenchmark, skillGraph, percentileRank };
