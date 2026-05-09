/**
 * add-images.js
 * Finds a Wikipedia image for each lesson that doesn't have one yet.
 * Prompts you to pick a folder interactively.
 *
 * Usage:  node add-images.js
 */

const fs       = require('fs');
const path     = require('path');
const https    = require('https');
const readline = require('readline');

const LESSONS_DIR   = path.join(__dirname, 'lessons');
const PROGRESS_FILE = path.join(__dirname, '.images_progress.json');
const DELAY_MS      = 300; // Wikipedia rate limit — be polite

// ── CLI ───────────────────────────────────────────────────────────────────────
const RESET    = process.argv.includes('--reset');
const OVERWRITE = process.argv.includes('--overwrite'); // re-fetch even if image exists

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function ask(rl, q) { return new Promise(resolve => rl.question(q, resolve)); }

const STRIP = new Set([
  'the','a','an','of','in','on','at','to','for','and','or','but','is','are',
  'was','were','be','been','have','has','had','how','why','what','when',
  'where','who','which','that','this','these','those','its','it','behind',
  'beyond','through','about','after','before','between','during','without',
  'within','against','among','across','into','onto','from','understanding',
  'exploring','discovering','uncovering','secrets','secret','incredible',
  'amazing','genius','impossible','mystery','science','story','history',
  'power','rise','fall','real','hidden','methods','principles','properties',
  'overview','introduction','guide','explained','analysis','study','role'
]);

function keywords(title, topic) {
  const src = title || topic || '';
  const cleaned = src
    .replace(/^(Why|How|What|When|Where|The\s+\w+\s+of|Understanding|Exploring|Discovering|Unveiling|Unraveling)\s+/i, '')
    .replace(/[^a-zA-Z\s]/g, ' ');
  const words = cleaned.split(/\s+/)
    .filter(w => w.length > 2 && !STRIP.has(w.toLowerCase()));
  return words.slice(0, 4).join(' ') || (topic || '').slice(0, 50);
}

function get(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'PocketTopics/1.0 (educational app)' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

const BAD_IMAGE = ['Commons-logo', 'Wiki-logo', 'Question_book', 'Ambox', 'Crystal_Clear',
                   'OOjs_UI', 'Text_document', 'Folder', 'Edit-clear', 'Gnome-'];

async function findImage(query) {
  // 1. Search Wikipedia for the query
  const search = await get(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json`
  );
  const results = search?.query?.search || [];
  if (!results.length) return null;

  // Try each result until we find a direct image URL
  for (const result of results) {
    const title = encodeURIComponent(result.title);

    // piprop=original gives the direct full-resolution file URL
    const info = await get(
      `https://en.wikipedia.org/w/api.php?action=query&titles=${title}&prop=pageimages&piprop=original&format=json`
    );
    const pages = info?.query?.pages || {};
    for (const page of Object.values(pages)) {
      const url = page?.original?.source;
      if (!url) continue;
      // Skip SVGs, icons, logos
      if (url.endsWith('.svg') || url.endsWith('.SVG')) continue;
      if (BAD_IMAGE.some(b => url.includes(b)))        continue;
      return url; // direct image URL e.g. https://upload.wikimedia.org/wikipedia/commons/a/ab/photo.jpg
    }
    await sleep(150);
  }
  return null;
}

// ── Folder picker ─────────────────────────────────────────────────────────────
async function pickFolder() {
  const folders = fs.readdirSync(LESSONS_DIR)
    .filter(f => fs.statSync(path.join(LESSONS_DIR, f)).isDirectory())
    .sort();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n🖼️  Pocket Topics — Image Finder\n');
  folders.forEach((f, i) => {
    const files   = fs.readdirSync(path.join(LESSONS_DIR, f)).filter(x => x.endsWith('.json'));
    const hasImg  = files.filter(x => {
      try { return !!JSON.parse(fs.readFileSync(path.join(LESSONS_DIR, f, x), 'utf8')).image; } catch { return false; }
    }).length;
    const missing = files.length - hasImg;
    const label   = f.replace(/_FINISHEDEDIT.*|_PARTIAL.*/, '');
    console.log(`  [${String(i + 1).padStart(2)}] ${label} — ${missing} missing / ${files.length} total`);
  });
  console.log(`\n  [ 0] ALL folders\n`);

  let choice;
  while (true) {
    const input = (await ask(rl, 'Enter number: ')).trim();
    const n = parseInt(input, 10);
    if (!isNaN(n) && n >= 0 && n <= folders.length) { choice = n; break; }
    console.log('  Invalid choice.');
  }
  rl.close();
  return choice === 0 ? null : folders[choice - 1];
}

// ── JSON field ordering — ensure image sits between title and lesson ──────────
function reorderLesson(obj, imageUrl) {
  const ordered = {};
  if (obj.topic)       ordered.topic       = obj.topic;
  if (obj.title)       ordered.title       = obj.title;
                       ordered.image       = imageUrl;
  if (obj.lesson)      ordered.lesson      = obj.lesson;
  // carry over any other fields
  for (const [k, v] of Object.entries(obj)) {
    if (!['topic','title','image','lesson'].includes(k)) ordered[k] = v;
  }
  return ordered;
}

// ── Progress ──────────────────────────────────────────────────────────────────
function loadProgress() {
  try { return new Set(JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))); } catch { return new Set(); }
}
function saveProgress(done) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify([...done], null, 2));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (RESET) {
    if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
    console.log('Progress reset.');
  }

  const onlyFolder = await pickFolder();
  const done       = loadProgress();

  const folders = fs.readdirSync(LESSONS_DIR)
    .filter(f => fs.statSync(path.join(LESSONS_DIR, f)).isDirectory())
    .filter(f => !onlyFolder || f === onlyFolder)
    .sort();

  // Collect pending files
  const pending = [];
  for (const folder of folders) {
    const folderPath = path.join(LESSONS_DIR, folder);
    for (const file of fs.readdirSync(folderPath).filter(f => f.endsWith('.json') && !f.includes('_progress'))) {
      const filePath = path.join(folderPath, file);
      if (done.has(filePath)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!OVERWRITE && data.image) { done.add(filePath); continue; } // already has image
        pending.push({ filePath, data, folder });
      } catch { /* skip broken JSON */ }
    }
  }

  console.log(`\n   Folder : ${onlyFolder || 'ALL'}`);
  console.log(`   Pending: ${pending.length} files without images\n`);

  if (pending.length === 0) { console.log('✅ All lessons already have images!'); return; }

  let updated = 0, failed = 0;

  for (let i = 0; i < pending.length; i++) {
    const { filePath, data } = pending[i];
    const relPath = path.relative(LESSONS_DIR, filePath);
    const query   = keywords(data.title, data.topic);

    process.stdout.write(`[${i + 1}/${pending.length}] ${relPath}\n  🔍 "${query}" … `);

    const img = await findImage(query);

    if (img) {
      const updated_lesson = reorderLesson(data, img);
      fs.writeFileSync(filePath, JSON.stringify(updated_lesson, null, 2), 'utf8');
      done.add(filePath);
      saveProgress(done);
      console.log(`✅ ${img.slice(0, 80)}…`);
      updated++;
    } else {
      console.log(`❌ No image found`);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n─────────────────────────────────────`);
  console.log(`✅ Updated : ${updated}`);
  console.log(`❌ Failed  : ${failed}`);
  console.log(`\n💡 To deploy:  git add backend/lessons && git commit -m "Add lesson images" && git push`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
