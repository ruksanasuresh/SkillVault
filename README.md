# SkillVault

A working credential and certificate management platform: auth, a three-method
grades module, a certificate upload + verification pipeline, a trend-aware
recommendation engine, and one-click resume generation — running on a small
Node/Express backend with zero external services required to start it up.

## Run it

```bash
npm install
npm start
```

Open **http://localhost:3000**. That's it — no database server, no API keys,
no Docker. Data is stored in `server/data/db.json` (a JSON file) and uploaded
files in `server/storage/uploads/`.

Requires **Node 18+** (uses the built-in `fetch`). Copy `.env.example` to
`.env` if you want to set a real `JWT_SECRET` or a different `PORT`.

**One dependency needs a native build:** `canvas` (used to rasterize PDF
pages for QR-code scanning) ships prebuilt binaries for the common
platforms, so `npm install` should just work. If it doesn't on your machine,
it needs Python and a C/C++ compiler to build from source — see
[node-canvas's install guide](https://github.com/Automattic/node-canvas#installation)
for your OS. Everything else in this project is pure JS with no build step.

To open it in VS Code: unzip, `File → Open Folder`, then use the built-in
terminal for the commands above. A `Live Server`-style extension isn't needed
— this is a real backend, not a static site.

## What's implemented (all of it — not stubs)

### Registration & secure auth
- Email/password signup with 4 selectable password-strength tiers (Basic /
  Medium / Strong / Extra), the last of which checks the password against
  the **Have I Been Pwned** breach database via their k-anonymity API
  (`server/routes/auth.js`).
- Passwords hashed with bcrypt, sessions via signed JWTs.
- Profile: college (with autocomplete), roll number, degree type, branch,
  year, bio, location, and LinkedIn/GitHub/portfolio/Twitter/LeetCode links
  (`server/routes/profile.js`).
- Grading scale is user-selectable: VIT (S–F), 10-point (O–F), Percentage,
  Letter, or a custom scale (`server/lib/gradeScales.js`).

### Grades module — all 3 intake methods
1. **Manual entry** — add a semester, add course rows, save. Validated
   server-side (grade must match your scale, credits 0–10, no empty names,
   duplicate course codes flagged).
2. **Paste & extract** — paste anything (a VTOP dump, a WhatsApp forward, a
   copied table) and a deterministic extraction engine
   (`server/lib/gradeParser.js`) pulls out semester name, course code, name,
   grade and credits with a per-row confidence score, shown in an editable
   preview table before you save.
3. **Document upload** — upload a PDF or image. Text-based PDFs are read via
   `pdfjs-dist`; images go through OCR via `tesseract.js` (pure JS/WASM, no
   system Tesseract install needed — see note below). The extracted text
   runs through the same extraction engine as method 2.

CGPA is calculated live from your grading scale (`server/lib/gradeScales.js`,
verified against VIT's S–F scale in testing).

**Optional real-LLM upgrade — now built in, not just documented.** By
default `gradeParser.extract()`, `verifyCert`'s heuristic scorer, and
`recommend.js`'s tag-matching all run with zero API keys. Set either
`GEMINI_API_KEY` or `ANTHROPIC_API_KEY` in `.env` (see `.env.example`) and
paste/upload grade extraction, the no-QR certificate content check, *and*
the skill-gap/event/resume recommendations all automatically switch to
real LLM calls (`server/lib/llm.js`) instead — no other code changes
needed. **Two providers are supported**, auto-detected from whichever key
is set:

- **Gemini** — has a genuine free tier (no billing required), get a key at
  [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
  Defaults to `gemini-3.1-flash-lite`.
- **Claude** — no permanent free tier, pay-as-you-go, cheap for this app's
  usage. Defaults to `claude-haiku-4-5-20251001`.

If both keys are set, Gemini is preferred (it's free); force one
explicitly with `LLM_PROVIDER=gemini` or `LLM_PROVIDER=anthropic`. If the
key is missing, invalid, or the API call fails for any reason, it's caught
and the request transparently falls back to the matching heuristic engine
— nothing breaks either way. The response includes which path was used
and which provider ran it (`extractionMethod: "llm-gemini"|"llm-anthropic"|"heuristic"`
for grades, `verification.method` for certificates,
`recommendationMethod` for recommendations).

### Certificates module
- Upload PDFs/images, organize into folders you create
  (`server/routes/folders.js`, `server/routes/certificates.js`).
- **QR/hash verification**: works for both images and PDFs. Images are
  read directly into a bitmap and scanned (`jsqr` + `jimp`). PDFs are
  rasterized page-by-page (`pdfjs-dist` + `canvas`) and scanned the same
  way — a QR code in a PDF is a graphic on the page, not something you can
  find in the text layer, which is why an earlier version of this missed
  every QR-bearing PDF certificate (NPTEL's included). If a QR/embedded URL
  is found, it's checked for reachability; PDFs with no QR still fall back
  to scanning the text layer for an embedded verification URL. OCR is
  skipped entirely once a QR is found — the QR result alone decides status.
- **No-QR AI pipeline** (`server/lib/verifyCert.js`): extracts text (OCR or
  PDF text layer), then either a real Claude call or — with no API key —
  pattern-matched field extraction plus a keyword/field-completeness/OCR-
  confidence score, applying the same status table from the spec
  (confidence > 0.8 → verified, 0.5–0.8 → suspicious, < 0.5 → not verified).
- **Duplicate detection**: exact duplicates via SHA-256 hash, near-duplicates
  via Dice-coefficient text similarity (`server/lib/similarity.js`) — either
  flags the upload as suspicious.
- View/re-open any uploaded document, and a public, no-login `verify.html` +
  `/api/certificates/:id/verify-info` endpoint so a recruiter can check a
  certificate's status without contacting you or the institution.
- **Real forgery detection (ELA, font-consistency analysis, metadata
  forensics) is still out of scope** — that needs image-forensics tooling
  beyond a portable Node app, and a real LLM call doesn't add pixel-level
  tamper detection either. Both paths here judge the *text content*, not
  the image itself.

### Recommendations
- `server/data/trends.json` maps degree branches (CSE, ECE, Mechanical,
  Civil, EEE) to trending skills, growth rates, certifications and event
  types.
- With `ANTHROPIC_API_KEY` set, `server/lib/llm.js`'s
  `generateRecommendations()` sends your actual grades and certificates
  (course names, certificate titles/achievements, CGPA) together with the
  branch's trend data to a real Claude call, which reasons over them and
  writes specific, personalized skill-gap/event/resume advice — the "pass
  both student profile + current trends to the LLM" step from the original
  spec. Without a key (or if the call fails), `server/lib/recommend.js`
  produces the same three categories by keyword-tag matching your
  certificates against the trend list instead — same JSON shape either way,
  and the response's `recommendationMethod` field tells you which one ran.
- Peer benchmarking (`server/lib/stats.js`): your CGPA and certificate count
  percentile against other users in your branch. This one stays plain math
  either way — it's not the kind of thing an LLM call adds value to.
- **Freshness**: trends live in one JSON file so you can wire a weekly
  job-postings scrape to update it without touching either recommendation
  path.

### Portfolio / resume
- `/api/resume` aggregates your profile, grades, verified certificates and
  skill graph into one payload; `resume.html` renders it as a clean,
  printable resume — **Print → Save as PDF** stands in for a server-side PDF
  export in this build.

## Project structure

```
skillvault/
├── package.json
├── server/
│   ├── index.js              # Express app entry point
│   ├── middleware/auth.js     # JWT auth
│   ├── routes/                 # auth, profile, grades, folders, certificates,
│   │                            recommendations, resume
│   ├── lib/                    # gradeParser, gradeScales, verifyCert, qr, ocr,
│   │                            similarity, recommend, stats, db, llm
│   ├── data/                   # db.json (runtime data), trends.json, colleges.json
│   ├── tessdata/                # bundled offline OCR language data (eng.traineddata)
│   └── storage/uploads/        # uploaded certificates & transient parse uploads
└── public/                     # static frontend (no build step)
    ├── index.html               # landing page
    ├── login.html / signup.html
    ├── dashboard.html            # CGPA, semesters, skill graph, recs
    ├── certificates.html         # folders, upload, verification detail
    ├── resume.html
    ├── verify.html                # public recruiter lookup
    ├── css/style.css              # design system (see tokens below)
    └── js/                        # api.js (fetch client) + one script per page
```

## Data storage

`server/lib/db.js` is a small synchronous JSON-file store — no native
bindings, so `npm install` never fails on a missing build toolchain. It's
fine for a prototype or small deployment; swap it for a real database later
by reimplementing the same method names (`find`, `filter`, `insert`,
`update`, `remove`) against Postgres/SQLite/etc. — routes don't need to
change.

## Known limitations (so nothing here overclaims)

- **OCR runs fully offline** — the English language data (`server/tessdata/eng.traineddata`,
  ~4MB) is bundled in the repo, not fetched from a CDN at runtime. This was
  a real bug in an earlier version: a failed CDN fetch could crash the
  whole server (see `server/lib/ocr.js` and the process-level safety net in
  `server/index.js`). It's fixed now and doesn't touch the network at all
  for OCR — useful if you're demoing on a locked-down network. The LLM
  upgrade path (above) is the one thing that still needs internet, and only
  if you've set `ANTHROPIC_API_KEY`.
- **PDF QR codes are now scanned directly** — PDF pages are rasterized
  (`pdfjs-dist` + `canvas`) and scanned for a QR code the same as images
  are; this used to be a real gap (QR-bearing PDF certificates like
  NPTEL's were never actually checked for a QR at all) and is fixed.
- **Forgery detection is heuristic, not forensic** — see the certificates
  section above.
- **Single JSON file as the database** — fine for demo/small use; will not
  scale to concurrent writes at real load.
- **Resume export is print-to-PDF**, not a generated .docx/.pdf file.
- **The LLM success path (a real key actually returning a result) needs
  your own verification** — both providers' fallback-on-failure logic is
  thoroughly tested (no key, invalid key, network unreachable — all
  degrade cleanly to the heuristic engines without breaking anything), but
  a genuinely successful Gemini/Claude response depends on your own valid
  key and network access, which isn't something that could be verified
  while building this.

## Design tokens (public/css/style.css)

- `--background #F7F4EC` `--foreground #1B1A17` `--primary #1F4B3F`
- `--muted #ECE6D6` `--secondary #E4DCC6` `--border #DAD3BE`
- Display type: Fraunces · Body/UI type: Inter
