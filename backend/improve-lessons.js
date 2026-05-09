/**
 * improve-lessons.js
 * 1. Rewrites lesson content with Gemini 2.5 Flash
 * 2. Finds a direct Wikipedia image if one is missing
 *
 * Usage:  node improve-lessons.js
 *         node improve-lessons.js --dry-run
 */

require('dotenv').config();
const fs       = require('fs');
const path     = require('path');
const https    = require('https');
const readline = require('readline');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = 'gemini-2.5-flash';
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const LESSONS_DIR    = path.join(__dirname, 'lessons');
const PROGRESS_FILE  = path.join(__dirname, '.improvement_progress.json');
const GEMINI_DELAY   = 32000; // 2 req/min free tier
const IMG_DELAY      = 300;   // be polite to Wikipedia
const MAX_RETRIES    = 3;
const DRY_RUN        = process.argv.includes('--dry-run');
const OVERWRITE_IMG  = process.argv.includes('--overwrite');

if (!GEMINI_API_KEY) {
  console.error('❌  GEMINI_API_KEY not set. Add it to backend/.env');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function ask(rl, q) { return new Promise(resolve => rl.question(q, resolve)); }

function fixEncoding(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/â€"/g, '—').replace(/â€"/g, '–')
    .replace(/â€œ/g, '"').replace(/â€/g,  '"')
    .replace(/â€˜/g, '‘').replace(/â€™/g, '’')
    .replace(/â€¢/g, '•').replace(/Â·/g,  '·')
    .replace(/Ã©/g, 'é').replace(/Ã¨/g, 'è').replace(/Ã /g, 'à')
    .replace(/\*\*/g, '').replace(/\*/g, '')
    .replace(/  +/g, ' ').trim();
}

function deepFixEncoding(obj) {
  if (typeof obj === 'string') return fixEncoding(obj);
  if (Array.isArray(obj))      return obj.map(deepFixEncoding);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = deepFixEncoding(v);
    return out;
  }
  return obj;
}

function cleanKeyElementEntry(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/^\d+\.\s*/, '')
    .replace(/\*\*([^*]+)\*\*:\s*/, '$1, ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^[-•]\s*/, '')
    .trim();
}

function cleanKeyElements(ke) {
  if (!ke || typeof ke !== 'object') return ke;
  const out = {};
  for (const [k, v] of Object.entries(ke)) {
    out[k] = Array.isArray(v) ? v.map(cleanKeyElementEntry) : v;
  }
  return out;
}

// Correct field order: topic → title → image → lesson
function reorder(obj) {
  const out = {};
  if (obj.topic)  out.topic  = obj.topic;
  if (obj.title)  out.title  = obj.title;
  if (obj.image)  out.image  = obj.image;
  if (obj.lesson) out.lesson = obj.lesson;
  for (const [k, v] of Object.entries(obj)) {
    if (!['topic','title','image','lesson'].includes(k)) out[k] = v;
  }
  return out;
}

// ── Wikipedia image finder ────────────────────────────────────────────────────
const STRIP_WORDS = new Set([
  'the','a','an','of','in','on','at','to','for','and','or','but','is','are',
  'was','were','be','been','have','has','had','how','why','what','when','where',
  'who','which','that','this','these','those','its','it','behind','beyond',
  'through','about','after','before','between','during','without','within',
  'against','among','across','into','onto','from','understanding','exploring',
  'discovering','uncovering','secrets','incredible','amazing','genius',
  'impossible','mystery','science','story','history','power','rise','fall',
  'real','hidden','methods','principles','properties','overview','introduction',
  'guide','explained','analysis','study','role','unveiled','secrets'
]);

const BAD_IMG = ['Commons-logo','Wiki-logo','Question_book','Ambox','Crystal_Clear',
                 'OOjs_UI','Text_document','Folder','Edit-clear','Gnome-'];

function imageKeywords(title, topic) {
  const src = title || topic || '';
  const cleaned = src
    .replace(/^(Why|How|What|When|Where|The\s+\w+\s+of|Understanding|Exploring|Discovering|Unveiling)\s+/i, '')
    .replace(/[^a-zA-Z\s]/g, ' ');
  const words = cleaned.split(/\s+/).filter(w => w.length > 2 && !STRIP_WORDS.has(w.toLowerCase()));
  return words.slice(0, 4).join(' ') || (topic || '').slice(0, 50);
}

function httpGet(url) {
  return new Promise(resolve => {
    https.get(url, { headers: { 'User-Agent': 'PocketTopics/1.0 (educational)' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

async function findImage(title, topic) {
  // Try multiple queries in order of relevance — topic first, then title keywords
  const queries = [
    topic,                          // e.g. "Human Endurance"
    imageKeywords(title, topic),    // keywords extracted from title
    `${topic} science`,             // broadened topic
  ].filter((q, i, a) => q && a.indexOf(q) === i); // dedupe

  for (const query of queries) {
    const search = await httpGet(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json`
    );
    const results = search?.query?.search || [];

    for (const result of results) {
      // Skip results whose title has no overlap with our topic — avoids completely unrelated pages
      const resultWords = result.title.toLowerCase().split(/\s+/);
      const topicWords  = (topic || query).toLowerCase().split(/[\s_-]+/);
      const hasOverlap  = topicWords.some(w => w.length > 3 && resultWords.some(r => r.includes(w)));
      if (!hasOverlap) continue;

      const t = encodeURIComponent(result.title);
      const info = await httpGet(
        `https://en.wikipedia.org/w/api.php?action=query&titles=${t}&prop=pageimages&piprop=original&format=json`
      );
      const pages = info?.query?.pages || {};
      for (const page of Object.values(pages)) {
        const url = page?.original?.source;
        if (!url) continue;
        if (url.endsWith('.svg') || url.endsWith('.SVG')) continue;
        if (BAD_IMG.some(b => url.includes(b))) continue;
        return url;
      }
      await sleep(IMG_DELAY);
    }
  }
  return null;
}

// ── Gemini ────────────────────────────────────────────────────────────────────
async function callGemini(prompt, retries = 0) {
  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 8192 }
      })
    });
    if (res.status === 429) {
      console.warn('\n  ⏳ Rate limited, waiting 60s…');
      await sleep(60000);
      return callGemini(prompt, retries);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (err) {
    if (retries < MAX_RETRIES) {
      console.warn(`\n  ⚠️  Retry ${retries + 1}/${MAX_RETRIES}: ${err.message}`);
      await sleep(5000 * (retries + 1));
      return callGemini(prompt, retries + 1);
    }
    throw err;
  }
}

function buildPrompt(lesson) {
  return `You are a brilliant science communicator writing for a curious general audience. REWRITE this lesson with genuinely new, specific, and surprising content — not just rephrase what is already there.

OUTPUT FORMAT:
- Return ONLY the raw JSON object — no markdown, no \`\`\`json fences, no text before or after, no thinking tags
- Keep EXACTLY the same field names and JSON structure
- Fix encoding: â€" → —, â€œ → ", â€ → ", remove ** and * markdown

ACCURACY — THIS IS THE MOST IMPORTANT RULE:
- Every fact, number, name, date, and statistic must be 100% accurate and verifiable.
- If you are not completely certain a fact is true, DO NOT include it — use a different fact you are sure about.
- Never invent or guess statistics. Never mix up directions, comparisons, or magnitudes (e.g. "above" vs "below", "faster" vs "slower").
- If you mention something (e.g. "why your body fights itself"), you MUST actually explain it in the content. Never mention something without explaining it.
- Every claim must be backed up by what is written — no dangling references or unexplained statements.

TONE — CRITICAL:
- Write like a knowledgeable friend talking to another curious adult — not a teacher lecturing a student.
- Never use condescending phrases like "It's important to understand that...", "Simply put...", "In other words...", "As we can see...", "This means that...", "Let's explore...", "Now you know...".
- Never over-explain or treat the reader like they're slow. Trust them to follow along.
- Avoid hollow filler like "fascinating", "remarkable", "incredible", "it's worth noting", "delve into", "it's no surprise".
- No motivational or wrap-up sentences like "This shows us how amazing science is" or "Truly a testament to human ingenuity".
- Sound like a real person who finds this genuinely interesting — direct, confident, a little informal.

CONTENT RULES:
- "learn": 4-5 sentences. Real names, dates, numbers you are certain of. Hook with something surprising or counterintuitive in the first sentence. No fluff.
- "simpler": ONE vivid real-world analogy that makes the concept click. 2-3 sentences. Conversational, not patronising.
- "keyTakeaway": One punchy sentence — a fresh angle, not a recap.
- "deeperDive": Go BEYOND "learn". Specific mechanisms, named studies, expert discoveries not in "learn". 4-6 sentences. Only facts you are certain about.
- "funFact": MAX 2 short sentences. Snappy, specific, surprising — something that genuinely makes you go "wow, I didn't know that." Numbers are great when you're sure of them, but a fascinating fact without numbers is better than a wrong number.
- "keyElements.people": Plain strings: "Full Name, specific role". Real people only.
- "keyElements.places": Plain strings: "Specific Place, why it matters". No generics.
- "keyElements.years": Plain strings: "YEAR, what happened". Real dates only.
- "keyElements.concepts": Plain strings: "Concept Name, one-sentence definition".
- "title": If generic (starts with "Understanding", "Exploring", "Introduction to", "Overview of", "The Science of") rewrite it as a punchy magazine headline. CRITICAL: the title must only reference things actually explained in the lesson content — never tease something the lesson doesn't deliver on. Otherwise keep it.
- Keep "topic", "image", subcategory unchanged.

LESSON TO REWRITE:
${JSON.stringify(lesson, null, 2)}`;
}

function parseResponse(text) {
  let s = text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '');
  const first = s.indexOf('{');
  const last  = s.lastIndexOf('}');
  if (first === -1 || last === -1) {
    console.error('\n  Response preview:', text.slice(0, 300));
    throw new Error('No JSON object found in response');
  }
  return JSON.parse(s.slice(first, last + 1));
}

// ── Folder picker ─────────────────────────────────────────────────────────────
async function pickFolder() {
  const folders = fs.readdirSync(LESSONS_DIR)
    .filter(f => fs.statSync(path.join(LESSONS_DIR, f)).isDirectory())
    .sort();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\n🎓 Pocket Topics — Improve + Image\n');
  folders.forEach((f, i) => {
    const count = fs.readdirSync(path.join(LESSONS_DIR, f)).filter(x => x.endsWith('.json')).length;
    console.log(`  [${String(i + 1).padStart(2)}] ${f.replace(/_FINISHEDEDIT.*|_PARTIAL.*/, '')} (${count} lessons)`);
  });
  console.log(`\n  [ 0] ALL folders (${folders.length} total)\n`);

  let choice;
  while (true) {
    const input = (await ask(rl, 'Enter number (or 0 for all): ')).trim();
    const n = parseInt(input, 10);
    if (!isNaN(n) && n >= 0 && n <= folders.length) { choice = n; break; }
    console.log('  Invalid — enter a number from the list.');
  }
  rl.close();
  return choice === 0 ? null : folders[choice - 1];
}

// ── Progress ──────────────────────────────────────────────────────────────────
function loadProgress() {
  try { return new Set(JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))); } catch { return new Set(); }
}
function saveProgress(done) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify([...done], null, 2));
}

function collectFiles(onlyFolder) {
  const files = [];
  for (const folder of fs.readdirSync(LESSONS_DIR).sort()) {
    if (onlyFolder && folder !== onlyFolder) continue;
    const fp = path.join(LESSONS_DIR, folder);
    if (!fs.statSync(fp).isDirectory()) continue;
    for (const file of fs.readdirSync(fp)) {
      if (file.endsWith('.json') && !file.includes('_progress')) files.push(path.join(fp, file));
    }
  }
  return files;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const onlyFolder = await pickFolder();
  const files      = collectFiles(onlyFolder);
  const done       = loadProgress();
  const pending    = files.filter(f => !done.has(f));

  console.log(`\n   Model  : ${GEMINI_MODEL}`);
  console.log(`   Folder : ${onlyFolder || 'ALL'}`);
  console.log(`   Total  : ${files.length} | Done: ${done.size} | Pending: ${pending.length}`);
  if (DRY_RUN) console.log(`   Mode   : DRY RUN`);
  console.log('');

  if (!pending.length) { console.log('✅ All done!'); return; }

  let improved = 0, skipped = 0, failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < pending.length; i++) {
    const filePath = pending[i];
    const relPath  = path.relative(LESSONS_DIR, filePath);
    const eta      = i > 0 ? Math.round(((Date.now() - startTime) / i) * (pending.length - i) / 60000) : '?';

    console.log(`\n[${i + 1}/${pending.length}] ${relPath}`);

    let original;
    try { original = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { console.log('  ⚠️  Invalid JSON — skipping'); skipped++; continue; }

    if (DRY_RUN) { console.log('  ✔ (dry run)'); improved++; continue; }

    try {
      // Step 1: Improve with Gemini
      process.stdout.write('  ✏️  Improving content… ');
      const raw = await callGemini(buildPrompt(deepFixEncoding(original)));
      let result = parseResponse(raw);

      // Preserve locked fields (skip image if --overwrite so it gets re-fetched)
      if (original.image && !OVERWRITE_IMG) result.image = original.image;
      if (original.subcategory) result.subcategory = original.subcategory;
      result.topic = original.topic;
      if (!result.title) result.title = original.title;

      // Clean keyElements
      const ke = result.lesson?.keyElements || result.keyElements;
      if (ke) {
        const cleaned = cleanKeyElements(ke);
        if (result.lesson?.keyElements) result.lesson.keyElements = cleaned;
        else result.keyElements = cleaned;
      }

      console.log('✅');

      // Step 2: Find image if missing
      if (!result.image) {
        process.stdout.write('  🖼️  Finding image… ');
        const img = await findImage(result.title, result.topic);
        if (img) { result.image = img; console.log('✅'); }
        else     { console.log('❌ no image found'); }
      } else {
        console.log('  🖼️  Image already exists — skipping');
      }

      // Save with correct field order
      fs.writeFileSync(filePath, JSON.stringify(reorder(result), null, 2), 'utf8');
      done.add(filePath);
      saveProgress(done);
      improved++;
      console.log(`  💾 Saved (ETA ~${eta}min)`);

    } catch (e) {
      console.log(`  ❌ ${e.message}`);
      failed++;
      saveProgress(done);
    }

    if (i < pending.length - 1) await sleep(GEMINI_DELAY);
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n─────────────────────────────────────`);
  console.log(`✅ Done    : ${improved}`);
  console.log(`⚠️  Skipped : ${skipped}`);
  console.log(`❌ Failed  : ${failed}`);
  console.log(`⏱  Time    : ${Math.floor(elapsed / 60)}m ${elapsed % 60}s\n`);
  if (!DRY_RUN && improved > 0) {
    console.log(`💡 Deploy:  git add backend/lessons && git commit -m "Improve lessons with Gemini" && git push`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
