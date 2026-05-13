const API_URL = '/api';

// Local storage keys
const STREAK_KEY = 'tms-streak';
const LESSONS_KEY = 'tms-lessons';
const TOPICS_KEY = 'tms-topics';
const LEARNED_LESSONS_KEY = 'tms-learned';
const LAST_LOGIN_KEY = 'tms-last-login';
const LAST_LEVEL_KEY = 'tms-last-level';
const READ_SECONDS_KEY = 'tms-read-seconds';
const READ_TOPICS_KEY  = 'tms-read-topics';
const DARK_KEY = 'tms-dark-mode';

// ── Dark mode ─────────────────────────────────────────────────────────────────
function initDarkMode() {
  if (localStorage.getItem(DARK_KEY) === 'true') {
    document.body.classList.add('dark');
    // Update toggle once DOM is ready
    requestAnimationFrame(() => {
      const btn   = document.getElementById('darkModeToggle');
      const thumb = document.getElementById('darkModeThumb');
      if (btn)   btn.setAttribute('aria-checked', 'true');
      if (thumb) thumb.style.transform = 'translateX(26px)';
    });
  }
}
function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark');
  localStorage.setItem(DARK_KEY, isDark);
  const btn = document.getElementById('darkModeToggle');
  if (btn) btn.setAttribute('aria-checked', isDark);
  // update toggle thumb
  const thumb = document.getElementById('darkModeThumb');
  if (thumb) thumb.style.transform = isDark ? 'translateX(26px)' : 'translateX(2px)';
}

// ── Text-to-Speech ────────────────────────────────────────────────────────────
const TTS_ICON_PLAY  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
const TTS_ICON_PAUSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;

function setTTSBtnState(playing) {
  const btn = document.getElementById('ttsBtn');
  if (!btn) return;
  btn.innerHTML = playing ? TTS_ICON_PAUSE : TTS_ICON_PLAY;
  btn.classList.toggle('tts-active', playing);
}

let ttsPlaying = false;
function getTTSText(lesson) {
  const c = lesson.lesson || lesson;
  return [c.funFact, c.simpler, c.learn, c.deeperDive, c.keyTakeaway]
    .filter(Boolean).join('. ');
}
// Preferred voices in order — natural-sounding, non-robotic
const TTS_PREFERRED = [
  'Google UK English Female',
  'Google US English',
  'Microsoft Aria Online (Natural) - English (United States)',
  'Microsoft Jenny Online (Natural) - English (United States)',
  'Samantha',           // macOS / iOS
  'Karen',              // macOS Australian
  'Daniel',             // macOS UK
  'Microsoft Zira Desktop - English (United States)',
];

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  for (const name of TTS_PREFERRED) {
    const match = voices.find(v => v.name === name);
    if (match) return match;
  }
  // Fallback: first English voice that isn't labelled "eSpeak" (very robotic)
  return voices.find(v => v.lang.startsWith('en') && !v.name.includes('eSpeak')) || null;
}

// Pre-load voices as early as possible
if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.getVoices();
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
  }
}

let ttsKeepAlive = null;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

function showToast(msg) {
  let t = document.getElementById('ttsToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'ttsToast';
    t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:10px 20px;border-radius:20px;font-size:0.9em;z-index:99999;opacity:0;transition:opacity 0.3s;pointer-events:none;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2500);
}

function toggleTTS(lesson) {
  if (!('speechSynthesis' in window)) { showToast('Text-to-speech not supported on this browser'); return; }
  if (ttsPlaying) {
    speechSynthesis.cancel();
    clearInterval(ttsKeepAlive);
    ttsPlaying = false;
    setTTSBtnState(false);
    return;
  }
  const text = getTTSText(lesson);
  if (!text) return;

  // cancel() clears any stuck state on both Android and iOS
  speechSynthesis.cancel();

  const utt = new SpeechSynthesisUtterance(text);
  utt.rate  = 1.02;
  utt.pitch = 1;
  utt.lang  = 'en-US';

  // Only set voice if voices are already loaded — avoids silent failure on Android
  const voices = speechSynthesis.getVoices();
  if (voices.length) {
    const voice = pickVoice();
    if (voice) utt.voice = voice;
  }

  utt.onstart = () => { ttsPlaying = true; setTTSBtnState(true); };
  utt.onend   = () => { clearInterval(ttsKeepAlive); ttsPlaying = false; setTTSBtnState(false); };
  utt.onerror = (e) => {
    if (e.error === 'interrupted' || e.error === 'canceled') return;
    clearInterval(ttsKeepAlive);
    ttsPlaying = false;
    setTTSBtnState(false);
    showToast('Could not play audio — check device TTS settings');
  };

  if (isIOS) {
    if (speechSynthesis.paused) speechSynthesis.resume();
    ttsKeepAlive = setInterval(() => {
      if (!speechSynthesis.speaking) { clearInterval(ttsKeepAlive); return; }
      speechSynthesis.pause();
      speechSynthesis.resume();
    }, 10000);
  }

  speechSynthesis.speak(utt);
  // Optimistically mark as playing (onstart may not fire on all browsers)
  ttsPlaying = true;
  setTTSBtnState(true);
}

function stopTTS() {
  if (ttsPlaying) {
    speechSynthesis.cancel();
    clearInterval(ttsKeepAlive);
    ttsPlaying = false;
    setTTSBtnState(false);
  }
}

// ── Share Fact Card ───────────────────────────────────────────────────────────
function shareFactCard(lesson) {
  const c = lesson.lesson || lesson;
  const funFact  = c.funFact || '';
  const title    = cleanTitle(lesson.title, lesson.topic);
  const image    = cleanImageUrl(c.image || lesson.image);
  const folder   = lesson.subcategory || '';
  const id       = lesson._id || '';
  const shareUrl = folder && id
    ? `${window.location.origin}/share/${encodeURIComponent(folder)}/${encodeURIComponent(id)}`
    : window.location.origin;

  const existing = document.getElementById('shareModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'shareModal';

  // Build the inner card
  const inner = document.createElement('div');
  inner.className = 'share-modal';

  const header = document.createElement('div');
  header.className = 'share-modal-header';
  header.innerHTML = '<span>Share</span>';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'share-close-btn';
  closeBtn.textContent = '✕';
  header.appendChild(closeBtn);

  const preview = document.createElement('div');
  preview.className = 'share-embed-preview';
  if (image) {
    const img = document.createElement('img');
    img.className = 'share-embed-img';
    img.src = image;
    img.alt = '';
    img.loading = 'lazy';
    preview.appendChild(img);
  }
  const body = document.createElement('div');
  body.className = 'share-embed-body';
  body.innerHTML = `<div class="share-embed-site">pocket topics</div>
    <div class="share-embed-title">${title}</div>
    <div class="share-embed-desc">${funFact}</div>`;
  preview.appendChild(body);

  const urlRow = document.createElement('div');
  urlRow.className = 'share-url-row';
  const urlInput = document.createElement('input');
  urlInput.className = 'share-url-input';
  urlInput.value = shareUrl;
  urlInput.readOnly = true;
  const copyBtn = document.createElement('button');
  copyBtn.className = 'share-copy-btn';
  copyBtn.textContent = 'Copy';
  urlRow.appendChild(urlInput);
  urlRow.appendChild(copyBtn);

  const hint = document.createElement('div');
  hint.className = 'share-hint';
  hint.textContent = 'Paste this link into Discord, WhatsApp, iMessage etc — it will show the embed above.';

  const actions = document.createElement('div');
  actions.className = 'share-actions';
  if (navigator.share) {
    const nativeBtn = document.createElement('button');
    nativeBtn.className = 'share-native-btn';
    nativeBtn.textContent = 'Share via…';
    nativeBtn.addEventListener('click', () => {
      navigator.share({ title: '💡 ' + title, text: '💡 ' + funFact, url: shareUrl }).catch(() => {});
    });
    actions.appendChild(nativeBtn);
  }

  inner.appendChild(header);
  inner.appendChild(preview);
  inner.appendChild(urlRow);
  inner.appendChild(hint);
  inner.appendChild(actions);

  const overlay = document.createElement('div');
  overlay.className = 'share-overlay';

  modal.appendChild(overlay);
  modal.appendChild(inner);
  document.body.appendChild(modal);

  // Wire up close actions
  const close = () => modal.remove();
  overlay.addEventListener('click', close);
  closeBtn.addEventListener('click', close);

  // Copy button
  copyBtn.addEventListener('click', () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareUrl).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
      }).catch(() => {
        urlInput.select();
      });
    } else {
      urlInput.select();
      document.execCommand('copy');
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
    }
  });

  // Auto-select URL on desktop for easy manual copy
  setTimeout(() => urlInput.select(), 50);
}

// ── Quiz ──────────────────────────────────────────────────────────────────────
let quizLesson = null;
let quizQuestions = [];
let quizIdx = 0;
let quizScore = 0;
let quizAnswered = false;

function buildLocalQuiz(lesson) {
  const c = lesson.lesson || lesson;
  const ke = c.keyElements || {};
  const questions = [];

  // Q1 — fun fact true/false style (4 options, one correct)
  if (c.funFact) {
    const fact = c.funFact.replace(/\.$/, '');
    // Make 3 plausible-sounding wrong variants by swapping words
    const wrongs = [
      fact.replace(/\b(\d+)\b/, n => String(Number(n) * 2)) || 'This is completely false',
      fact.split(' ').reverse().slice(0, 6).join(' ') + '…' || 'None of the above',
      'This fact is entirely made up'
    ].map(w => w.substring(0, 90));
    const opts = shuffle([fact.substring(0, 90), ...wrongs.slice(0, 3)]);
    questions.push({
      q: 'Which of these is the real fun fact from this topic?',
      options: opts,
      answer: opts.indexOf(fact.substring(0, 90)),
      explanation: `The real fun fact: ${fact.substring(0, 120)}.`
    });
  }

  // Q2 — key takeaway question
  if (c.keyTakeaway) {
    const kt = c.keyTakeaway.replace(/\.$/, '');
    const wrong1 = 'It has no practical applications in the modern world';
    const wrong2 = 'It was only important in ancient times';
    const wrong3 = 'Scientists still completely disagree on its basic principles';
    const opts = shuffle([kt.substring(0, 90), wrong1, wrong2, wrong3]);
    questions.push({
      q: `What's the key takeaway from "${lesson.title}"?`,
      options: opts,
      answer: opts.indexOf(kt.substring(0, 90)),
      explanation: kt.substring(0, 150) + '.'
    });
  }

  // Q3 — person/concept from keyElements
  const people = ke.people?.filter(p => p && p.length > 2) || [];
  const concepts = ke.concepts?.filter(c => c && c.length > 2) || [];
  if (people.length >= 2) {
    const correct = people[0];
    const wrongs = shuffle(people.slice(1)).slice(0, 3);
    while (wrongs.length < 3) wrongs.push(['Charles Darwin', 'Albert Einstein', 'Marie Curie', 'Isaac Newton'].find(n => !wrongs.includes(n) && n !== correct) || 'Unknown figure');
    const opts = shuffle([correct, ...wrongs]);
    questions.push({
      q: `Which person is most closely associated with this topic?`,
      options: opts,
      answer: opts.indexOf(correct),
      explanation: `${correct} is a key figure in this subject.`
    });
  } else if (concepts.length >= 2) {
    const correct = concepts[0];
    const wrongs = shuffle(concepts.slice(1)).slice(0, 3);
    while (wrongs.length < 3) wrongs.push(['Quantum entanglement', 'Natural selection', 'Plate tectonics'].find(c => !wrongs.includes(c) && c !== correct) || 'Unrelated concept');
    const opts = shuffle([correct, ...wrongs]);
    questions.push({
      q: `Which concept is central to this topic?`,
      options: opts,
      answer: opts.indexOf(correct),
      explanation: `${correct} is a core concept here.`
    });
  }

  // Q4 — simpler explanation check
  if (c.simpler) {
    const s = c.simpler.substring(0, 90).replace(/\.$/, '');
    const opts = shuffle([
      s,
      'It is completely unrelated to everyday life',
      'It only affects things at a cosmic scale',
      'Nobody fully understands it yet'
    ]);
    questions.push({
      q: 'How would you best describe this topic simply?',
      options: opts,
      answer: opts.indexOf(s),
      explanation: s + '.'
    });
  }

  return questions.slice(0, 4);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function loadQuiz(lesson) {
  const btn = document.getElementById('quizBtn');
  if (btn) { btn.textContent = 'Loading quiz…'; btn.disabled = true; }
  try {
    const questions = buildLocalQuiz(lesson);
    if (!questions.length) throw new Error('No questions');
    quizLesson = lesson;
    quizQuestions = questions;
    quizIdx = 0; quizScore = 0; quizAnswered = false;
    if (btn) { btn.textContent = 'Take Quiz'; btn.disabled = false; }
    showQuizModal();
  } catch (err) {
    if (btn) { btn.textContent = 'Take Quiz'; btn.disabled = false; }
    alert('Could not build quiz for this lesson.');
  }
}

function showQuizModal() {
  let modal = document.getElementById('quizModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'quizModal';
    modal.className = 'quiz-modal';
    document.body.appendChild(modal);
  }
  renderQuizQuestion(modal);
  modal.style.display = 'flex';
}

function renderQuizQuestion(modal) {
  const q = quizQuestions[quizIdx];
  quizAnswered = false;
  modal.innerHTML = `
    <div class="quiz-card">
      <div class="quiz-header">
        <button class="quiz-close" onclick="closeQuiz()">✕</button>
        <div class="quiz-progress-track">
          <div class="quiz-progress-fill" style="width:${(quizIdx/quizQuestions.length)*100}%"></div>
        </div>
        <div class="quiz-counter">${quizIdx + 1} / ${quizQuestions.length}</div>
      </div>
      <div class="quiz-question">${q.q}</div>
      <div class="quiz-options">
        ${q.options.map((opt, i) => `
          <button class="quiz-option" onclick="selectAnswer(${i})">${opt}</button>
        `).join('')}
      </div>
      <div class="quiz-explanation" id="quizExplanation" style="display:none">
        <span id="quizExplanationText"></span>
      </div>
      <button class="quiz-next-btn" id="quizNextBtn" style="display:none" onclick="nextQuizQuestion()">
        ${quizIdx < quizQuestions.length - 1 ? 'Next question →' : 'See results →'}
      </button>
    </div>`;
}

function selectAnswer(chosen) {
  if (quizAnswered) return;
  quizAnswered = true;
  const q = quizQuestions[quizIdx];
  const correct = q.answer;
  const opts = document.querySelectorAll('.quiz-option');
  opts.forEach((btn, i) => {
    btn.disabled = true;
    if (i === correct) btn.classList.add('quiz-correct');
    else if (i === chosen) btn.classList.add('quiz-wrong');
  });
  if (chosen === correct) quizScore++;
  const expl = document.getElementById('quizExplanation');
  const explText = document.getElementById('quizExplanationText');
  if (expl && explText) {
    explText.textContent = (chosen === correct ? '✓ Correct! ' : '✗ Wrong! ') + (q.explanation || '');
    expl.style.display = 'block';
    expl.className = 'quiz-explanation ' + (chosen === correct ? 'correct' : 'wrong');
  }
  const nextBtn = document.getElementById('quizNextBtn');
  if (nextBtn) nextBtn.style.display = 'block';
}

function nextQuizQuestion() {
  quizIdx++;
  if (quizIdx >= quizQuestions.length) {
    showQuizResult();
  } else {
    const modal = document.getElementById('quizModal');
    if (modal) renderQuizQuestion(modal);
  }
}

function showQuizResult() {
  const modal = document.getElementById('quizModal');
  if (!modal) return;
  const pct = Math.round((quizScore / quizQuestions.length) * 100);
  const msg = pct === 100 ? 'Perfect score!' : pct >= 75 ? 'Nice work!' : pct >= 50 ? 'Getting there!' : 'Give it another read!';
  modal.innerHTML = `
    <div class="quiz-card quiz-result-card">
      <button class="quiz-close" onclick="closeQuiz()">✕</button>
      <div class="quiz-result-score">${quizScore}/${quizQuestions.length}</div>
      <div class="quiz-result-pct">${pct}%</div>
      <div class="quiz-result-msg">${msg}</div>
      <button class="quiz-retry-btn" onclick="retryQuiz()">Try again</button>
      <button class="quiz-done-btn" onclick="closeQuiz()">Done</button>
    </div>`;
}

function retryQuiz() {
  quizIdx = 0; quizScore = 0; quizAnswered = false;
  const modal = document.getElementById('quizModal');
  if (modal) renderQuizQuestion(modal);
}

function closeQuiz() {
  const modal = document.getElementById('quizModal');
  if (modal) modal.style.display = 'none';
  const btn = document.getElementById('quizBtn');
  if (btn) { btn.textContent = 'Take Quiz'; btn.disabled = false; }
}

// Strip UTM tracking params from image URLs — leaves the URL otherwise untouched
function cleanImageUrl(url) {
  if (!url) return url;
  try { return url.split('?')[0]; } catch { return url; }
}

// Build small image attribution line from a credit object
function imageCreditHtml(credit) {
  if (!credit) return '';
  const parts = [];
  if (credit.creator) parts.push(credit.creator);
  if (credit.source) parts.push(credit.source);
  const text = parts.join(' / ');
  if (!text) return '';
  const link = credit.filePage || credit.licenseUrl || '';
  const inner = link
    ? `<a href="${link}" target="_blank" rel="noopener noreferrer">${text}</a>`
    : text;
  const licenseHtml = credit.license
    ? ` &middot; <a href="${credit.licenseUrl || '#'}" target="_blank" rel="noopener noreferrer">${credit.license}</a>`
    : '';
  return `<div class="image-credit">${inner}${licenseHtml}</div>`;
}

let lessonReadStart = null;

function startReadTimer() {
  lessonReadStart = Date.now();
}

function stopReadTimer() {
  if (!lessonReadStart) return;
  const elapsed = Math.floor((Date.now() - lessonReadStart) / 1000);
  lessonReadStart = null;
  const prev = parseInt(localStorage.getItem(READ_SECONDS_KEY) || '0', 10);
  localStorage.setItem(READ_SECONDS_KEY, prev + elapsed);
}

function getTotalReadMinutes() {
  return Math.floor(parseInt(localStorage.getItem(READ_SECONDS_KEY) || '0', 10) / 60);
}

function lessonReadId(lesson) {
  return `${lesson.topic}||${lesson.title}`;
}

function markLessonRead(lesson) {
  const read = JSON.parse(localStorage.getItem(READ_TOPICS_KEY) || '[]');
  const id = lessonReadId(lesson);
  if (!read.includes(id)) {
    read.push(id);
    localStorage.setItem(READ_TOPICS_KEY, JSON.stringify(read));
  }
}

function isLessonRead(lesson) {
  const read = JSON.parse(localStorage.getItem(READ_TOPICS_KEY) || '[]');
  return read.includes(lessonReadId(lesson));
}

// Cache for loaded lessons
let CATEGORIES_CACHE = null;
let LESSONS_CACHE = {};

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Clean up titles by removing markdown and special characters
 * If title is "Untitled", use the topic/subtitle instead
 */
function cleanTitle(title, topic) {
  if (!title) return '';

  // If title is "Untitled", use the topic as the title instead
  if (title.trim() === 'Untitled' && topic) {
    return topic
      .replace(/[-_]/g, ' ')     // Replace hyphens and underscores with spaces
      .replace(/\s+/g, ' ')      // Normalize multiple spaces to single space
      .trim();
  }

  // Strip dry academic prefixes that kill curiosity
  let t = title
    .replace(/\*\*/g, '').replace(/\*/g, '').replace(/__/g, '').replace(/_/g, '')
    .replace(/^(Understanding|Exploring|Discovering|Uncovering|Examining|Investigating|Unveiling|Unraveling|Delving Into|A Look at|An? Introduction to|An? Overview of|A Guide to|The Study of)\s+/i, '')
    .replace(/^(The\s+)?(Methods|Principles|Properties|Basics|Fundamentals|Concept|Concepts|Role)\s+(of|behind|in)\s+/i, '')
    .trim();

  // If title has a colon, keep whichever half is shorter & punchier (usually the second)
  if (t.includes(':')) {
    const [before, after] = t.split(':').map(s => s.trim());
    // Prefer the "How/Why/What/When" half; otherwise keep shorter half
    if (/^(how|why|what|when|where|the secret|the real|the hidden)/i.test(after)) {
      t = after;
    } else if (before.split(' ').length <= 5) {
      t = before; // short punchy first half e.g. "Grand Canyon"
    }
  }

  // Ensure first letter is always capitalised
  t = t.charAt(0).toUpperCase() + t.slice(1);

  return t || title.trim();
}

/**
 * Check if we should hide the topic tag (when title is Untitled)
 */
function shouldHideTopicTag(title) {
  return title && title.trim() === 'Untitled';
}

// ============================================
// API UTILITIES FOR REAL LESSONS
// ============================================

/**
 * Load all categories from backend
 */
async function loadCategories() {
  if (CATEGORIES_CACHE) return CATEGORIES_CACHE;

  try {
    const response = await fetch(`${API_URL}/categories`);
    if (!response.ok) throw new Error('Failed to load categories');
    const data = await response.json();
    // API returns { categories: [...] }, we return the full response for compatibility
    CATEGORIES_CACHE = data;
    return CATEGORIES_CACHE;
  } catch (error) {
    console.error('Error loading categories:', error);
    return { categories: [] };
  }
}

/**
 * Load lessons for a specific category
 */
async function loadCategoryLessons(category) {
  if (LESSONS_CACHE[category]) return LESSONS_CACHE[category];

  try {
    const response = await fetch(`${API_URL}/categories/${category}/lessons`);
    if (!response.ok) throw new Error(`Failed to load lessons for ${category}`);
    const data = await response.json();

    // Extract lessons array from response (which has { category, lessons, count })
    const lessons = Array.isArray(data) ? data : (data.lessons || []);
    LESSONS_CACHE[category] = lessons;
    return lessons;
  } catch (error) {
    console.error(`Error loading lessons for ${category}:`, error);
    return [];
  }
}

// Silently warm the lesson cache for all categories in the background
let _prefetchStarted = false;
async function prefetchAllCategories() {
  if (_prefetchStarted) return;
  _prefetchStarted = true;
  try {
    const data = await loadCategories();
    const cats = (data.categories || []);
    for (const cat of cats) {
      if (!LESSONS_CACHE[cat.id]) {
        // Small delay between fetches to avoid hammering the server
        await new Promise(r => setTimeout(r, 120));
        loadCategoryLessons(cat.id).catch(() => {});
      }
    }
  } catch {}
}

/**
 * Get a random lesson from all categories
 */
async function getRandomLesson(category = null) {
  const learnedIds = JSON.parse(localStorage.getItem(LEARNED_LESSONS_KEY) || '[]');

  try {
    if (category) {
      const lessons = await loadCategoryLessons(category);
      if (!lessons || lessons.length === 0) return null;

      // Filter by unique ID to avoid duplicates
      const available = lessons.filter(l => {
        const lessonId = `${category}-${l.topic}-${l.title}`;
        return !learnedIds.includes(lessonId);
      });

      if (available.length === 0) return null;
      return available[Math.floor(Math.random() * available.length)];
    } else {
      const categoriesData = await loadCategories();
      if (!categoriesData || !categoriesData.categories) return null;

      const allLessons = [];
      for (const cat of categoriesData.categories) {
        const lessons = await loadCategoryLessons(cat.id);
        if (lessons && Array.isArray(lessons)) {
          const available = lessons.filter(l => {
            const lessonId = `${cat.id}-${l.topic}-${l.title}`;
            return !learnedIds.includes(lessonId);
          });
          allLessons.push(...available);
        }
      }

      if (allLessons.length === 0) return null;
      return allLessons[Math.floor(Math.random() * allLessons.length)];
    }
  } catch (error) {
    console.error('Error getting random lesson:', error);
    return null;
  }
}

// ============================================
// LOCAL LESSON POOL UTILITIES (FALLBACK)
// ============================================

/**
 * Get all available topics from the local lesson pool
 */
function getAllTopicsFromPool() {
  if (!window.LESSON_POOL) {
    console.warn('Lesson pool not loaded');
    return [];
  }
  return Object.keys(window.LESSON_POOL);
}

/**
 * Get all lessons for a specific topic
 */
function getLessonsForTopic(topic) {
  if (!window.LESSON_POOL || !window.LESSON_POOL[topic]) {
    return [];
  }

  // Flatten all subtopics' lessons into a single array
  const lessons = [];
  Object.values(window.LESSON_POOL[topic]).forEach(subtopicLessons => {
    if (Array.isArray(subtopicLessons)) {
      // Add lesson ID for tracking (use topic + index as unique ID)
      subtopicLessons.forEach((lesson, idx) => {
        lessons.push({
          ...lesson,
          id: `${topic}-${lesson.title.substring(0, 20).replace(/\s+/g, '-')}-${idx}`
        });
      });
    }
  });
  return lessons;
}

/**
 * Get a random lesson from the lesson pool
 * Optionally filter by topic, and exclude already-learned lessons
 */
function getRandomLessonFromPool(topic = null) {
  const learnedIds = JSON.parse(localStorage.getItem(LEARNED_LESSONS_KEY) || '[]');

  let availableLessons = [];

  if (topic) {
    // Get lessons for specific topic
    availableLessons = getLessonsForTopic(topic).filter(l => !learnedIds.includes(l.id));
  } else {
    // Get all lessons from all topics
    const allTopics = getAllTopicsFromPool();
    allTopics.forEach(t => {
      const topicLessons = getLessonsForTopic(t).filter(l => !learnedIds.includes(l.id));
      availableLessons.push(...topicLessons);
    });
  }

  if (availableLessons.length === 0) {
    return null;
  }

  // Return random lesson
  return availableLessons[Math.floor(Math.random() * availableLessons.length)];
}

// Celebration functions
function triggerConfetti() {
  if (typeof confetti !== 'undefined') {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });
  }
}

function celebrateLevelUp(newLevel) {
  triggerConfetti();
  const notification = document.createElement('div');
  notification.className = 'level-up-notification';
  notification.innerHTML = `🎉 Level ${newLevel}! 🎉`;
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 2500);
}

function celebrateAchievement(achievementName) {
  triggerConfetti();
  const notification = document.createElement('div');
  notification.className = 'achievement-unlock-notification';
  notification.innerHTML = `🏆 Achievement Unlocked: ${achievementName}!`;
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 3000);
}

function showBonusNotification(xpAmount) {
  const notification = document.createElement('div');
  notification.className = 'bonus-notification';
  notification.innerHTML = `🎁 Daily Bonus +${xpAmount} XP!`;
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 3000);
}

function checkDailyBonus() {
  const today = new Date().toDateString();
  const lastLogin = localStorage.getItem(LAST_LOGIN_KEY);

  if (lastLogin !== today) {
    localStorage.setItem(LAST_LOGIN_KEY, today);
    return 20; // Daily bonus XP
  }
  return 0;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initDarkMode();
  loadLessonCards();
  updateStreakDisplay();
  displayLearningHistory();
  displayAchievements();
  getDailyLessonAuto();
  loadProfileName();

  // Handle share-page redirect: /?open=folder/id
  const openParam = new URLSearchParams(window.location.search).get('open');
  if (openParam) {
    const slash = openParam.indexOf('/');
    if (slash !== -1) {
      const folder = decodeURIComponent(openParam.slice(0, slash));
      const id     = decodeURIComponent(openParam.slice(slash + 1));
      window.history.replaceState({}, '', '/');
      // Wait for categories to load before opening
      setTimeout(() => window.openLessonFromNative(folder, id), 800);
    }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopReadTimer();
});

// Tab switching
function switchTab(tabName) {
  stopReadTimer();
  // Close any open lesson modal first
  const modal = document.getElementById('fullLessonModal');
  if (modal) {
    modal.remove();
    document.body.style.overflow = '';
  }

  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

  document.getElementById(tabName).classList.add('active');
  const navBtn = document.getElementById('nav-' + tabName);
  if (navBtn) navBtn.classList.add('active');
  else if (event && event.target) event.target.closest('.tab-btn').classList.add('active');

  if (tabName === 'daily' && !currentDailyLesson) { getDailyLessonAuto(); }
  if (tabName === 'explorer') { loadLessonCards(); prefetchAllCategories(); }
  if (tabName === 'profile') { updateStreakDisplay(); displayAchievements(); }
}

async function getDailyLessonAuto() {
  try {
    const lesson = await getRandomLesson();
    if (lesson) {
      currentLessonsArray = [lesson];
      currentCardIndex = 0;
      displayDailyLessonCard(lesson);
    }
  } catch (error) {
    console.error('Error loading daily lesson:', error);
  }
}

// Daily Lesson
async function getDailyLesson() {
  const btn = event.target;
  btn.disabled = true;
  btn.innerHTML = '<div class="loading"></div>';

  try {
    const lesson = await getRandomLesson();

    if (!lesson) {
      alert('You\'ve learned all available lessons! Great job! 🎉');
    } else {
      const learnedIds = JSON.parse(localStorage.getItem(LEARNED_LESSONS_KEY) || '[]');
      if (!learnedIds.includes(lesson.topic)) {
        learnedIds.push(lesson.topic);
        localStorage.setItem(LEARNED_LESSONS_KEY, JSON.stringify(learnedIds));
        saveLessonToStreak(lesson.topic, lesson.topic, lesson);
      }
      updateStreakDisplay();

      currentLessonsArray = [lesson];
      currentCardIndex = 0;
      displayDailyLessonCard(lesson);
    }
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to load lesson');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Get Today\'s Lesson';
  }
}

let currentDailyLesson = null;

function displayDailyLessonCard(lesson) {
  // Hide the prompt section completely
  const dailySection = document.getElementById('daily');
  dailySection.querySelectorAll('.panel').forEach(panel => {
    panel.style.display = 'none';
  });

  document.getElementById('dailyLessonContainer').style.display = 'flex';

  document.getElementById('dailyTitle').textContent = cleanTitle(lesson.title, lesson.topic);

  const rawDesc = (lesson.lesson && (lesson.lesson.funFact || lesson.lesson.learn)) || '';
  document.getElementById('dailyDescription').textContent = rawDesc.substring(0, 150) + (rawDesc.length > 150 ? '…' : '');

  // Show lesson image if available, otherwise fall back to book emoji
  const iconEl = document.getElementById('dailyIcon');
  const imgUrl = cleanImageUrl(lesson.image || (lesson.lesson && lesson.lesson.image));
  if (imgUrl) {
    iconEl.innerHTML = `<img src="${imgUrl}" alt="" class="daily-lesson-img" loading="lazy">`;
  } else {
    iconEl.innerHTML = `<img src="images/book.png" alt="book" class="daily-lesson-img" loading="lazy" style="object-fit:contain;padding:8px;">`;
  }

  // Store current lesson for click handler
  currentDailyLesson = lesson;
}

function saveDailyLesson() {
  if (!currentDailyLesson) return;
  alert('Lesson saved to your collection! 🔖');
}

function likeDailyLesson() {
  if (!currentDailyLesson) return;
  alert('Thanks for liking this lesson! ❤️');
}

function shareDailyLesson() {
  if (!currentDailyLesson) return;
  if (navigator.share) {
    navigator.share({
      title: currentDailyLesson.title,
      text: 'Check out this lesson!',
      url: window.location.href
    });
  } else {
    alert('Share: ' + currentDailyLesson.title);
  }
}

async function openDailyLesson() {
  // If lesson not loaded, load it first
  if (!currentDailyLesson) {
    await getDailyLessonAuto();
  }

  // Display the lesson and mark as learned for streak
  if (currentDailyLesson) {
    const learnedIds = JSON.parse(localStorage.getItem(LEARNED_LESSONS_KEY) || '[]');
    const lessonId = currentDailyLesson.topic;

    if (!learnedIds.includes(lessonId)) {
      learnedIds.push(lessonId);
      localStorage.setItem(LEARNED_LESSONS_KEY, JSON.stringify(learnedIds));
      saveLessonToStreak(currentDailyLesson.topic, lessonId, currentDailyLesson);
      updateStreakDisplay();
    }

    displayFullLesson(currentDailyLesson);
  }
}

// ── SWIPE / DISCOVER ──
let swipeLessons = [];
let swipeIndex  = 0;

async function initSwipe() {
  if (swipeLessons.length && swipeIndex < swipeLessons.length) { renderSwipeCard(); return; }
  const stack = document.getElementById('swipeStack');
  stack.innerHTML = '<div class="swipe-loading">Loading lessons…</div>';

  const categories = await loadCategories();
  swipeLessons = [];
  for (const cat of categories) {
    const lessons = await loadCategoryLessons(cat.id);
    lessons.forEach(l => swipeLessons.push({ ...l, _category: cat.name.replace(/_/g,' ') }));
  }
  swipeLessons = swipeLessons.sort(() => Math.random() - 0.5);
  swipeIndex = 0;
  renderSwipeCard();
}

function renderSwipeCard() {
  const stack = document.getElementById('swipeStack');
  if (swipeIndex >= swipeLessons.length) {
    stack.innerHTML = '<div class="swipe-loading">You\'ve seen all lessons! 🎉</div>';
    return;
  }
  const lesson = swipeLessons[swipeIndex];

  // Debug: check what fields are available
  const lessonContent = lesson.lesson || lesson;
  let previewText = lessonContent.funFact || lessonContent.learn || '';

  // If still empty, try other common field names
  if (!previewText) {
    previewText = lessonContent.explanation || lessonContent.simpler || '';
  }

  previewText = previewText.substring(0, 350);

  stack.innerHTML = `
    <div class="swipe-card" id="swipeCard">
      <span class="swipe-hint-left" id="hintSkip">SKIP</span>
      <span class="swipe-hint-right" id="hintLearn">LEARN</span>
      <div class="swipe-card-category">${lesson._category}</div>
      <div class="swipe-card-title">${cleanTitle(lesson.title, lesson.topic)}</div>
      <div class="swipe-card-preview">${previewText}${previewText.length >= 350 ? '…' : ''}</div>
    </div>`;
}

function swipeLesson(action) {
  const card = document.getElementById('swipeCard');
  if (!card) return;

  if (action === 'learn') {
    // Open the full lesson instead of swiping
    const lesson = swipeLessons[swipeIndex];
    saveLessonToStreak(lesson.topic || lesson.title, lesson.topic || lesson.title, lesson);
    updateStreakDisplay();
    displayFullLesson(lesson);
    return;
  }

  // For skip action, show swipe animation and move to next
  card.classList.add('swiping-left');
  setTimeout(() => { swipeIndex++; renderSwipeCard(); }, 350);
}

// Explore related topic
function exploreRelatedTopic(topic) {
  // Switch to explorer tab
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

  document.getElementById('explorer').classList.add('active');
  document.querySelector('[onclick="switchTab(\'explorer\')"]').classList.add('active');

  try {
    // Get a random lesson from the specific topic (not already learned)
    let lesson = null;
    let attempts = 0;
    const maxAttempts = 5;

    // Try up to 5 times to find an unlearned lesson from this topic
    while (attempts < maxAttempts) {
      lesson = getRandomLessonFromPool(topic);
      if (lesson) break;
      attempts++;
    }

    if (lesson) {
      displayLesson(lesson, 'explorerLesson');
      const learnedIds = JSON.parse(localStorage.getItem(LEARNED_LESSONS_KEY) || '[]');
      learnedIds.push(lesson.id);
      localStorage.setItem(LEARNED_LESSONS_KEY, JSON.stringify(learnedIds));
      saveLessonToStreak(lesson.topic, lesson.id, lesson);
      updateStreakDisplay();
    } else {
      alert(`You've learned all ${topic} lessons! Try another topic.`);
    }

    saveExploredTopic(topic);
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to load lesson');
  }
}

// Topic Explorer
function loadTopics() {
  try {
    const topics = getAllTopicsFromPool();
    const grid = document.getElementById('topicsGrid');

    if (topics.length === 0) {
      grid.innerHTML = '<p style="text-align: center; color: #999;">No topics available.</p>';
      return;
    }

    grid.innerHTML = topics.map(topic =>
      `<button class="btn-topic" onclick="getTopicLesson('${topic}')">${topic}</button>`
    ).join('');
  } catch (error) {
    console.error('Error loading topics:', error);
  }
}

// Map category names to their dedicated images
const categoryImages = {
  'Science':                'Science.png',
  'Biology':                'Biology.png',
  'Medicine & Health':      'Medicine&Health.png',
  'Mind & Psychology':      'Philosophy&Consciousness.png',
  'Animals & Nature':       'Animals&Nature.png',
  'Earth & Environment':    'Earth&Environment.png',
  'Marine & Ocean':         'Marine&Ocean.png',
  'Space & Cosmos':         'Space&Cosmos.png',
  'History & Exploration':  'History&Exploration.png',
  'Technology & Innovation':'Technology&Innovation.png',
  'Culture & Arts':         'Culture&Arts.png',
  'Society & Economics':    'Society&Economics.png',
  'Mysteries & Unexplained':'Mysteries&Unexplained.png',
  'Sports & Records':       'Sports&Records.png'
};

// Per-category colour theme — bg is the icon background, color is the icon tint
const CATEGORY_COLORS = {
  'Science':                { bg: '#cffafe', color: '#0e7490' },
  'Biology':                { bg: '#ccfbf1', color: '#0f766e' },
  'Medicine & Health':      { bg: '#fee2e2', color: '#b91c1c' },
  'Mind & Psychology':      { bg: '#e0e7ff', color: '#3730a3' },
  'Animals & Nature':       { bg: '#dcfce7', color: '#16a34a' },
  'Earth & Environment':    { bg: '#d1fae5', color: '#047857' },
  'Marine & Ocean':         { bg: '#dbeafe', color: '#1d4ed8' },
  'Space & Cosmos':         { bg: '#ddd6fe', color: '#5b21b6' },
  'History & Exploration':  { bg: '#fef3c7', color: '#b45309' },
  'Technology & Innovation':{ bg: '#dbeafe', color: '#1e40af' },
  'Culture & Arts':         { bg: '#fce7f3', color: '#be185d' },
  'Society & Economics':    { bg: '#ffedd5', color: '#c2410c' },
  'Mysteries & Unexplained':{ bg: '#ede9fe', color: '#6d28d9' },
  'Sports & Records':       { bg: '#dcfce7', color: '#15803d' },
};

const CATEGORY_META = {
  colors: ['#e8f5e9','#e3f2fd','#f3e5f5','#fff3e0','#fce4ec','#e0f7fa','#f9fbe7','#ede7f6'],
  icons:  ['🌿','📘','🔬','⚗️','🏛️','🌍','💡','🧠','🎨','🚀','🦋','⚡','🌊','🧬','📐','🎭'],
};

function categoryMeta(name, idx) {
  const known = CATEGORY_COLORS[name];
  if (known) return known;
  const color = CATEGORY_META.colors[idx % CATEGORY_META.colors.length];
  const icon  = CATEGORY_META.icons[idx % CATEGORY_META.icons.length];
  return { bg: color, color: '#667eea', icon };
}

function getCategoryImage(categoryName) {
  return categoryImages[categoryName] || null;
}

let allCategories = [];

function setExploreBack(fn) {
  const btn = document.getElementById('topbarBackBtn');
  if (!btn) return;
  btn.style.visibility = 'visible';
  btn.onclick = fn;
}

function hideExploreBack() {
  const btn = document.getElementById('topbarBackBtn');
  if (btn) btn.style.visibility = 'hidden';
}

function setExploreTitle(text) {
  const el = document.getElementById('exploreTitle');
  if (el) el.textContent = text;
}

async function loadLessonCards() {
  hideExploreBack();
  setExploreTitle('Explore');

  const grid = document.getElementById('topicsGrid');
  grid.innerHTML = '<div style="text-align:center;color:#bbb;padding:40px 0;">Loading...</div>';

  try {
    const data = await loadCategories();
    const categories = data.categories || [];
    allCategories = categories;
    renderCategoryList(categories);
    buildFilterPills(categories);
  } catch (error) {
    grid.innerHTML = '<p style="color:#f00;text-align:center;">Failed to load categories</p>';
  }
}

let _allTopicsCategories = [];
let _allTopicsLessons = [];
let _allTopicsFolderView = true;

async function loadAllTopicsView(folderView) {
  const grid = document.getElementById('topicsGrid');
  window.scrollTo({ top: 0, behavior: 'instant' });
  setExploreBack(() => loadLessonCards());
  setExploreTitle('All Topics');

  if (folderView === undefined) folderView = _allTopicsFolderView;
  _allTopicsFolderView = folderView;

  grid.innerHTML = '<div style="text-align:center;color:#bbb;padding:40px 0;">Loading…</div>';

  try {
    if (!_allTopicsCategories.length) {
      const data = await loadCategories();
      _allTopicsCategories = data.categories || [];
    }
    const categories = _allTopicsCategories;

    const toggleBtn = `<button class="all-topics-toggle" onclick="loadAllTopicsView(${!folderView})">
      ${folderView ? 'Show All Lessons' : 'Show Folders'}
    </button>`;

    const CHEVRON = `<svg class="explore-category-card-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

    if (folderView) {
      // Folder view: all subcategory cards
      const cards = categories.flatMap(cat =>
        cat.subCategories.map(subFolder => {
          const normFolder = subFolder.replace(/_(FINISHEDEDITED_FINISHEDEDIT|FINISHEDEDITED|FINISHEDEDIT|PARTIAL)$/i, '');
          const meta = subcategoryMeta[subFolder] || subcategoryMeta[normFolder] || { icon: '📚', color: '#ede9fe' };
          const rawName = normFolder.replace(/_/g, ' ');
          const displayName = meta.name || toTitleCase(rawName);
          return `
            <div class="explore-category-card" onclick="loadCategoryLessonsView('${cat.id}', '${cat.name}')">
              <div class="explore-category-icon" style="background:${meta.color}">${meta.icon}</div>
              <div class="explore-category-card-text">
                <div class="explore-category-card-title">${displayName}</div>
                <div class="explore-category-card-count">${cat.name}</div>
              </div>
              ${CHEVRON}
            </div>`;
        })
      ).join('');
      grid.innerHTML = toggleBtn + '<div class="explore-grid">' + cards + '</div>';
    } else {
      // Flat view: every individual lesson
      if (!_allTopicsLessons.length) {
        _allTopicsLessons = (await Promise.all(
          categories.map(cat => loadCategoryLessons(cat.id).catch(() => []))
        )).flat();
      }
      const allLessons = _allTopicsLessons;
      currentLessonsArray = allLessons;
      currentCategory = '__all__';

      const ACCENT_COLORS = ['#667eea','#f59e0b','#10b981','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899','#14b8a6','#6366f1'];
      const rows = allLessons.map((lesson, idx) => {
        const color = ACCENT_COLORS[idx % ACCENT_COLORS.length];
        const rawText = typeof lesson.lesson === 'string' ? lesson.lesson : (lesson.lesson?.learn || '');
        const preview = (typeof rawText === 'string' ? rawText : '').substring(0, 100);
        const imgUrl = cleanImageUrl(lesson.image);
        const thumbHtml = imgUrl ? `<img class="lesson-thumb" src="${imgUrl}" alt="" loading="lazy" onerror="this.style.display='none'">` : '';
        return `
        <div class="explore-category-row" onclick="selectAllTopicsLesson(${idx})">
          <div class="lesson-accent-bar" style="background:${color};"></div>
          <div class="explore-category-info">
            <div class="explore-category-name">${cleanTitle(lesson.title, lesson.topic)}</div>
            <div class="explore-category-desc">${preview}${preview.length >= 100 ? '…' : ''}</div>
          </div>
          ${thumbHtml}
          ${isLessonRead(lesson)
            ? `<svg class="lesson-read-tick" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#ecfdf5"/><polyline points="7 12 10.5 15.5 17 9" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
            : `<svg class="lesson-chevron" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" style="width:18px;height:18px;"><polyline points="9 18 15 12 9 6"/></svg>`
          }
        </div>`;
      }).join('');
      grid.innerHTML = toggleBtn + (rows || '<p style="text-align:center;color:#bbb;padding:40px 0;">No lessons found.</p>');
    }
  } catch (error) {
    console.error('Error loading all topics:', error);
    grid.innerHTML = '<p style="color:#f00;text-align:center;">Failed to load topics</p>';
  }
}

function selectAllTopicsLesson(index) {
  const lesson = currentLessonsArray[index];
  if (!lesson) return;
  currentCardIndex = index;
  saveLessonToStreak(lesson.topic || lesson.title, `all-${index}`, lesson);
  updateStreakDisplay();
  displayFullLesson(lesson);
}

function renderCategoryList(categories) {
  const grid = document.getElementById('topicsGrid');

  if (!categories || !categories.length) {
    grid.innerHTML = '<p style="text-align:center;color:#bbb;padding:40px 0;">No categories found.</p>';
    return;
  }

  const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name));

  const CHEVRON = `<svg class="explore-category-card-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

  const totalTopics = allCategories.reduce((sum, c) => sum + (c.count || 0), 0);
  const allTopicsCard = `
    <div class="explore-category-card" onclick="loadAllTopicsView()">
      <div class="explore-category-icon" style="background:#1a1a2e">🗂️</div>
      <div class="explore-category-card-text">
        <div class="explore-category-card-title">All Topics</div>
        <div class="explore-category-card-count">${totalTopics || ''} topics</div>
      </div>
      ${CHEVRON}
    </div>`;

  grid.innerHTML = '<div class="explore-grid">' + allTopicsCard + sorted.map((cat, idx) => {
    const name = cat.name;
    const imageFile = getCategoryImage(name);
    const meta = categoryMeta(name, idx);

    const iconHtml = imageFile
      ? `<img src="images/${imageFile}" alt="${name}" style="width:100%;height:100%;object-fit:contain;padding:6px;">`
      : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.7em;border-radius:16px;">${meta.icon || '📖'}</div>`;

    // Image files have white backgrounds baked in — keep the tile white so they look right
    const iconBg = imageFile ? '#ffffff' : (meta.bg || '#f0f2f5');

    return `
      <div class="explore-category-card" onclick="loadCategoryLessonsView('${cat.id}', '${name}')">
        <div class="explore-category-icon" style="background:${iconBg}">${iconHtml}</div>
        <div class="explore-category-card-text">
          <div class="explore-category-card-title">${name}</div>
          <div class="explore-category-card-count">${cat.count} topics</div>
        </div>
        ${CHEVRON}
      </div>`;
  }).join('') + '</div>';
}

function buildFilterPills(categories) {
  const container = document.getElementById('exploreFilters');
  if (!container) return;

  // Create filter pills based on category keywords (first word of category name)
  const firstWords = [...new Set(categories.map(c => {
    const words = c.name.split(' ');
    return words[0]; // Get first word of parent category name
  }))].slice(0, 6);

  const pills = ['All', ...firstWords].map((word, i) =>
    `<button class="explore-filter-btn${i===0?' active':''}" onclick="setTopicFilter('${word}', this)">${word}</button>`
  ).join('');
  container.innerHTML = pills;
}

function setTopicFilter(filter, btn) {
  document.querySelectorAll('.explore-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (filter === 'All') {
    renderCategoryList(allCategories);
  } else {
    renderCategoryList(allCategories.filter(c => c.name.toUpperCase().includes(filter.toUpperCase())));
  }
}

let searchResults = [];

let searchDebounceTimer = null;

async function filterTopics(query) {
  const grid = document.getElementById('topicsGrid');

  clearTimeout(searchDebounceTimer);

  if (!query || !query.trim()) {
    searchResults = [];
    renderCategoryList(allCategories);
    return;
  }
  searchDebounceTimer = setTimeout(async () => {
    grid.innerHTML = '<div style="text-align:center;color:#bbb;padding:40px 0;">Searching...</div>';

    try {
      const response = await fetch(`${API_URL}/search?q=${encodeURIComponent(query.trim())}`);
      if (!response.ok) throw new Error('Search request failed');
      const data = await response.json();
      searchResults = data.results || [];

      if (searchResults.length === 0) {
        grid.innerHTML = '<p style="text-align:center;color:#bbb;padding:40px 0;">No topics found matching "' + query + '"</p>';
        return;
      }

      const resultsHtml = '<div class="explore-grid">' + searchResults.map((lesson, idx) => {
        const title = cleanTitle(lesson.title, lesson.topic);
        return `
          <div class="explore-category-card" onclick="openSearchResult(${idx})" style="cursor:pointer;">
            <div class="explore-category-icon" style="background:#667eea;color:white;font-size:1.8em;border-radius:14px;">📚</div>
            <div class="explore-category-card-text">
              <div class="explore-category-card-title">${title}</div>
              <div class="explore-category-card-count">${lesson.categoryName}</div>
            </div>
          </div>`;
      }).join('') + '</div>';

      grid.innerHTML = resultsHtml;
    } catch (error) {
      console.error('Search error:', error);
      grid.innerHTML = '<p style="color:#f00;text-align:center;">Error searching topics</p>';
    }
  }, 300);
}

function openSearchResult(index) {
  if (searchResults[index]) {
    const learnedIds = JSON.parse(localStorage.getItem(LEARNED_LESSONS_KEY) || '[]');
    const lessonId = `${searchResults[index].categoryId}-${searchResults[index].topic}-${index}`;

    if (!learnedIds.includes(lessonId)) {
      learnedIds.push(lessonId);
      localStorage.setItem(LEARNED_LESSONS_KEY, JSON.stringify(learnedIds));
      saveLessonToStreak(searchResults[index].topic, lessonId, searchResults[index]);
      updateStreakDisplay();
    }

    displayFullLesson(searchResults[index]);
  }
}

// Map subcategory names to engaging icons and colors
function toTitleCase(str) {
  const minor = new Set(['a','an','the','and','but','or','for','nor','on','at','to','by','in','of','up','as']);
  return str.toLowerCase()
    .split(' ')
    .map((w, i) => (i === 0 || !minor.has(w)) ? w.charAt(0).toUpperCase() + w.slice(1) : w)
    .join(' ');
}

const subcategoryMeta = {
  'GENETICS_HEREDITY':                              { name: 'Genetics & Heredity',         icon: '🧬', color: '#e8f5e9' },
  'EVOLUTIONARY_MARVELS_ORIGINS':                   { name: 'Evolution & Origins',          icon: '🦎', color: '#c8e6c9' },
  'HUMAN_EVOLUTION_ORIGINS_FINISHEDEDIT':           { name: 'Human Evolution',              icon: '👤', color: '#a5d6a7' },
  'CELLULAR_BIOLOGY':                               { name: 'Cellular Biology',             icon: '🔬', color: '#81c784' },
  'BOTANY_PLANT_SCIENCE':                           { name: 'Plant Science',                icon: '🌿', color: '#66bb6a' },
  'EXTREME_PHYSICS':                                { name: 'Extreme Physics',              icon: '⚡', color: '#fff9c4' },
  'NANOTECHNOLOGY_THE_INCREDIBLY_TINY':             { name: 'Nanotechnology',               icon: '🔭', color: '#ffeb3b' },
  'CHEMISTRY_THE_ELEMENTS':                         { name: 'Chemistry & Elements',         icon: '⚗️', color: '#fdd835' },
  'BIOCHEMICAL_WONDERS_MOLECULAR_MACHINES':         { name: 'Biochemistry',                 icon: '🧪', color: '#fbc02d' },
  'MATHEMATICS_BEYOND_NUMBERS':                     { name: 'Mathematics',                  icon: '📐', color: '#fab005' },
  'MEDICINE_DISEASE_BREAKTHROUGHS':                 { name: 'Medicine & Disease',           icon: '💊', color: '#ffccbc' },
  'MEDICAL_MIRACLES_BIOLOGICAL_PUZZLES':            { name: 'Medical Mysteries',            icon: '⚕️', color: '#ffab91' },
  'NEUROSCIENCE_BRAIN_FUNCTION':                    { name: 'Neuroscience',                 icon: '🧠', color: '#ff8a65' },
  'PSYCHOLOGY_HUMAN_BEHAVIOR':                      { name: 'Psychology',                   icon: '🎯', color: '#ff7043' },
  'IMMUNOLOGY_DEFENSE_SYSTEMS_FINISHEDEDIT':        { name: 'Immunology',                   icon: '🛡️', color: '#ff5722' },
  'INCREDIBLE_HUMAN_BIOLOGY_FINISHEDEDIT':          { name: 'Human Biology',                icon: '💪', color: '#e64a19' },
  'WEIRD_ANIMAL_ABILITIES_MYSTERIES':               { name: 'Animal Abilities',             icon: '🦑', color: '#f3e5f5' },
  'SENSORY_SUPERPOWERS_HIDDEN_PERCEPTION':          { name: 'Sensory Superpowers',          icon: '👁️', color: '#e1bee7' },
  'PALEONTOLOGY_PREHISTORIC_LIFE':                  { name: 'Prehistoric Life',             icon: '🦴', color: '#ce93d8' },
  'ECOLOGY_ECOSYSTEMS':                             { name: 'Ecology & Ecosystems',         icon: '🌱', color: '#ba68c8' },
  'EXTREME_ADAPTATIONS_SURVIVAL_STRATEGIES_FINISHEDEDIT': { name: 'Survival Strategies',   icon: '🦁', color: '#ab47bc' },
  'IMPOSSIBLE_FEATS_OF_NATURE_FINISHEDEDIT':        { name: 'Impossible Feats of Nature',   icon: '🌈', color: '#9c27b0' },
  'INCREDIBLE_NATURAL_PHENOMENA_FINISHEDEDIT':      { name: 'Natural Phenomena',            icon: '⛈️', color: '#8e24aa' },
  'OCEAN_EXPLORATION_MARINE_MYSTERIES':             { name: 'Ocean Exploration',            icon: '🌊', color: '#b3e5fc' },
  'OCEAN_MYSTERIES_DEEP_SEA_WONDERS':               { name: 'Deep Sea Wonders',             icon: '🐙', color: '#81d4fa' },
  'ASTRONOMY_CELESTIAL_OBJECTS':                    { name: 'Stars & Celestial Objects',    icon: '🌟', color: '#e0f2f1' },
  'ASTRONOMY_PHENOMENA':                            { name: 'Astronomical Phenomena',       icon: '🌌', color: '#b2dfdb' },
  'SPACE_COSMIC_MYSTERIES':                         { name: 'Space Mysteries',              icon: '🚀', color: '#80cbc4' },
  'COSMIC_CATASTROPHES_FUTURE_THREATS':             { name: 'Cosmic Catastrophes',          icon: '☄️', color: '#4db6ac' },
  'ENVIRONMENTAL_SCIENCE_CLIMATE':                  { name: 'Climate & Environment',        icon: '🌍', color: '#c8e6c9' },
  'WORLD_GEOGRAPHY_HIDDEN_WONDERS':                 { name: 'World Geography',              icon: '🗺️', color: '#a5d6a7' },
  'GEOLOGY_EARTH_SCIENCE_FINISHEDEDIT':             { name: 'Geology',                      icon: '🪨', color: '#81c784' },
  'CATASTROPHES':                                   { name: 'Natural Disasters',            icon: '🌋', color: '#66bb6a' },
  'DANGEROUS_EXTREME_PHENOMENA':                    { name: 'Extreme Phenomena',            icon: '⚠️', color: '#558b2f' },
  'ARTIFICIAL_INTELLIGENCE_MACHINE_LEARNING':       { name: 'AI & Machine Learning',        icon: '🤖', color: '#f3e5f5' },
  'COMPUTER_SCIENCE_BREAKTHROUGHS':                 { name: 'Computer Science',             icon: '💻', color: '#e1bee7' },
  'CRYPTOGRAPHY_SECURITY':                          { name: 'Cryptography',                 icon: '🔐', color: '#ce93d8' },
  'ROBOTICS_AUTOMATION':                            { name: 'Robotics & Automation',        icon: '⚙️', color: '#ba68c8' },
  'ENGINEERING_IMPOSSIBILITIES_THAT_ACTUALLY_EXIST':{ name: 'Engineering Wonders',          icon: '🏗️', color: '#ab47bc' },
  'TECHNOLOGICAL_BREAKTHROUGHS_INVENTIONS':         { name: 'Great Inventions',             icon: '💡', color: '#9c27b0' },
  'TECHNOLOGY_THAT_CHANGED_EVERYTHING':             { name: 'World-Changing Tech',          icon: '📱', color: '#8e24aa' },
  'TRANSPORTATION_EVOLUTION':                       { name: 'Transportation',               icon: '🚗', color: '#7b1fa2' },
  'BIOTECHNOLOGY_GENETIC_ENGINEERING':              { name: 'Biotechnology',                icon: '🧬', color: '#6a1b9a' },
  'MICROBIOLOGY_TINY_ORGANISMS':                    { name: 'Microbiology',                 icon: '🦠', color: '#4a148c' },
  'ANCIENT_MYSTERIES_LOST_CIVILIZATIONS':           { name: 'Ancient Civilizations',        icon: '🏛️', color: '#ffe0b2' },
  'ARCHAEOLOGICAL_DISCOVERIES_MYSTERIES_FINISHEDEDIT': { name: 'Archaeological Discoveries',icon: '🏺', color: '#ffcc80' },
  'FAMOUS_HISTORICAL_FIGURES_THEIR_SECRETS':        { name: 'Famous Historical Figures',    icon: '👑', color: '#ffb74d' },
  'MILITARY_HISTORY_WARFARE':                       { name: 'Military History',             icon: '⚔️', color: '#ffa726' },
  'EXPLORATION_DISCOVERY':                          { name: 'Age of Exploration',           icon: '🧭', color: '#ff9800' },
  'LOST_TECHNOLOGIES_ANCIENT_KNOWLEDGE':            { name: 'Lost Technologies',            icon: '🔮', color: '#f57c00' },
  'SOCIAL_MOVEMENTS_HISTORY':                       { name: 'Social Movements',             icon: '✊', color: '#e65100' },
  'RELIGIOUS_HISTORY_BELIEF_SYSTEMS':               { name: 'World Religions',              icon: '🕉️', color: '#bf360c' },
  'ART_MOVEMENTS_ARTISTIC_REVOLUTIONS':             { name: 'Art Movements',                icon: '🎨', color: '#fce4ec' },
  'ART_MOVEMENTS_ARTISTIC_REVOLUTIONS_PARTIAL':     { name: 'Art Movements',                icon: '🖼️', color: '#f8bbd0' },
  'MUSIC_MUSICIANS_THROUGH_HISTORY':                { name: 'Music History',                icon: '🎵', color: '#f48fb1' },
  'LITERATURE_WORLD_AUTHORS':                       { name: 'Literature & Authors',         icon: '📚', color: '#f06292' },
  'LANGUAGES_LINGUISTICS':                          { name: 'Languages & Linguistics',      icon: '🗣️', color: '#ec407a' },
  'ARCHITECTURE_BUILT_WONDERS':                     { name: 'Architecture',                 icon: '🏰', color: '#e91e63' },
  'BEHAVIORAL_SCIENCE':                             { name: 'Behavioral Science',           icon: '🎭', color: '#d1c4e9' },
  'PHILOSOPHY_BIG_QUESTIONS':                       { name: 'Philosophy',                   icon: '🤔', color: '#e1f5fe' },
  'MYSTERIES_OF_CONSCIOUSNESS_THE_MIND':            { name: 'Consciousness & the Mind',     icon: '💭', color: '#b3e5fc' },
  'UNSOLVED_MYSTERIES_UNEXPLAINED_PHENOMENA':       { name: 'Unsolved Mysteries',           icon: '👻', color: '#fff9c4' },
  'ECONOMICS_ECONOMIC_SYSTEMS_FINISHEDEDIT':        { name: 'Economics',                    icon: '💰', color: '#fff59d' },
  'LEGAL_SYSTEM_JUSTICE_ODDITIES':                  { name: 'Law & Justice',                icon: '⚖️', color: '#fff176' },
  'SPORTS_RECORDS_ATHLETIC_EXTREMES':               { name: 'Sports & Records',             icon: '🏆', color: '#ffee58' },
  'WORLD_RECORDS_EXTREME_ACHIEVEMENTS':             { name: 'World Records',                icon: '🥇', color: '#ffeb3b' }
};

async function loadCategoryLessonsView(categoryId, categoryName) {
  const grid = document.getElementById('topicsGrid');
  window.scrollTo({ top: 0, behavior: 'instant' });
  setExploreBack(() => loadLessonCards());
  setExploreTitle(categoryName);

  grid.innerHTML = '<div style="text-align:center;color:#bbb;padding:40px 0;">Loading...</div>';

  const ACCENT_COLORS = [
    '#667eea','#f59e0b','#10b981','#ef4444','#8b5cf6',
    '#06b6d4','#f97316','#ec4899','#14b8a6','#6366f1'
  ];

  try {
    const lessons = await loadCategoryLessons(categoryId);

    const rows = lessons.map((lesson, idx) => {
      const color = ACCENT_COLORS[idx % ACCENT_COLORS.length];
      const rawText = typeof lesson.lesson === 'string' ? lesson.lesson : (lesson.lesson?.learn || lesson.lesson?.overview || '');
      const lessonText = typeof rawText === 'string' ? rawText : '';
      const preview = lessonText.substring(0, 100);
      const imgUrl = cleanImageUrl(lesson.image);
      const thumbHtml = imgUrl
        ? `<img class="lesson-thumb" src="${imgUrl}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : '';
      return `
      <div class="explore-category-row" data-lesson-idx="${idx}" data-accent="${color}" onclick="selectLessonFromCard('${categoryId}', ${idx})">
        <div class="lesson-accent-bar" style="background:${color};"></div>
        <div class="explore-category-info">
          <div class="explore-category-name">${cleanTitle(lesson.title, lesson.topic)}</div>
          <div class="explore-category-desc">${preview}${preview.length >= 100 ? '…' : ''}</div>
        </div>
        ${thumbHtml}
        ${isLessonRead(lesson)
          ? `<svg class="lesson-read-tick" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#ecfdf5"/><polyline points="7 12 10.5 15.5 17 9" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
          : `<svg class="lesson-chevron" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" style="width:18px;height:18px;"><polyline points="9 18 15 12 9 6"/></svg>`
        }
      </div>`;
    }).join('');

    grid.innerHTML = rows || '<p style="text-align:center;color:#bbb;padding:40px 0;">No lessons found.</p>';
  } catch (error) {
    console.error('Error:', error);
    grid.innerHTML = '<p style="color:#f00;text-align:center;">Failed to load lessons</p>';
  }
}

async function selectLessonFromCard(category, index) {
  try {
    const lessons = await loadCategoryLessons(category);

    // Store all lessons for navigation
    currentLessonsArray = lessons;
    currentCardIndex = index;
    currentCategory = category;

    const lesson = lessons[index];

    if (lesson) {
      // Mark as learned
      const learnedIds = JSON.parse(localStorage.getItem(LEARNED_LESSONS_KEY) || '[]');
      const lessonId = `${category}-${lesson.topic}-${index}`;

      if (!learnedIds.includes(lessonId)) {
        learnedIds.push(lessonId);
        localStorage.setItem(LEARNED_LESSONS_KEY, JSON.stringify(learnedIds));
        saveLessonToStreak(lesson.topic, lessonId, lesson);
        updateStreakDisplay();
      }

      saveExploredTopic(category);
      displayFullLesson(lesson);
    }
  } catch (error) {
    console.error('Error selecting lesson:', error);
    alert('Failed to load lesson');
  }
}

function getTopicLesson(topic) {
  const btn = event.target;
  btn.disabled = true;
  btn.innerHTML = '<div class="loading"></div>';

  try {
    // Get a random lesson from the specific topic (not already learned)
    let lesson = null;
    let attempts = 0;
    const maxAttempts = 5;

    // Try up to 5 times to find an unlearned lesson from this topic
    while (attempts < maxAttempts) {
      lesson = getRandomLessonFromPool(topic);
      if (lesson) break;
      attempts++;
    }

    if (!lesson) {
      alert(`You've learned all ${topic} lessons! Try another topic.`);
    } else {
      displayLesson(lesson, 'explorerLesson');
      const learnedIds = JSON.parse(localStorage.getItem(LEARNED_LESSONS_KEY) || '[]');
      learnedIds.push(lesson.id);
      localStorage.setItem(LEARNED_LESSONS_KEY, JSON.stringify(learnedIds));
      saveLessonToStreak(lesson.topic, lesson.id, lesson);
      updateStreakDisplay();
    }

    saveExploredTopic(topic);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    btn.disabled = false;
    btn.innerHTML = topic;
  }
}

// Learning Streak
async function getStreakLesson() {
  const btn = event.target;
  btn.disabled = true;
  btn.innerHTML = '<div class="loading"></div>';

  try {
    const lesson = await getRandomLesson();

    if (!lesson) {
      alert('You\'ve learned all available lessons! Great job! 🎉');
    } else {
      displayLesson(lesson, 'streakLesson');
      const learnedIds = JSON.parse(localStorage.getItem(LEARNED_LESSONS_KEY) || '[]');
      learnedIds.push(lesson.topic);
      localStorage.setItem(LEARNED_LESSONS_KEY, JSON.stringify(learnedIds));
      saveLessonToStreak(lesson.topic, lesson.topic, lesson);
    }

    updateStreakDisplay();
  } catch (error) {
    console.error('Error:', error);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Get Today\'s Lesson (+10 XP)';
  }
}

// Quiz system
function generateQuiz(lesson) {
  const questions = [];
  const content = lesson.lesson || lesson;

  // Question 1: Key takeaway true/false
  if (content.keyTakeaway) {
    questions.push({
      type: 'true-false',
      question: `Key Concept: "${content.keyTakeaway}"`,
      correctAnswer: true,
      options: ['True', 'False']
    });
  }

  // Question 2: Fun fact recognition
  if (content.funFact) {
    questions.push({
      type: 'multiple-choice',
      question: 'Which of these is TRUE based on this lesson?',
      correctAnswer: 0,
      options: [
        content.funFact,
        'This topic was invented in 2020',
        'This concept is no longer relevant'
      ]
    });
  }

  // Question 3: Topic recognition
  if (lesson.relatedTopics && lesson.relatedTopics.length > 0) {
    const correctTopic = lesson.topic;
    const wrongTopics = lesson.relatedTopics.slice(0, 2);
    const allOptions = [correctTopic, ...wrongTopics].sort(() => Math.random() - 0.5);

    questions.push({
      type: 'multiple-choice',
      question: 'What was the main topic of this lesson?',
      correctAnswer: allOptions.indexOf(correctTopic),
      options: allOptions
    });
  }

  return questions.slice(0, 3);
}

function displayQuiz(lesson) {
  const questions = generateQuiz(lesson);
  let currentQuestion = 0;
  let correctAnswers = 0;

  const modal = document.createElement('div');
  modal.className = 'quiz-modal';

  function showQuestion() {
    if (currentQuestion >= questions.length) {
      // Quiz complete
      const bonusXP = correctAnswers * 5;
      const streak = JSON.parse(localStorage.getItem(STREAK_KEY) || '{"xp":0}');
      streak.xp = (streak.xp || 0) + bonusXP;
      localStorage.setItem(STREAK_KEY, JSON.stringify(streak));

      modal.innerHTML = `
        <div class="quiz-content">
          <h2>Quiz Complete! 🎉</h2>
          <p style="font-size: 1.2em; margin: 20px 0;">You got ${correctAnswers}/${questions.length} correct!</p>
          <p style="color: #667eea; font-weight: 700; font-size: 1.1em;">+${bonusXP} Bonus XP!</p>
          <button class="btn btn-primary" onclick="this.parentElement.parentElement.remove(); updateStreakDisplay();" style="margin-top: 20px;">Continue</button>
        </div>
      `;
      return;
    }

    const question = questions[currentQuestion];
    modal.innerHTML = `
      <div class="quiz-content">
        <h3>Question ${currentQuestion + 1}/${questions.length}</h3>
        <div class="quiz-question">
          <div class="quiz-question-text">${question.question}</div>
          <div class="quiz-options">
            ${question.options.map((option, idx) => `
              <button class="quiz-option" onclick="checkAnswer(${idx}, ${question.correctAnswer}, ${currentQuestion})">
                ${option}
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  window.checkAnswer = function(selectedIdx, correctIdx, qIdx) {
    const isCorrect = selectedIdx === correctIdx;
    if (isCorrect) correctAnswers++;

    const options = modal.querySelectorAll('.quiz-option');
    options.forEach((opt, idx) => {
      if (idx === correctIdx) opt.classList.add('correct');
      if (idx === selectedIdx && !isCorrect) opt.classList.add('incorrect');
      opt.disabled = true;
      opt.style.pointerEvents = 'none';
    });

    setTimeout(() => {
      currentQuestion++;
      showQuestion();
    }, 1500);
  };

  document.body.appendChild(modal);
  modal.onclick = (e) => {
    if (e.target === modal) return;
  };

  showQuestion();
}

// Global lesson card state
let currentLessonsArray = [];
let currentCardIndex = 0;
let currentCategory = null;
let currentLesson = null;

// Called from Android widget/notification tap to open a specific lesson
window.openLessonFromNative = async function(folder, id) {
  try {
    const categoriesData = await loadCategories();
    if (!categoriesData) return;

    // Strip _FINISHEDEDIT / _PARTIAL / _FINISHEDEDITED suffixes for loose matching
    const normalize = s => s.replace(/_(FINISHEDEDIT|FINISHEDEDITED|PARTIAL)$/i, '');
    const folderBase = normalize(folder);

    const parent = categoriesData.categories.find(c =>
      c.subCategories && c.subCategories.some(s =>
        s === folder || normalize(s) === folderBase
      )
    );
    if (!parent) return;
    const lessons = await loadCategoryLessons(parent.id);
    const lesson = lessons.find(l => l._id === id);
    if (lesson) {
      currentLessonsArray = lessons.filter(l => l.subcategory === lesson.subcategory);
      currentCardIndex = currentLessonsArray.indexOf(lesson);
      displayFullLesson(lesson);
    }
  } catch(e) { console.error('openLessonFromNative:', e); }
};

// Display lesson full view
function displayFullLesson(lesson) {
  currentLesson = lesson;
  stopTTS();
  startReadTimer();
  // Kick off image fetch immediately so it's in the browser cache by render time
  const _preloadUrl = cleanImageUrl(lesson.image || (lesson.lesson && lesson.lesson.image));
  if (_preloadUrl) { const _img = new Image(); _img.src = _preloadUrl; }
  // Preload second image too
  const _learnImageUrl = cleanImageUrl(lesson.learnImage || (lesson.lesson && lesson.lesson.learnImage));
  if (_learnImageUrl) { const _img2 = new Image(); _img2.src = _learnImageUrl; }
  // Preload third image too
  const _thirdImageUrl = cleanImageUrl(lesson.thirdImage || (lesson.lesson && lesson.lesson.thirdImage));
  if (_thirdImageUrl) { const _img3 = new Image(); _img3.src = _thirdImageUrl; }
  const content = lesson.lesson || lesson;
  const keyElements = content.keyElements || lesson.keyElements;

  let keyElementsHtml = '';
  if (keyElements) {
    let elementContent = '';
    if (keyElements.people?.length) {
      elementContent += `<div class="key-element-item"><span class="key-element-label">People:</span> <span class="key-element-values">${keyElements.people.join(', ')}</span></div>`;
    }
    if (keyElements.places?.length) {
      elementContent += `<div class="key-element-item"><span class="key-element-label">Places:</span> <span class="key-element-values">${keyElements.places.join(', ')}</span></div>`;
    }
    if (keyElements.years?.length) {
      elementContent += `<div class="key-element-item"><span class="key-element-label">Years:</span> <span class="key-element-values">${keyElements.years.join(', ')}</span></div>`;
    }
    if (keyElements.concepts?.length) {
      elementContent += `<div class="key-element-item"><span class="key-element-label">Concepts:</span> <span class="key-element-values">${keyElements.concepts.join(', ')}</span></div>`;
    }
    if (elementContent) {
      keyElementsHtml = `
        <div class="lesson-section key-elements-section">
          <div class="lesson-section-content key-elements-content">${elementContent}</div>
        </div>
      `;
    }
  }

  const references = content.references || lesson.references;
  let referencesHtml = '';
  if (references?.length) {
    const items = references.map(r => `<li>${r}</li>`).join('');
    referencesHtml = `
      <div class="lesson-section references-section">
        <div class="lesson-section-title">References</div>
        <div class="lesson-section-content"><ul class="references-list">${items}</ul></div>
      </div>
    `;
  }

  let modal = document.getElementById('fullLessonModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'fullLessonModal';
    modal.className = 'full-lesson-modal';
    document.body.appendChild(modal);
  }

  const imageUrl = cleanImageUrl(lesson.image || (lesson.lesson && lesson.lesson.image));
  const heroCredit = imageCreditHtml(lesson.imageCredit || (lesson.lesson && lesson.lesson.imageCredit));
  const midCredit   = imageCreditHtml(content.learnImageCredit || lesson.learnImageCredit);
  const thirdCredit = imageCreditHtml(content.thirdImageCredit || lesson.thirdImageCredit);
  modal.innerHTML = `
    <div class="full-lesson-header">
      <button class="close-btn" onclick="closeFullLesson()">←Back</button>
      <div class="lesson-header-actions">
        <button class="tts-btn" id="ttsBtn" onclick="toggleTTS(currentLesson)" title="Listen">${TTS_ICON_PLAY}</button>
        <button class="share-fact-btn" onclick="shareFactCard(currentLesson)" title="Share fact card">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        </button>
      </div>
      <div class="lesson-progress">${currentCardIndex + 1} / ${currentLessonsArray.length}</div>
    </div>

    <div class="full-lesson-content">
      ${imageUrl ? `<div class="lesson-hero-image"><img src="${imageUrl}" alt="${cleanTitle(lesson.title, lesson.topic)}" loading="lazy">${heroCredit}</div>` : ''}
      <h2>${cleanTitle(lesson.title, lesson.topic)}</h2>
      ${!shouldHideTopicTag(lesson.title) ? `<span class="topic-tag">${lesson.topic}</span>` : ''}

      <div class="lesson-section fun-fact-section">
        <div class="lesson-section-title">Did You Know?</div>
        <div class="lesson-section-content">${content.funFact || ''}</div>
      </div>

      ${content.simpler ? `
        <div class="lesson-section">
          <div class="lesson-section-title">TL;DR</div>
          <div class="lesson-section-content">${content.simpler}</div>
        </div>
      ` : ''}

      <div class="lesson-section">
        <div class="lesson-section-content">${content.learn || content.explanation || ''}</div>
      </div>

      ${_learnImageUrl ? `
        <div class="lesson-mid-image">
          <img src="${_learnImageUrl}" alt="${cleanTitle(lesson.title, lesson.topic)} - mid" loading="lazy">
          ${midCredit}
        </div>
      ` : ''}

      ${content.deeperDive ? `
        <div class="lesson-section">
          <div class="lesson-section-content">${content.deeperDive}</div>
        </div>
      ` : ''}

      ${_thirdImageUrl ? `
        <div class="lesson-mid-image">
          <img src="${_thirdImageUrl}" alt="${cleanTitle(lesson.title, lesson.topic)} - extra" loading="lazy">
          ${thirdCredit}
        </div>
      ` : ''}

      <div class="lesson-section">
        <div class="lesson-section-content"><strong>${content.keyTakeaway || ''}</strong></div>
      </div>

      ${keyElementsHtml}
      ${referencesHtml}

      <div class="quiz-cta">
        <button class="quiz-cta-btn" id="quizBtn" onclick="loadQuiz(currentLesson)">Take Quiz</button>
      </div>
    </div>
  `;

  modal.style.display = 'block';
  document.body.style.overflow = 'hidden';

  let readMarked = isLessonRead(lesson);
  const scrollEl = modal.querySelector('.full-lesson-content');
  if (scrollEl && !readMarked) {
    function checkScrollBottom() {
      const nearBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 120;
      if (nearBottom) {
        readMarked = true;
        markLessonRead(lesson);
        scrollEl.removeEventListener('scroll', checkScrollBottom);
      }
    }
    scrollEl.addEventListener('scroll', checkScrollBottom);
  }
}

function closeFullLesson() {
  stopTTS();
  closeQuiz();
  const modal = document.getElementById('fullLessonModal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';

  // Swap chevron → tick in-place so the read state shows immediately on the list
  const lesson = currentLessonsArray[currentCardIndex];
  if (lesson && isLessonRead(lesson)) {
    const row = document.querySelector(`.explore-category-row[data-lesson-idx="${currentCardIndex}"]`);
    if (row) {
      const svg = row.querySelector('svg');
      if (svg && !svg.classList.contains('lesson-read-tick')) {
        svg.outerHTML = `<svg class="lesson-read-tick" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#ecfdf5"/><polyline points="7 12 10.5 15.5 17 9" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      }
    }
  }

  currentLessonsArray = [];
  currentCardIndex = 0;
}

function showLessonCard() {
  if (currentCardIndex >= currentLessonsArray.length) {
    closeLessonCards();
    alert('You\'ve browsed through all lessons in this category!');
    return;
  }

  const lesson = currentLessonsArray[currentCardIndex];
  const content = lesson.lesson || lesson;

  let card = document.getElementById('lessonCard');
  if (!card) {
    card = document.createElement('div');
    card.id = 'lessonCard';
    card.className = 'lesson-card-view';
    document.body.appendChild(card);
    setupCardSwipeGestures(card);
  }

  card.innerHTML = `
    <div class="lesson-card-header">
      <button class="close-btn" onclick="closeLessonCards()">×</button>
    </div>

    <div class="lesson-card-preview">
      <div class="lesson-card-category">${lesson.topic}</div>
      <h3>${cleanTitle(lesson.title, lesson.topic)}</h3>
      <p class="preview-text">${(content.learn || content.explanation || '').substring(0, 150)}...</p>

      <div class="card-question">Does this sound interesting?</div>
    </div>

    <div class="lesson-card-actions">
      <button class="action-btn skip-btn" onclick="skipCard()">
        ← Not now
      </button>
      <button class="action-btn learn-btn" onclick="acceptCard()">
        Learn →
      </button>
    </div>

    <div class="swipe-hint">Swipe left or right</div>
  `;

  card.style.display = 'flex';
}

function skipCard() {
  currentCardIndex++;
  showLessonCard();
}

function acceptCard() {
  const lesson = currentLessonsArray[currentCardIndex];

  const learnedIds = JSON.parse(localStorage.getItem(LEARNED_LESSONS_KEY) || '[]');
  const lessonId = `${currentCategory}-${lesson.topic}-${currentCardIndex}`;

  if (!learnedIds.includes(lessonId)) {
    learnedIds.push(lessonId);
    localStorage.setItem(LEARNED_LESSONS_KEY, JSON.stringify(learnedIds));
    saveLessonToStreak(lesson.topic, lessonId, lesson);
    updateStreakDisplay();
  }

  displayFullLesson(lesson);
}

function closeLessonCards() {
  stopReadTimer();
  const card = document.getElementById('lessonCard');
  if (card) {
    card.style.display = 'none';
  }
  currentLessonsArray = [];
  currentCardIndex = 0;
}

function setupCardSwipeGestures(element) {
  let touchStartX = 0;

  element.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
  }, false);

  element.addEventListener('touchend', (e) => {
    const touchEndX = e.changedTouches[0].screenX;
    const diff = touchStartX - touchEndX;
    const threshold = 50;

    if (Math.abs(diff) > threshold) {
      if (diff > 0) {
        acceptCard();
      } else {
        skipCard();
      }
    }
  }, false);
}

// Streak management
function saveLessonToStreak(topic, lessonId, lessonObject) {
  const today = new Date().toDateString();
  const nowTimestamp = Date.now();
  const streak = JSON.parse(localStorage.getItem(STREAK_KEY) || '{"count": 0, "lastStreakTime": null, "lessons": [], "xp": 0}');
  const learnedIds = JSON.parse(localStorage.getItem(LEARNED_LESSONS_KEY) || '[]');

  const lessons = JSON.parse(localStorage.getItem(LESSONS_KEY) || '[]');

  // Only count XP/streak once per unique lesson
  // But save every lesson to history
  const lessonAlreadyLearned = lessons.some(l => l.id === lessonId);

  // Always save lesson to history
  if (!lessonAlreadyLearned) {
    lessons.push({
      id: lessonId,
      topic,
      date: today,
      lesson: lessonObject // Store full lesson data
    });
    localStorage.setItem(LESSONS_KEY, JSON.stringify(lessons));

    let xpGained = 10;

    // Check daily bonus
    const dailyBonus = checkDailyBonus();
    if (dailyBonus > 0) {
      xpGained += dailyBonus;
      showBonusNotification(dailyBonus);
    }

    // Add XP for each NEW lesson
    streak.xp = (streak.xp || 0) + xpGained;

    // Check if at least 23h 59m 59s (86399 seconds) have passed for streak increment
    const STREAK_INTERVAL = 86399000; // 23h 59m 59s in milliseconds
    const STREAK_RESET = 86400000;   // 24 hours in milliseconds
    const lastStreakTime = streak.lastStreakTime ? parseInt(streak.lastStreakTime) : null;
    const timeSinceLastStreak = lastStreakTime ? nowTimestamp - lastStreakTime : Infinity;

    if (timeSinceLastStreak >= STREAK_INTERVAL) {
      // Enough time has passed to increment streak
      if (lastStreakTime && timeSinceLastStreak < STREAK_RESET) {
        // Still within 24h window - increment streak
        streak.count++;
        streak.xp += 5; // Streak bonus
      } else if (!lastStreakTime) {
        // First streak
        streak.count = 1;
      } else {
        // More than 24h passed - reset streak to 1
        streak.count = 1;
      }
      streak.lastStreakTime = nowTimestamp;
    }

    localStorage.setItem(STREAK_KEY, JSON.stringify(streak));
  }
}

function saveExploredTopic(topic) {
  const topics = JSON.parse(localStorage.getItem(TOPICS_KEY) || '[]');
  if (!topics.includes(topic)) {
    topics.push(topic);
    localStorage.setItem(TOPICS_KEY, JSON.stringify(topics));
  }
}

function updateStreakDisplay() {
  const streak = JSON.parse(localStorage.getItem(STREAK_KEY) || '{"count": 0, "lastDate": null, "xp": 0}');
  const lessons = JSON.parse(localStorage.getItem(LESSONS_KEY) || '[]');
  const topics = JSON.parse(localStorage.getItem(TOPICS_KEY) || '[]');

  document.getElementById('streakCount').textContent = streak.count;
  document.getElementById('totalLessons').textContent = lessons.length;
  document.getElementById('minutesReading').textContent = getTotalReadMinutes();

  updateLevelDisplay();
  displayLearningHistory();
  displayAchievements();
}

function updateLevelDisplay() {
  const streak = JSON.parse(localStorage.getItem(STREAK_KEY) || '{"count": 0, "xp": 0}');
  const lessons = JSON.parse(localStorage.getItem(LESSONS_KEY) || '[]');

  const totalXP = streak.xp || (lessons.length * 10);
  const currentLevel = Math.floor(totalXP / 100) + 1;
  const lastLevel = parseInt(localStorage.getItem(LAST_LEVEL_KEY) || '1');
  const xpInLevel = totalXP % 100;
  const nextLevelXP = 100;

  // Celebrate level up
  if (currentLevel > lastLevel) {
    celebrateLevelUp(currentLevel);
    localStorage.setItem(LAST_LEVEL_KEY, currentLevel.toString());
  }

  document.getElementById('userLevel').textContent = currentLevel;
  document.getElementById('xpProgress').style.width = (xpInLevel / nextLevelXP * 100) + '%';
  document.getElementById('xpText').textContent = `${xpInLevel} / ${nextLevelXP} XP`;
}

function displayLearningHistory() {
  const lessons = JSON.parse(localStorage.getItem(LESSONS_KEY) || '[]');
  const historyContent = document.getElementById('historyContent');
  const filterTabs = document.querySelector('.filter-tabs');

  if (!historyContent) return;

  // Hide filter tabs
  if (filterTabs) filterTabs.style.display = 'none';

  // Get unique topics (only most recent lesson per topic)
  const topicMap = {};
  lessons.forEach(lesson => {
    if (!topicMap[lesson.topic] || new Date(lesson.date) > new Date(topicMap[lesson.topic].date)) {
      topicMap[lesson.topic] = lesson;
    }
  });
  const uniqueLessons = Object.values(topicMap);

  if (uniqueLessons.length === 0) {
    historyContent.innerHTML = '<p style="text-align: center; color: #999; padding: 40px 0;">No lessons yet. Start learning to see your history!</p>';
    return;
  }

  historyContent.innerHTML = uniqueLessons.map(lesson =>
    `<div class="history-card" onclick="loadHistoryLesson('${lesson.id.toString()}')" style="cursor: pointer;">
      <div class="history-card-title">${lesson.topic}</div>
      <div class="history-card-meta">${new Date(lesson.date).toLocaleDateString()}</div>
    </div>`
  ).join('');
}

function filterByTopic(topic) {
  document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));

  if (topic === 'all') {
    document.querySelector('.filter-btn').classList.add('active');
  } else {
    event.target.classList.add('active');
  }

  displayLearningHistory();
}

function loadHistoryLesson(lessonId) {
  const lessons = JSON.parse(localStorage.getItem(LESSONS_KEY) || '[]');
  const historyLesson = lessons.find(l => l.id.toString() === lessonId);

  if (historyLesson) {
    if (historyLesson.lesson) {
      // Display lesson in a modal
      const modal = document.createElement('div');
      modal.id = 'lessonModal';
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.6);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
        padding: 20px;
        overflow-y: auto;
      `;

      const modalContent = document.createElement('div');
      modalContent.style.cssText = `
        background: white;
        border-radius: 16px;
        padding: 40px;
        max-width: 800px;
        max-height: 90vh;
        overflow-y: auto;
        position: relative;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      `;

      // Add close button
      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = '✕';
      closeBtn.style.cssText = `
        position: absolute;
        top: 20px;
        right: 20px;
        background: none;
        border: none;
        font-size: 28px;
        cursor: pointer;
        color: #999;
      `;
      closeBtn.onclick = () => modal.remove();
      modalContent.appendChild(closeBtn);

      // Create a temp div to hold lesson content
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = `
        <h3>${cleanTitle(historyLesson.lesson.title, historyLesson.lesson.topic)}</h3>
        ${!shouldHideTopicTag(historyLesson.lesson.title) ? `<span class="topic-tag">${historyLesson.lesson.topic}</span>` : ''}

        <div class="lesson-section">
          <div class="lesson-section-title">📖 Learn</div>
          <div class="lesson-section-content">${historyLesson.lesson.explanation}</div>
        </div>

        ${historyLesson.lesson.simpler ? `
          <div class="lesson-section">
            <div class="lesson-section-title">👶 For Dummies</div>
            <div class="lesson-section-content">${historyLesson.lesson.simpler}</div>
          </div>
        ` : ''}

        <div class="lesson-section">
          <div class="lesson-section-title">💡 Key Takeaway</div>
          <div class="lesson-section-content"><strong>${historyLesson.lesson.keyTakeaway}</strong></div>
        </div>

        ${historyLesson.lesson.deeperDive ? `
          <div class="lesson-section">
            <div class="lesson-section-title">🔬 Deeper Dive</div>
            <div class="lesson-section-content">${historyLesson.lesson.deeperDive}</div>
          </div>
        ` : ''}

        <div class="lesson-section">
          <div class="lesson-section-title">✨ Fun Fact</div>
          <div class="lesson-section-content">${historyLesson.lesson.funFact}</div>
        </div>
      `;

      modalContent.appendChild(tempDiv);
      modal.appendChild(modalContent);
      document.body.appendChild(modal);

      // Close modal when clicking outside
      modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
      };
    } else {
      // Fallback: show a message that the lesson data wasn't stored
      alert('This lesson was learned before the update. Clear your history and learn new lessons to see them.');
    }
  }
}

function clearLessonHistory() {
  if (confirm('Are you sure? This will clear all your learning history.')) {
    localStorage.setItem(LESSONS_KEY, JSON.stringify([]));
    localStorage.setItem(LEARNED_LESSONS_KEY, JSON.stringify([]));
    displayLearningHistory();
  }
}

// Take a deep dive
async function takeDeepDive(topic, lessonTitle) {
  // Create modal
  const modal = document.createElement('div');
  modal.id = 'deepDiveModal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  `;

  modal.innerHTML = `
    <div style="background: white; border-radius: 12px; padding: 30px; max-width: 800px; max-height: 80vh; overflow-y: auto; position: relative;">
      <button onclick="document.getElementById('deepDiveModal').remove()" style="position: absolute; top: 10px; right: 10px; border: none; background: none; font-size: 24px; cursor: pointer;">×</button>
      <h2>🔬 Deep Dive: ${topic}</h2>
      <div id="deepDiveContent" style="color: #666; line-height: 1.8; margin-top: 20px;">
        <p style="text-align: center; color: #999;">Loading deep dive information...</p>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  try {
    const response = await fetch(`${API_URL}/deepdive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, lessonTitle })
    });

    const data = await response.json();

    if (data.success) {
      document.getElementById('deepDiveContent').innerHTML = `
        <div style="white-space: pre-wrap; color: #333; font-size: 1em;">
          ${data.deepDive.content}
        </div>
      `;
    } else {
      document.getElementById('deepDiveContent').innerHTML = '<p>Failed to load deep dive information.</p>';
    }
  } catch (error) {
    console.error('Error:', error);
    document.getElementById('deepDiveContent').innerHTML = '<p>Error loading deep dive.</p>';
  }
}

function loadProfileName() {
  const saved = localStorage.getItem('tms-profile-name');
  const el = document.getElementById('profileName');
  if (el && saved) el.textContent = saved;
}

function editProfileName() {
  const el = document.getElementById('profileName');
  if (!el) return;
  const current = el.textContent;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = current;
  input.maxLength = 24;
  input.className = 'profile-name-input';

  const save = () => {
    const val = input.value.trim() || current;
    localStorage.setItem('tms-profile-name', val);
    el.textContent = val;
    el.style.display = '';
    input.remove();
  };

  input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { el.style.display = ''; input.remove(); } });
  input.addEventListener('blur', save);

  el.style.display = 'none';
  el.parentNode.insertBefore(input, el.nextSibling);
  input.focus();
  input.select();
}

function displayAchievements() {
  const CHECK   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
  const BOOK    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;
  const MEDAL   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="6"/><path d="M8.56 13.9L6 22l6-3 6 3-2.56-8.1"/></svg>`;
  const STAR    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
  const BOLT    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
  const CAP     = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`;
  const CLOCK   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  const FIRE    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2c0 0-5 4-5 9a5 5 0 0 0 10 0c0-5-5-9-5-9z"/><path d="M12 12c0 0-2 1.5-2 3a2 2 0 0 0 4 0c0-1.5-2-3-2-3z"/></svg>`;
  const GLOBE   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
  const STACK   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`;
  const ROCKET  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/></svg>`;

  const lessons = () => JSON.parse(localStorage.getItem(LESSONS_KEY) || '[]').length;
  const streak  = () => JSON.parse(localStorage.getItem(STREAK_KEY) || '{"count":0}').count;
  const cats    = () => JSON.parse(localStorage.getItem(TOPICS_KEY) || '[]').length;
  const mins    = () => getTotalReadMinutes();

  const achievements = [
    { icon: CHECK,  name: 'First Topic',      id: 'first',       condition: () => lessons() >= 1 },
    { icon: BOOK,   name: '5 Topics',         id: 'five',        condition: () => lessons() >= 5 },
    { icon: MEDAL,  name: '10 Topics',        id: 'ten',         condition: () => lessons() >= 10 },
    { icon: STAR,   name: '25 Topics',        id: 'twentyfive',  condition: () => lessons() >= 25 },
    { icon: STACK,  name: '50 Topics',        id: 'fifty',       condition: () => lessons() >= 50 },
    { icon: BOLT,   name: '3-Day Streak',     id: 'streak3',     condition: () => streak() >= 3 },
    { icon: FIRE,   name: '7-Day Streak',     id: 'streak7',     condition: () => streak() >= 7 },
    { icon: ROCKET, name: '30-Day Streak',    id: 'streak30',    condition: () => streak() >= 30 },
    { icon: GLOBE,  name: 'Explorer',         id: 'explorer5',   condition: () => cats() >= 5 },
    { icon: CAP,    name: 'Polymath',         id: 'polymath',    condition: () => cats() >= 10 },
    { icon: CLOCK,  name: '30 Mins Read',     id: 'mins30',      condition: () => mins() >= 30 },
    { icon: CLOCK,  name: '2 Hours Read',     id: 'mins120',     condition: () => mins() >= 120 },
  ];

  const achievementsDiv = document.getElementById('achievements');
  if (!achievementsDiv) return;

  const unlockedAchievements = JSON.parse(localStorage.getItem('tms-unlocked-achievements') || '[]');

  achievementsDiv.innerHTML = achievements.map(achievement => {
    const isUnlocked = achievement.condition();
    const wasUnlocked = unlockedAchievements.includes(achievement.id);

    if (isUnlocked && !wasUnlocked) {
      celebrateAchievement(achievement.name);
      unlockedAchievements.push(achievement.id);
      localStorage.setItem('tms-unlocked-achievements', JSON.stringify(unlockedAchievements));
    }

    return `<div class="achievement ${isUnlocked ? 'unlocked' : ''}">
      <div class="achievement-icon">${achievement.icon}</div>
      <div class="achievement-name">${achievement.name}</div>
    </div>`;
  }).join('');
}
