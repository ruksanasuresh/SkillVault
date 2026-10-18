// server/lib/gradeParser.js
//
// Extracts { semester_name, courses: [{course_code, course_name, grade,
// credits, confidence}] } from messy pasted/OCR'd text — VTOP dumps,
// copied tables, WhatsApp forwards, etc.
//
// This is a deterministic regex/heuristic engine so the module works with
// zero external services. To upgrade extraction quality, swap `extract()`
// for a call to an LLM using the same prompt documented in README.md and
// keep the return shape identical — nothing else in the app needs to change.

const KNOWN_GRADE_TOKENS = ['S', 'O', 'A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'P', 'F', 'N'];
const CODE_RE = /^[A-Z]{2,5}\d{3,5}[A-Z]?$/; // e.g. CSE3001, BCSE301L
const SEMESTER_RE = /(semester|sem)\s*[-:]?\s*(\d+|[IVXLC]+)|(fall|spring|winter|summer)[\s-]*\d{4}(-\d{2,4})?/i;

function findSemesterName(text) {
  const m = text.match(SEMESTER_RE);
  return m ? m[0].trim() : null;
}

function tokenizeLine(line) {
  // split on 2+ spaces, tabs, or " | " — covers pasted tables and plain lists
  return line.split(/\t+|\s{2,}|\s*\|\s*/).map((t) => t.trim()).filter(Boolean);
}

function looksLikeGrade(tok) {
  return KNOWN_GRADE_TOKENS.includes(tok.toUpperCase());
}

function looksLikeCredits(tok) {
  return /^\d(\.\d)?$/.test(tok) && Number(tok) >= 0 && Number(tok) <= 10;
}

function looksLikeCode(tok) {
  return CODE_RE.test(tok.toUpperCase());
}

function parseLine(line) {
  const raw = line.trim();
  if (!raw) return null;
  if (/^(course|sl\.?\s*no|s\.no|name|code)\b/i.test(raw)) return null; // header row
  if (/^page\s*\d+/i.test(raw)) return null; // footer/page number

  // Try whitespace-run tokenization first (covers table-style + VTOP-style single-space lines)
  let tokens = tokenizeLine(raw);
  if (tokens.length < 2) {
    tokens = raw.split(/\s+/);
  }
  if (tokens.length < 2) return null;

  let code = null;
  let grade = null;
  let credits = null;
  const nameParts = [];

  for (const tok of tokens) {
    const clean = tok.replace(/[,:]$/, '');
    if (!code && looksLikeCode(clean)) {
      code = clean.toUpperCase();
      continue;
    }
    if (!grade && looksLikeGrade(clean)) {
      grade = clean.toUpperCase();
      continue;
    }
    if (grade && credits === null && looksLikeCredits(clean)) {
      credits = Number(clean);
      continue;
    }
    if (!grade) nameParts.push(clean);
  }

  const name = nameParts.join(' ').replace(/\s{2,}/g, ' ').trim();
  if (!name) return null;
  if (!grade) return { course_code: code, course_name: name, grade: null, credits, confidence: 0.4 };

  let confidence = 0.6;
  if (code) confidence += 0.15;
  if (credits !== null) confidence += 0.15;
  if (name.split(' ').length >= 2) confidence += 0.1;

  return {
    course_code: code,
    course_name: name,
    grade,
    credits,
    confidence: Math.min(1, Math.round(confidence * 100) / 100),
  };
}

function extract(text) {
  const semester_name = findSemesterName(text);
  const lines = text.split(/\r?\n/);
  const courses = [];
  const seenCodes = new Set();

  for (const line of lines) {
    // skip the line the semester name itself came from, and any line that
    // is *only* a heading (no grade-like or code-like token in it)
    if (semester_name && line.includes(semester_name) && !KNOWN_GRADE_TOKENS.some((g) => new RegExp(`\\b${g.replace('+', '\\+')}\\b`).test(line))) {
      continue;
    }
    const row = parseLine(line);
    if (!row) continue;
    if (row.course_code) {
      if (seenCodes.has(row.course_code)) row.duplicate = true;
      seenCodes.add(row.course_code);
    }
    courses.push(row);
  }

  return { semester_name, courses };
}

module.exports = { extract };
