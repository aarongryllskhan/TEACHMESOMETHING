/**
 * improve-titles.js
 * Rewrites boring lesson titles to be more engaging using Gemini.
 * Safe to re-run — skips lessons already improved (tracks progress).
 *
 * Usage:  node improve-titles.js
 *         node improve-titles.js --reset     (clear progress and redo all)
 *         node improve-titles.js --folder ANCIENT_MYSTERIES_LOST_CIVILIZATIONS
 */

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const readline = require('readline');
require('dotenv').config();

const LESSONS_DIR   = path.join(__dirname, 'lessons');
const PROGRESS_FILE = path.join(__dirname, '.titles_progress.json');
const DELAY_MS      = 400;

const GEMINI_KEY   = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;

const RESET  = process.argv.includes('--reset');
const FOLDER = (() => { const i = process.argv.indexOf('--folder'); return i !== -1 ? process.argv[i + 1] : null; })();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Boring prefix detector ────────────────────────────────────────────────────
const BORING_PREFIX = /^(Understanding|Exploring|Discovering|Uncovering|Examining|Investigating|Unveiling|Unraveling|Delving Into|The Study of|The Role of|The Methods Behind|The Principles of|An? Introduction to|An? Overview of|A Guide to)\b/i;
function isBoring(title) {
  return BORING_PREFIX.test(title) || title.split(' ').length > 12;
}

// ── Gemini call ───────────────────────────────────────────────────────────────
function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
    const req = https.request(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '');
        } catch { reject(new Error('Bad JSON from Gemini')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Progress ──────────────────────────────────────────────────────────────────
function loadProgress() { try { return new Set(JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))); } catch { return new Set(); } }
function saveProgress(done) { fs.writeFileSync(PROGRESS_FILE, JSON.stringify([...done], null, 2)); }

// ── Folder picker ─────────────────────────────────────────────────────────────
async function pickFolder() {
  const folders = fs.readdirSync(LESSONS_DIR).filter(f => fs.statSync(path.join(LESSONS_DIR, f)).isDirectory()).sort();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\n✏️  Pocket Topics — Title Improver\n');
  folders.forEach((f, i) => {
    const files = fs.readdirSync(path.join(LESSONS_DIR, f)).filter(x => x.endsWith('.json'));
    const boring = files.filter(x => {
      try { return isBoring(JSON.parse(fs.readFileSync(path.join(LESSONS_DIR, f, x), 'utf8')).title || ''); } catch { return false; }
    }).length;
    console.log(`  [${String(i + 1).padStart(2)}] ${f.replace(/_FINISHEDEDIT.*|_PARTIAL.*/, '')} — ${boring} boring / ${files.length} total`);
  });
  console.log(`\n  [ 0] ALL folders\n`);
  let choice;
  while (true) {
    const input = await new Promise(r => rl.question('Enter number: ', r));
    const n = parseInt(input, 10);
    if (!isNaN(n) && n >= 0 && n <= folders.length) { choice = n; break; }
    console.log('  Invalid.');
  }
  rl.close();
  return choice === 0 ? null : folders[choice - 1];
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!GEMINI_KEY) { console.error('❌ GEMINI_API_KEY not set in .env'); process.exit(1); }
  if (RESET && fs.existsSync(PROGRESS_FILE)) { fs.unlinkSync(PROGRESS_FILE); console.log('Progress reset.'); }

  const onlyFolder = FOLDER || await pickFolder();
  const done = loadProgress();

  const folders = fs.readdirSync(LESSONS_DIR)
    .filter(f => fs.statSync(path.join(LESSONS_DIR, f)).isDirectory())
    .filter(f => !onlyFolder || f === onlyFolder)
    .sort();

  const pending = [];
  for (const folder of folders) {
    for (const file of fs.readdirSync(path.join(LESSONS_DIR, folder)).filter(f => f.endsWith('.json') && !f.includes('_progress'))) {
      const fp = path.join(LESSONS_DIR, folder, file);
      if (done.has(fp)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (!isBoring(data.title || '')) { done.add(fp); continue; }
        pending.push({ fp, data });
      } catch { /* skip */ }
    }
  }

  console.log(`\n   Folder : ${onlyFolder || 'ALL'}`);
  console.log(`   Boring titles to fix: ${pending.length}\n`);
  if (!pending.length) { console.log('✅ All titles are already engaging!'); return; }

  let improved = 0, failed = 0;

  for (let i = 0; i < pending.length; i++) {
    const { fp, data } = pending[i];
    const c = data.lesson || data;
    const hint = (c.funFact || c.learn || '').substring(0, 120);

    process.stdout.write(`[${i + 1}/${pending.length}] "${data.title}"\n  → `);

    const prompt = `Rewrite this lesson title to be genuinely interesting and curiosity-sparking — like a great magazine headline. NOT clickbait. Under 10 words. Start with a strong verb or intriguing framing. Return ONLY the new title, nothing else.

Title: ${data.title}
Topic: ${data.topic || ''}
Hint: ${hint}`;

    try {
      let newTitle = await callGemini(prompt);
      // Strip quotes if Gemini wraps them
      newTitle = newTitle.replace(/^["']|["']$/g, '').trim();
      if (!newTitle || newTitle.length < 5) throw new Error('Empty response');

      data.title = newTitle;
      fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
      done.add(fp);
      saveProgress(done);
      console.log(`"${newTitle}" ✅`);
      improved++;
    } catch (err) {
      console.log(`FAILED (${err.message}) ❌`);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n─────────────────────────────────`);
  console.log(`✅ Improved : ${improved}`);
  console.log(`❌ Failed   : ${failed}`);
  console.log(`\n💡 Deploy:  git add backend/lessons && git commit -m "Improve lesson titles" && git push`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
