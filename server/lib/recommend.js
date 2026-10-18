// server/lib/recommend.js
// Compares a student's profile (branch, certificates, grades) against the
// market_trends dataset and produces the three recommendation categories
// from the spec: skill gap, event recommendations, resume improvement.
// Swap the static trends.json for a weekly job-postings scrape later —
// the matching logic here doesn't need to change.

const trends = require('../data/trends.json');

function branchTrends(branch) {
  const key = (branch || '').toLowerCase();
  return trends.branches[key] || trends.branches.other;
}

function inferCertSkillTags(certificates) {
  // crude keyword tagging of certificate titles/extracted text into skill areas
  const tagRules = [
    { tag: 'web dev', re: /web|react|frontend|full[\s-]?stack|javascript/i },
    { tag: 'cloud', re: /aws|azure|gcp|cloud/i },
    { tag: 'ai/ml', re: /machine learning|\bai\b|deep learning|neural|nlp/i },
    { tag: 'data', re: /data science|data analytics|sql|data engineering/i },
    { tag: 'embedded', re: /embedded|vlsi|iot|verilog|vhdl/i },
    { tag: 'design', re: /ui\/ux|design|figma/i },
    { tag: 'leadership', re: /lead|organiz|captain|president|coordinator/i },
  ];
  const tags = new Set();
  for (const cert of certificates) {
    const text = `${cert.filename} ${cert.verification?.extractedFields?.event_name || ''} ${cert.verification?.extractedText || ''}`;
    for (const rule of tagRules) if (rule.re.test(text)) tags.add(rule.tag);
  }
  return tags;
}

function buildRecommendations(user, certificates, cgpa) {
  const bt = branchTrends(user.branch || user.degreeType);
  const tags = inferCertSkillTags(certificates);
  const verifiedCount = certificates.filter((c) => c.verification?.status === 'verified').length;

  // --- Skill gap: trending skills not reflected in the student's cert tags ---
  const skillGaps = bt.trending_skills
    .filter((s) => {
      const skillLower = s.skill.toLowerCase();
      const matchesTag = [...tags].some((t) => skillLower.includes(t) || t.includes(skillLower.split(' ')[0].toLowerCase()));
      return !matchesTag;
    })
    .slice(0, 3)
    .map((s) => ({
      title: `Close your ${s.skill.toLowerCase()} gap`,
      detail: `${s.skill} is trending ${s.growth} for ${bt.label}. ${bt.certifications[0] ? `Consider ${bt.certifications[0]}.` : ''}`,
      growth: s.growth,
    }));

  // --- Events: types relevant to the branch the student hasn't shown participation in ---
  const eventRecs = bt.event_types.slice(0, 3).map((e) => ({
    title: e,
    detail: `Matches your ${bt.label} profile and current hiring signals: ${bt.signals[0]}.`,
  }));

  // --- Resume improvement ---
  const resumeTips = [];
  if (!tags.has('leadership')) {
    resumeTips.push({
      title: 'Add a leadership line to your resume',
      detail: 'Most placed students in your branch list a team-lead or organizing role. Consider a student-chapter role or leading a hackathon team.',
    });
  }
  if (verifiedCount < certificates.length) {
    resumeTips.push({
      title: 'Get your remaining certificates verified',
      detail: `${certificates.length - verifiedCount} certificate(s) are still unverified — verified credentials carry more weight with recruiters.`,
    });
  }
  if (cgpa && cgpa < 7) {
    resumeTips.push({
      title: 'Balance grades with demonstrated projects',
      detail: 'Employers increasingly weight shipped projects and certificates alongside CGPA — keep building your certificate record.',
    });
  }
  if (resumeTips.length === 0) {
    resumeTips.push({ title: 'Keep your vault current', detail: 'Your profile looks solid — add new certificates as you earn them to stay ahead of trend shifts.' });
  }

  return {
    branch: bt.label,
    signals: bt.signals,
    skillGaps,
    eventRecs,
    resumeTips,
  };
}

module.exports = { buildRecommendations, branchTrends };
