/**
 * improve-fun-facts.js
 *
 * Reads every lesson JSON in backend/lessons/, rewrites the funFact field
 * using Gemini so they're genuinely surprising and punchy, then saves the file.
 *
 * Usage:
 *   GEMINI_API_KEY=your_key node backend/improve-fun-facts.js
 *
 * Options (env vars):
 *   DRY_RUN=1          — print what would change, don't write files
 *   CONCURRENCY=3      — how many files to process in parallel (default 3)
 *   FOLDER=ASTRONOMY_CELESTIAL_OBJECTS  — only process one folder
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = 'gemini-2.5-flash';
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const LESSONS_DIR    = path.join(__dirname, 'lessons');
const DRY_RUN        = process.env.DRY_RUN === '1';
const CONCURRENCY    = parseInt(process.env.CONCURRENCY || '3', 10);
const ONLY_FOLDER    = process.env.FOLDER || null;

if (!GEMINI_API_KEY) {
  console.error('❌  Set GEMINI_API_KEY before running this script.');
  process.exit(1);
}

// ── Gemini call ───────────────────────────────────────────────────────────────
async function callGemini(prompt) {
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

// ── Prompt ────────────────────────────────────────────────────────────────────
function buildPrompt(lesson) {
  const c = lesson.lesson || lesson;
  const title   = lesson.title  || '';
  const topic   = lesson.topic  || '';
  const current = c.funFact     || '';
  const learn   = c.learn       || c.explanation || '';

  return `You are rewriting the "fun fact" for a bite-sized educational app called Pocket Topics.

Lesson title: ${title}
Topic: ${topic}
Current fun fact: "${current}"
Core lesson content (for context): ${learn.substring(0, 600)}

Rewrite the fun fact so it is:
- Genuinely jaw-dropping, counterintuitive, or strangely specific
- The kind of thing you'd immediately text a friend
- Uses real numbers, scale comparisons, or vivid analogies where possible
- 1–2 sentences max — punchy, no padding
- NO "Did you know" opener — just state the fact with confidence
- Stays accurate and directly related to the lesson topic

Return ONLY the new fun fact text. No quotes, no labels, no explanation.`;
}

// ── Collect all JSON files ────────────────────────────────────────────────────
function collectFiles() {
  const folders = fs.readdirSync(LESSONS_DIR).filter(f =>
    fs.statSync(path.join(LESSONS_DIR, f)).isDirectory() &&
    (!ONLY_FOLDER || f === ONLY_FOLDER)
  );

  const files = [];
  for (const folder of folders) {
    const folderPath = path.join(LESSONS_DIR, folder);
    for (const file of fs.readdirSync(folderPath)) {
      if (file.endsWith('.json')) files.push(path.join(folderPath, file));
    }
  }
  return files;
}

// ── Process one file ──────────────────────────────────────────────────────────
async function processFile(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch { console.warn(`  ⚠️  Cannot read ${filePath}`); return; }

  let lesson;
  try { lesson = JSON.parse(raw); }
  catch { console.warn(`  ⚠️  Cannot parse ${filePath}`); return; }

  const c = lesson.lesson || lesson;
  if (!c.funFact) { console.log(`  –  no funFact field, skipping`); return; }

  const oldFact = c.funFact;

  let newFact;
  try {
    newFact = await callGemini(buildPrompt(lesson));
  } catch (err) {
    console.error(`  ✗  Gemini error for ${path.basename(filePath)}: ${err.message}`);
    return;
  }

  // Gemini sometimes wraps in quotes — strip them
  newFact = newFact.replace(/^["']|["']$/g, '').trim();

  if (!newFact || newFact.length < 20) {
    console.warn(`  ⚠️  Gemini returned an empty/short response for ${path.basename(filePath)}`);
    return;
  }

  console.log(`  📄  ${path.basename(filePath)}`);
  console.log(`     OLD: ${oldFact.substring(0, 100)}${oldFact.length > 100 ? '…' : ''}`);
  console.log(`     NEW: ${newFact.substring(0, 100)}${newFact.length > 100 ? '…' : ''}`);

  if (DRY_RUN) { console.log(`     (dry run — not saved)`); return; }

  // Write the updated JSON (preserving formatting as much as possible)
  if (lesson.lesson) {
    lesson.lesson.funFact = newFact;
  } else {
    lesson.funFact = newFact;
  }

  fs.writeFileSync(filePath, JSON.stringify(lesson, null, 2), 'utf8');
}

// ── Concurrency runner ────────────────────────────────────────────────────────
async function runWithConcurrency(tasks, limit) {
  const results = [];
  let i = 0;

  async function worker() {
    while (i < tasks.length) {
      const task = tasks[i++];
      await task();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const files = collectFiles();
  console.log(`\n🎯  Found ${files.length} lesson files${ONLY_FOLDER ? ` in ${ONLY_FOLDER}` : ''}`);
  if (DRY_RUN) console.log('🔍  DRY RUN — no files will be modified\n');

  let done = 0;
  const tasks = files.map(filePath => async () => {
    done++;
    console.log(`\n[${done}/${files.length}] ${path.relative(LESSONS_DIR, filePath)}`);
    await processFile(filePath);
    // Small delay to avoid hitting rate limits
    await new Promise(r => setTimeout(r, 400));
  });

  await runWithConcurrency(tasks, CONCURRENCY);

  console.log(`\n✅  Done. ${files.length} files processed${DRY_RUN ? ' (dry run)' : ' and saved'}.`);
})();
