// server/lib/similarity.js
// Dice coefficient over bigrams — a dependency-free stand-in for
// difflib.SequenceMatcher, used to flag near-duplicate certificate text.

function bigrams(str) {
  const s = str.toLowerCase().replace(/\s+/g, ' ').trim();
  const grams = [];
  for (let i = 0; i < s.length - 1; i++) grams.push(s.substring(i, i + 2));
  return grams;
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const g1 = bigrams(a);
  const g2 = bigrams(b);
  if (g1.length === 0 || g2.length === 0) return 0;
  const map = new Map();
  for (const g of g1) map.set(g, (map.get(g) || 0) + 1);
  let matches = 0;
  for (const g of g2) {
    const count = map.get(g) || 0;
    if (count > 0) {
      matches++;
      map.set(g, count - 1);
    }
  }
  return (2 * matches) / (g1.length + g2.length);
}

module.exports = { similarity };
