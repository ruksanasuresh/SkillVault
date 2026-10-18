// server/lib/verifyCert.js
//
// Rule-based approximation of the verification pipeline described in the
// spec. It follows the same decision table:
//
//   QR found + URL reachable                       -> verified
//   QR found + URL unreachable                      -> suspicious
//   No QR + confidence > 0.8, no issues              -> verified
//   No QR + confidence 0.5–0.8                       -> suspicious
//   No QR + confidence < 0.5, has issues              -> not_verified
//   Near-duplicate of another user's certificate     -> suspicious
//
// The "no QR" branch uses a real Claude call (see server/lib/llm.js) when
// ANTHROPIC_API_KEY is set, and falls back automatically to the
// explainable keyword/field heuristics below (`scoreContent`/
// `extractFields`) when it isn't — so this works out of the box with zero
// API keys, and upgrades itself the moment a key is added.

const crypto = require('crypto');
const fs = require('fs');
const { decodeQrFromImage, decodeQrFromPdf } = require('./qr');
const { extractText } = require('./ocr');
const { similarity } = require('./similarity');
const llm = require('./llm');

const URL_RE = /https?:\/\/[^\s"'<>]+/i;
const EXPECTED_KEYWORDS = ['certify', 'certificate', 'awarded', 'completion', 'participation', 'presented', 'achievement'];

function hashFile(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function extractFields(text) {
  const fields = { recipient_name: null, event_name: null, organization: null, date: null, position_achievement: null };

  // Trailing run of capitalized "proper noun" words immediately before `idx` in `text`.
  function capitalizedRunBefore(str, idx) {
    const before = str.slice(0, idx);
    const m = before.match(/(?:[A-Z][a-zA-Z.']*\s+){0,4}[A-Z][a-zA-Z.']*\s*$/);
    return m ? m[0].trim() : null;
  }
  // Run of capitalized words right after `idx`.
  function capitalizedRunAfter(str, idx) {
    const after = str.slice(idx);
    const m = after.match(/^\s*(?:[A-Z][a-zA-Z.']*\s+){0,4}[A-Z][a-zA-Z.']*/);
    return m ? m[0].trim() : null;
  }

  const nameKw = text.match(/certify that|presented to|awarded to/i);
  if (nameKw) {
    const after = capitalizedRunAfter(text, nameKw.index + nameKw[0].length);
    if (after) fields.recipient_name = after;
  }

  const dateMatch = text.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4})\b/i);
  if (dateMatch) fields.date = dateMatch[0];

  const eventKw = text.match(/hackathon|workshop|bootcamp|summit|challenge|competition|conference/i);
  if (eventKw) {
    const before = capitalizedRunBefore(text, eventKw.index) || '';
    fields.event_name = `${before} ${eventKw[0]}`.trim();
  }

  const achievementMatch = text.match(/(winner|runner[\s-]?up|finalist|1st place|2nd place|3rd place|participant|merit)/i);
  if (achievementMatch) fields.position_achievement = achievementMatch[0];

  const orgKw = text.match(/organized by|hosted by/i);
  if (orgKw) {
    const after = capitalizedRunAfter(text, orgKw.index + orgKw[0].length);
    if (after) fields.organization = after;
  }

  return fields;
}

function scoreContent(text, fields, ocrConfidence) {
  const issues = [];
  let score = 0.15; // base

  const lower = text.toLowerCase();
  const keywordHits = EXPECTED_KEYWORDS.filter((k) => lower.includes(k)).length;
  score += Math.min(0.3, keywordHits * 0.08);
  if (keywordHits === 0) issues.push('No certificate-like language found in the document');

  const fieldsFound = Object.values(fields).filter(Boolean).length;
  score += Math.min(0.35, fieldsFound * 0.09);
  if (fieldsFound < 2) issues.push('Could not confidently extract recipient/event/date fields');

  if (text.trim().length < 40) issues.push('Very little readable text found in the document');
  else score += 0.1;

  if (typeof ocrConfidence === 'number') {
    score += (ocrConfidence - 0.5) * 0.2; // OCR confidence nudges score
    if (ocrConfidence < 0.4) issues.push('Low OCR confidence on the scanned image');
  }

  return { confidence: Math.max(0, Math.min(1, Math.round(score * 100) / 100)), issues };
}

async function checkUrlReachable(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

async function verifyCertificate({ filePath, mimeType, userId, otherCertificates }) {
  const hash = hashFile(filePath);

  // exact duplicate (same file uploaded before, possibly by someone else)
  const exactDuplicate = otherCertificates.find((c) => c.hash === hash && c.userId !== userId);
  if (exactDuplicate) {
    return {
      status: 'suspicious',
      confidence: 0.9,
      method: 'duplicate-hash',
      hash,
      issues: ['Identical file already uploaded by another user'],
      extractedFields: {},
    };
  }

  let qrResult = { found: false };
  if (mimeType?.startsWith('image/')) {
    qrResult = await decodeQrFromImage(filePath);
  } else if (mimeType === 'application/pdf') {
    // A QR code in a PDF is a graphic on the rendered page, not text — it
    // has to be rasterized and scanned the same way an image would be.
    // (This is the fix for PDF certificates like NPTEL's, whose QR code
    // was previously never even looked at.)
    qrResult = await decodeQrFromPdf(filePath);
  }

  // Skip text extraction (and therefore OCR) entirely once a QR code is
  // found — the QR branch below decides status from reachability alone
  // and never reads `extracted`, so running OCR/PDF-text here was pure
  // risk (network dependency, time) for zero benefit.
  const needsTextExtraction = !qrResult.found;
  const extracted = needsTextExtraction ? await extractText(filePath, mimeType) : { text: '', source: 'skipped-qr-found' };
  let qrUrl = qrResult.found ? qrResult.url : null;

  // PDF fallback: no image-based QR scan, so look for an embedded verify URL in the text layer
  if (!qrUrl && extracted.text) {
    const urlMatch = extracted.text.match(URL_RE);
    if (urlMatch) qrUrl = urlMatch[0];
  }

  const fields = extractFields(extracted.text || '');

  // near-duplicate text check against other users' certificates
  let textDuplicateOf = null;
  if (extracted.text && extracted.text.length > 30) {
    for (const c of otherCertificates) {
      if (c.userId === userId || !c.extractedText) continue;
      const sim = similarity(extracted.text, c.extractedText);
      if (sim > 0.95) { textDuplicateOf = c.id; break; }
    }
  }

  if (textDuplicateOf) {
    return {
      status: 'suspicious',
      confidence: 0.85,
      method: 'duplicate-text',
      hash,
      qrUrl,
      issues: ['Near-identical content to another user\'s certificate — flagged for admin review'],
      extractedFields: fields,
      extractedText: extracted.text?.slice(0, 4000),
    };
  }

  if (qrUrl) {
    const reachable = await checkUrlReachable(qrUrl);
    return {
      status: reachable ? 'verified' : 'suspicious',
      confidence: reachable ? 0.95 : 0.4,
      method: 'qr',
      hash,
      qrUrl,
      issues: reachable ? [] : ['QR/embedded verification URL is unreachable or invalid'],
      extractedFields: fields,
      extractedText: extracted.text?.slice(0, 4000),
    };
  }

  // Try a real Claude call first (if ANTHROPIC_API_KEY is set); fall back
  // to the heuristic scorer automatically otherwise. Either way the shape
  // returned to the caller is identical.
  const llmVerdict = await llm.verifyCertificateContent(extracted.text || '');
  let confidence, issues, resolvedFields, method;
  if (llmVerdict) {
    confidence = llmVerdict.confidence;
    issues = llmVerdict.issues || [];
    resolvedFields = { ...fields, ...llmVerdict.extracted_fields };
    method = `llm-${llm.activeProvider()}`;
  } else {
    const scored = scoreContent(extracted.text || '', fields, extracted.ocrConfidence);
    confidence = scored.confidence;
    issues = scored.issues;
    resolvedFields = fields;
    method = extracted.source || 'content-heuristic';
  }

  let status;
  if (confidence > 0.8 && issues.length === 0) status = 'verified';
  else if (confidence >= 0.5) status = 'suspicious';
  else status = 'not_verified';

  return {
    status,
    confidence,
    method,
    hash,
    qrUrl: null,
    issues,
    extractedFields: resolvedFields,
    extractedText: extracted.text?.slice(0, 4000),
  };
}

module.exports = { verifyCertificate, hashFile, extractFields };
