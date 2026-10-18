// server/lib/gradeScales.js
// Grading scale definitions used for validation + CGPA calculation.

const SCALES = {
  vit: { label: 'VIT grading (S–F)', grades: ['S', 'A+', 'A', 'B+', 'B', 'C', 'P', 'F', 'N'],
    points: { S: 10, 'A+': 9, A: 8, 'B+': 7, B: 6, C: 5, P: 4, F: 0, N: 0 } },
  tenpoint: { label: '10-point CGPA (O–F)', grades: ['O', 'A+', 'A', 'B+', 'B', 'C', 'P', 'F'],
    points: { O: 10, 'A+': 9, A: 8, 'B+': 7, B: 6, C: 5, P: 4, F: 0 } },
  percentage: { label: 'Percentage (0–100)', grades: null, isNumeric: true, min: 0, max: 100 },
  letter: { label: 'Letter (A–F)', grades: ['A', 'B', 'C', 'D', 'F'],
    points: { A: 4, B: 3, C: 2, D: 1, F: 0 } },
};

function getScale(user) {
  if (user.gradingScale === 'custom' && user.customScale) {
    return { label: 'Custom scale', grades: Object.keys(user.customScale.points), points: user.customScale.points };
  }
  return SCALES[user.gradingScale] || SCALES.vit;
}

function isValidGrade(user, grade) {
  const scale = getScale(user);
  if (scale.isNumeric) {
    const n = Number(grade);
    return !Number.isNaN(n) && n >= scale.min && n <= scale.max;
  }
  return scale.grades.includes(grade);
}

// Weighted CGPA across a list of courses ({ grade, credits }).
function calcCgpa(user, courses) {
  const scale = getScale(user);
  let totalPoints = 0;
  let totalCredits = 0;
  for (const c of courses) {
    const credits = Number(c.credits) || 0;
    if (credits <= 0) continue;
    let point;
    if (scale.isNumeric) {
      point = (Number(c.grade) / 100) * 10; // normalize percentage to a 10-point equivalent
    } else {
      point = scale.points[c.grade];
    }
    if (point === undefined || point === null) continue;
    totalPoints += point * credits;
    totalCredits += credits;
  }
  if (totalCredits === 0) return 0;
  return Math.round((totalPoints / totalCredits) * 100) / 100;
}

module.exports = { SCALES, getScale, isValidGrade, calcCgpa };
