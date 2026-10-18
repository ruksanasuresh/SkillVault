// server/lib/qr.js
// Decodes a QR code from a certificate. Images: read directly into a
// bitmap and scanned. PDFs: rasterized to an image first (via pdfjs-dist +
// node-canvas) since a QR code in a PDF is a graphic on the page, not
// something you can find by reading the text layer — that's a real gap an
// earlier version had (PDF certificates with a QR code, like NPTEL's, were
// never actually scanned for it and fell straight through to the much
// lower-confidence no-QR text heuristic).

const fs = require('fs');
const Jimp = require('jimp');
const jsQR = require('jsqr');

async function decodeQrFromImage(filePath) {
  try {
    const image = await Jimp.read(filePath);
    const { data, width, height } = image.bitmap;
    const result = jsQR(new Uint8ClampedArray(data), width, height);
    if (result && result.data) {
      return { found: true, url: result.data };
    }
    return { found: false };
  } catch (err) {
    return { found: false, error: err.message };
  }
}

async function decodeQrFromPdf(filePath) {
  try {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    const { createCanvas } = require('canvas');
    const data = new Uint8Array(fs.readFileSync(filePath));
    const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;

    // QR codes on certificates are essentially always on the first page;
    // checking a second page too is cheap insurance for multi-page PDFs.
    const pagesToCheck = Math.min(doc.numPages, 2);
    for (let i = 1; i <= pagesToCheck; i++) {
      const page = await doc.getPage(i);
      // Scale up — a QR code is often a small corner graphic, and jsQR
      // needs enough pixel resolution to resolve its modules.
      const viewport = page.getViewport({ scale: 2.5 });
      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
      if (result && result.data) {
        return { found: true, url: result.data };
      }
    }
    return { found: false };
  } catch (err) {
    return { found: false, error: err.message };
  }
}

module.exports = { decodeQrFromImage, decodeQrFromPdf };
