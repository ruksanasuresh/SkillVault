// server/lib/ocr.js
// Best-effort text extraction so the verification pipeline has something to
// read. PDFs: text layer via pdfjs-dist (fast, no OCR needed for text-based/
// exported PDFs). Images: OCR via tesseract.js (pure JS/WASM). The English
// language data is bundled in server/tessdata/ (see README), so this runs
// fully offline — no CDN call, no internet required at runtime at all.

const fs = require('fs');
const path = require('path');

const TESSDATA_DIR = path.join(__dirname, '..', 'tessdata');
const BUNDLED_LANG_FILE = path.join(TESSDATA_DIR, 'eng.traineddata');

async function extractFromPdf(filePath) {
  try {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    const data = new Uint8Array(fs.readFileSync(filePath));
    const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it) => it.str).join(' ') + '\n';
    }
    return { text, source: 'pdf-text' };
  } catch (err) {
    return { text: '', source: 'pdf-text-failed', error: err.message };
  }
}

// Once OCR fails, don't keep retrying on every subsequent upload — back off
// for a few minutes and degrade straight to "OCR unavailable". With the
// language data bundled locally this should only ever fire on a genuinely
// broken install (missing/corrupt tessdata file), not a network hiccup.
let ocrUnavailableUntil = 0;

async function extractFromImage(filePath) {
  if (Date.now() < ocrUnavailableUntil) {
    return { text: '', source: 'ocr-unavailable', error: 'OCR is temporarily unavailable (recent failure) — try again in a few minutes' };
  }
  let worker;
  try {
    const { createWorker } = require('tesseract.js');
    const hasBundledData = fs.existsSync(BUNDLED_LANG_FILE);

    const withTimeout = (p, ms) => Promise.race([
      p,
      new Promise((_, reject) => setTimeout(() => reject(new Error('OCR timed out')), ms)),
    ]);

    // Use the bundled language file when present (fully offline, no
    // network call at all). Only falls back to tesseract.js's default
    // CDN-fetch behavior if someone removed server/tessdata/ — the
    // timeout above still protects that fallback path.
    const workerOptions = hasBundledData
      ? { langPath: TESSDATA_DIR, gzip: false, cachePath: TESSDATA_DIR }
      : {};

    worker = await withTimeout(createWorker('eng', 1, workerOptions), hasBundledData ? 15000 : 20000);
    const { data } = await withTimeout(worker.recognize(filePath), 30000);
    await worker.terminate();
    return { text: data.text || '', source: 'ocr', ocrConfidence: (data.confidence || 0) / 100 };
  } catch (err) {
    if (worker) { try { await worker.terminate(); } catch { /* already gone */ } }
    ocrUnavailableUntil = Date.now() + 5 * 60 * 1000; // back off 5 minutes
    return { text: '', source: 'ocr-failed', error: err.message };
  }
}

async function extractText(filePath, mimeType) {
  const ext = path.extname(filePath).toLowerCase();
  if (mimeType === 'application/pdf' || ext === '.pdf') {
    return extractFromPdf(filePath);
  }
  if (mimeType?.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    return extractFromImage(filePath);
  }
  return { text: '', source: 'unsupported' };
}

module.exports = { extractText };
