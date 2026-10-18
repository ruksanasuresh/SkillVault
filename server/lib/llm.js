// server/lib/llm.js
//
// Optional upgrade path: if the person running this app sets a
// GEMINI_API_KEY or ANTHROPIC_API_KEY, grade extraction (paste/upload),
// certificate content verification, and recommendations use a real LLM
// call instead of the regex/heuristic engines in gradeParser.js,
// verifyCert.js and recommend.js. Without either key, every function here
// returns null and the callers fall back to the heuristics automatically —
// the app works exactly as before out of the box.
//
// Two providers are supported, auto-detected from whichever key is set:
//   - Gemini (Google) — has a genuine free tier, no billing required.
//     Get a key at https://aistudio.google.com/apikey
//   - Claude (Anthropic) — no permanent free tier, pay-as-you-go.
// If both keys are set, Gemini is preferred (it's free); set LLM_PROVIDER
// in .env to "anthropic" to force Claude instead.

let GoogleGenAI = null;
try { ({ GoogleGenAI } = require('@google/genai')); } catch { /* not installed */ }
let Anthropic = null;
try { Anthropic = require('@anthropic-ai/sdk'); } catch { /* not installed */ }

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

function activeProvider() {
  const forced = process.env.LLM_PROVIDER?.toLowerCase();
  const hasGemini = !!(GoogleGenAI && process.env.GEMINI_API_KEY);
  const hasClaude = !!(Anthropic && process.env.ANTHROPIC_API_KEY);
  if (forced === 'gemini' && hasGemini) return 'gemini';
  if (forced === 'anthropic' && hasClaude) return 'anthropic';
  if (hasGemini) return 'gemini'; // preferred — free tier
  if (hasClaude) return 'anthropic';
  return null;
}

function isAvailable() {
  return activeProvider() !== null;
}

let geminiClient = null;
function getGeminiClient() {
  if (!geminiClient) geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return geminiClient;
}

let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropicClient;
}

// Pulls the first {...} block out of a text reply — the model is asked to
// return only JSON, but this is a cheap safety net against stray preamble
// (Gemini in particular sometimes wraps JSON in ```json fences despite
// being told not to).
function extractJson(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

// One entry point for every feature function below — dispatches to
// whichever provider is configured. maxTokens is only meaningful for
// Claude (Gemini's SDK doesn't take an equivalent cap the same way).
async function callModel(prompt, maxTokens) {
  const provider = activeProvider();
  if (provider === 'gemini') {
    const res = await getGeminiClient().models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });
    return res.text || '';
  }
  if (provider === 'anthropic') {
    const res = await getAnthropicClient().messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    const textBlock = res.content.find((b) => b.type === 'text');
    return textBlock ? textBlock.text : '';
  }
  throw new Error('No LLM provider configured');
}

async function extractGrades(text) {
  if (!isAvailable()) return null;
  const prompt = `You are a grade extraction engine. Extract all courses and grades from the text below.

Return ONLY valid JSON in this exact schema, nothing else — no preamble, no markdown fences:
{
  "semester_name": "string or null",
  "courses": [
    {
      "course_code": "string or null",
      "course_name": "string",
      "grade": "string or null",
      "credits": number or null,
      "confidence": 0.0-1.0
    }
  ]
}

Rules:
- If a grade is missing for a course, set grade to null.
- Keep grades as they appear (e.g. "S", "A+", "A", "B+", "B", "C", "P", "F", "O", or a percentage/number) — do not invent or renormalize them.
- If credits are not present, set to null.
- Do NOT invent course codes.
- If the text has no courses, return an empty array.
- Ignore headers, footers, and page numbers.

TEXT:
"""
${text.slice(0, 6000)}
"""`;

  try {
    const raw = await callModel(prompt, 1500);
    const parsed = extractJson(raw);
    if (!parsed || !Array.isArray(parsed.courses)) return null;
    return parsed;
  } catch (err) {
    console.error('[llm] grade extraction failed, falling back to the heuristic parser:', err.message);
    return null;
  }
}

async function verifyCertificateContent(text) {
  if (!isAvailable()) return null;
  const prompt = `Analyze this certificate text for authenticity. Return ONLY valid JSON, nothing else — no preamble, no markdown fences:

{
  "is_authentic": true or false,
  "confidence": 0.0-1.0,
  "issues": ["list of concerns, empty array if none"],
  "extracted_fields": {
    "recipient_name": "string or null",
    "event_name": "string or null",
    "organization": "string or null",
    "date": "string or null",
    "position_achievement": "string or null"
  }
}

Look for:
- Certificate-like language and structure (certify / awarded / completion / participation)
- Missing standard fields (recipient, event, date, issuing organization)
- Content that contradicts itself
- Text that reads as generated or fabricated rather than a real certificate

This is text extracted via OCR/PDF parsing, so minor spacing or character errors are normal and not themselves a sign of forgery.

TEXT:
"""
${text.slice(0, 6000)}
"""`;

  try {
    const raw = await callModel(prompt, 800);
    const parsed = extractJson(raw);
    if (!parsed || typeof parsed.confidence !== 'number') return null;
    return parsed;
  } catch (err) {
    console.error('[llm] certificate verification failed, falling back to heuristic scoring:', err.message);
    return null;
  }
}

// Personalized skill-gap / event / resume recommendations, reasoned from
// the student's actual grades and certificates against current branch
// trends — this is the "pass both student profile + current trends to the
// LLM" step from the original spec. `bt` is a branch-trends object from
// recommend.js's branchTrends() (label, signals, trending_skills,
// certifications, event_types). Returns null (→ caller falls back to the
// rule-based tag-matching in recommend.js) if no key or the call fails.
async function generateRecommendations({ user, certificates, courses, cgpa, bt }) {
  if (!isAvailable()) return null;

  const certList = certificates.length
    ? certificates.map((c) => {
        const f = c.verification?.extractedFields || {};
        const label = f.event_name || c.filename;
        const achievement = f.position_achievement ? ` (${f.position_achievement})` : '';
        return `- ${label}${achievement} [${c.verification?.status || 'unknown'}]`;
      }).join('\n')
    : '(none yet)';

  const courseList = courses.length
    ? courses.map((c) => `- ${c.name}${c.grade ? ` (${c.grade})` : ''}`).join('\n')
    : '(none recorded yet)';

  const trendSkills = bt.trending_skills.map((s) => `${s.skill} (${s.growth})`).join(', ');

  const prompt = `You are a career advisor for engineering students in India.

STUDENT PROFILE:
- Degree/branch: ${user.degreeType || 'unspecified'} — ${bt.label}
- Year of graduation: ${user.year || 'unspecified'}
- CGPA: ${cgpa}
- Certificates:
${certList}
- Courses taken:
${courseList}

CURRENT MARKET TRENDS for ${bt.label}:
- Signals: ${bt.signals.join('; ')}
- Trending skills: ${trendSkills}
- Recommended certifications: ${bt.certifications.join(', ')}
- Relevant event types: ${bt.event_types.join(', ')}

TASK:
Compare this student's actual profile above against the current market
trends and write personalized, specific recommendations — not generic
advice. Reference what they actually have, or are actually missing, by
name where it makes sense.

Return ONLY valid JSON, nothing else — no preamble, no markdown fences:
{
  "skillGaps": [{"title": "short title", "detail": "1-2 sentences, specific to this student", "growth": "e.g. +40% or empty string"}],
  "eventRecs": [{"title": "event or opportunity name", "detail": "why it specifically fits this student"}],
  "resumeTips": [{"title": "short title", "detail": "specific, actionable resume advice for this student"}]
}

Up to 3 items per category.`;

  try {
    const raw = await callModel(prompt, 1200);
    const parsed = extractJson(raw);
    if (!parsed || !Array.isArray(parsed.skillGaps)) return null;
    return {
      skillGaps: parsed.skillGaps || [],
      eventRecs: parsed.eventRecs || [],
      resumeTips: parsed.resumeTips || [],
    };
  } catch (err) {
    console.error('[llm] recommendation generation failed, falling back to rule-based recommendations:', err.message);
    return null;
  }
}

module.exports = { isAvailable, activeProvider, extractGrades, verifyCertificateContent, generateRecommendations };
