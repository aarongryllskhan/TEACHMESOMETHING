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

// ── Image URL optimiser ───────────────────────────────────────────────────────
// Converts full-res Wikimedia URLs to a sized thumbnail so images load fast.
// Wikimedia thumb URL pattern:
//   .../commons/thumb/A/AB/File.jpg/{width}px-File.jpg
// For already-thumb URLs we just swap the width prefix.
function optimiseImageUrl(url, width = 800) {
  if (!url) return url;
  // Strip UTM / tracking params
  try { url = url.split('?')[0]; } catch {}
  if (!url.includes('upload.wikimedia.org')) return url; // Unsplash etc — leave alone

  // Already a thumb URL — replace whatever size is there
  const thumbMatch = url.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+\/thumb\/[^/]+\/[^/]+\/)([^/]+)\/(\d+)px-(.+)$/);
  if (thumbMatch) {
    return `${thumbMatch[1]}${thumbMatch[2]}/${width}px-${thumbMatch[4]}`;
  }

  // Full-res URL — inject /thumb/ and append size suffix
  const origMatch = url.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+\/)([^/]+\/[^/]+\/)(.+)$/);
  if (origMatch) {
    const filename = origMatch[3].split('/').pop();
    return `${origMatch[1]}thumb/${origMatch[2]}${origMatch[3]}/${width}px-${filename}`;
  }

  return url; // fallback — return as-is
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

  // Otherwise, clean markdown characters
  return title
    .replace(/\*\*/g, '')      // Remove **bold** markers
    .replace(/\*/g, '')         // Remove *italic* markers
    .replace(/__/g, '')         // Remove __bold__ markers
    .replace(/_/g, '')          // Remove _italic_ markers
    .trim();
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
  loadLessonCards();
  updateStreakDisplay();
  displayLearningHistory();
  displayAchievements();
  getDailyLessonAuto();
  loadProfileName();
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
  if (tabName === 'explorer') loadLessonCards();
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
  document.getElementById('dailyDescription').textContent = lesson.lesson.learn.substring(0, 150) + '...';

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
  'Science': 'Science.png',
  'Biology': 'Biology.png',
  'Medicine & Health': 'Medicine&Health.png',
  'Animals & Nature': 'Animals&Nature.png',
  'Marine & Ocean': 'Marine&Ocean.png',
  'Space & Cosmos': 'Space&Cosmos.png',
  'Earth & Environment': 'Earth&Environment.png',
  'Technology & Innovation': 'Technology&Innovation.png',
  'History & Exploration': 'History&Exploration.png',
  'Culture & Arts': 'Culture&Arts.png',
  'Philosophy & Consciousness': 'Philosophy&Consciousness.png',
  'Mysteries & Unexplained': 'Mysteries&Unexplained.png',
  'Society & Economics': 'Society&Economics.png',
  'Sports & Records': 'Sports&Records.png'
};

const CATEGORY_META = {
  colors: ['#e8f5e9','#e3f2fd','#f3e5f5','#fff3e0','#fce4ec','#e0f7fa','#f9fbe7','#ede7f6'],
  icons:  ['🌿','📘','🔬','⚗️','🏛️','🌍','💡','🧠','🎨','🚀','🦋','⚡','🌊','🧬','📐','🎭'],
};

function categoryMeta(name, idx) {
  const color = CATEGORY_META.colors[idx % CATEGORY_META.colors.length];
  const icon  = CATEGORY_META.icons[idx % CATEGORY_META.icons.length];
  return { color, icon };
}

function getCategoryImage(categoryName) {
  return categoryImages[categoryName] || null;
}

let allCategories = [];

async function loadLessonCards() {
  const container = document.getElementById('explorer');
  const header = container.querySelector('.explore-header h2');
  if (header) header.textContent = 'Explore';

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

function renderCategoryList(categories) {
  const grid = document.getElementById('topicsGrid');

  if (!categories || !categories.length) {
    grid.innerHTML = '<p style="text-align:center;color:#bbb;padding:40px 0;">No categories found.</p>';
    return;
  }

  const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name));

  grid.innerHTML = '<div class="explore-grid">' + sorted.map((cat, idx) => {
    const name = cat.name;
    const imageFile = getCategoryImage(name);

    const iconHtml = imageFile
      ? `<img src="images/${imageFile}" alt="${name}" style="width:100%;height:100%;object-fit:contain;padding:6px;">`
      : `<div style="background:${categoryMeta(name, idx).color};width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.8em;border-radius:14px;">${categoryMeta(name, idx).icon}</div>`;

    return `
      <div class="explore-category-card" onclick="loadCategoryLessonsView('${cat.id}', '${name}')">
        <div class="explore-category-icon">${iconHtml}</div>
        <div class="explore-category-card-text">
          <div class="explore-category-card-title">${name}</div>
          <div class="explore-category-card-count">${cat.count} topics</div>
        </div>
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

async function filterTopics(query) {
  const grid = document.getElementById('topicsGrid');

  if (!query) {
    searchResults = [];
    renderCategoryList(allCategories);
    return;
  }

  const q = query.toLowerCase();

  // Show loading state
  grid.innerHTML = '<div style="text-align:center;color:#bbb;padding:40px 0;">Searching...</div>';

  try {
    // Load all lessons from all categories
    const allLessons = [];
    for (const category of allCategories) {
      const lessons = await loadCategoryLessons(category.name || category.id);
      if (lessons && lessons.length > 0) {
        lessons.forEach(lesson => {
          allLessons.push({
            ...lesson,
            categoryName: category.name,
            categoryId: category.name || category.id
          });
        });
      }
    }

    // Filter lessons by search query
    searchResults = allLessons.filter(lesson => {
      const title = (lesson.title || '').toLowerCase();
      const topic = (lesson.topic || '').toLowerCase();
      const description = (lesson.lesson?.learn || '').toLowerCase();
      return title.includes(q) || topic.includes(q) || description.includes(q);
    });

    if (searchResults.length === 0) {
      grid.innerHTML = '<p style="text-align:center;color:#bbb;padding:40px 0;">No topics found matching "' + query + '"</p>';
      return;
    }

    // Display search results
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
const subcategoryMeta = {
  'GENETICS_HEREDITY': { icon: '🧬', color: '#e8f5e9' },
  'EVOLUTIONARY_MARVELS_ORIGINS': { icon: '🦎', color: '#c8e6c9' },
  'HUMAN_EVOLUTION_ORIGINS_FINISHEDEDIT': { icon: '👤', color: '#a5d6a7' },
  'CELLULAR_BIOLOGY': { icon: '🔬', color: '#81c784' },
  'BOTANY_PLANT_SCIENCE': { icon: '🌿', color: '#66bb6a' },
  'EXTREME_PHYSICS': { icon: '⚡', color: '#fff9c4' },
  'NANOTECHNOLOGY_THE_INCREDIBLY_TINY': { icon: '🔭', color: '#ffeb3b' },
  'CHEMISTRY_THE_ELEMENTS': { icon: '⚗️', color: '#fdd835' },
  'BIOCHEMICAL_WONDERS_MOLECULAR_MACHINES': { icon: '🧪', color: '#fbc02d' },
  'MATHEMATICS_BEYOND_NUMBERS': { icon: '📐', color: '#fab005' },
  'MEDICINE_DISEASE_BREAKTHROUGHS': { icon: '💊', color: '#ffccbc' },
  'MEDICAL_MIRACLES_BIOLOGICAL_PUZZLES': { icon: '⚕️', color: '#ffab91' },
  'NEUROSCIENCE_BRAIN_FUNCTION': { icon: '🧠', color: '#ff8a65' },
  'PSYCHOLOGY_HUMAN_BEHAVIOR': { icon: '🎯', color: '#ff7043' },
  'IMMUNOLOGY_DEFENSE_SYSTEMS_FINISHEDEDIT': { icon: '🛡️', color: '#ff5722' },
  'INCREDIBLE_HUMAN_BIOLOGY_FINISHEDEDIT': { icon: '💪', color: '#e64a19' },
  'WEIRD_ANIMAL_ABILITIES_MYSTERIES': { icon: '🦑', color: '#f3e5f5' },
  'SENSORY_SUPERPOWERS_HIDDEN_PERCEPTION': { icon: '👁️', color: '#e1bee7' },
  'PALEONTOLOGY_PREHISTORIC_LIFE': { icon: '🦴', color: '#ce93d8' },
  'ECOLOGY_ECOSYSTEMS': { icon: '🌱', color: '#ba68c8' },
  'EXTREME_ADAPTATIONS_SURVIVAL_STRATEGIES_FINISHEDEDIT': { icon: '🦁', color: '#ab47bc' },
  'IMPOSSIBLE_FEATS_OF_NATURE_FINISHEDEDIT': { icon: '🌈', color: '#9c27b0' },
  'INCREDIBLE_NATURAL_PHENOMENA_FINISHEDEDIT': { icon: '⛈️', color: '#8e24aa' },
  'OCEAN_EXPLORATION_MARINE_MYSTERIES': { icon: '🌊', color: '#b3e5fc' },
  'OCEAN_MYSTERIES_DEEP_SEA_WONDERS': { icon: '🐙', color: '#81d4fa' },
  'ASTRONOMY_CELESTIAL_OBJECTS': { icon: '🌟', color: '#e0f2f1' },
  'ASTRONOMY_PHENOMENA': { icon: '🌌', color: '#b2dfdb' },
  'SPACE_COSMIC_MYSTERIES': { icon: '🚀', color: '#80cbc4' },
  'COSMIC_CATASTROPHES_FUTURE_THREATS': { icon: '☄️', color: '#4db6ac' },
  'ENVIRONMENTAL_SCIENCE_CLIMATE': { icon: '🌍', color: '#c8e6c9' },
  'WORLD_GEOGRAPHY_HIDDEN_WONDERS': { icon: '🗺️', color: '#a5d6a7' },
  'GEOLOGY_EARTH_SCIENCE_FINISHEDEDIT': { icon: '🪨', color: '#81c784' },
  'CATASTROPHES': { icon: '🌋', color: '#66bb6a' },
  'DANGEROUS_EXTREME_PHENOMENA': { icon: '⚠️', color: '#558b2f' },
  'ARTIFICIAL_INTELLIGENCE_MACHINE_LEARNING': { icon: '🤖', color: '#f3e5f5' },
  'COMPUTER_SCIENCE_BREAKTHROUGHS': { icon: '💻', color: '#e1bee7' },
  'CRYPTOGRAPHY_SECURITY': { icon: '🔐', color: '#ce93d8' },
  'ROBOTICS_AUTOMATION': { icon: '⚙️', color: '#ba68c8' },
  'ENGINEERING_IMPOSSIBILITIES_THAT_ACTUALLY_EXIST': { icon: '🏗️', color: '#ab47bc' },
  'TECHNOLOGICAL_BREAKTHROUGHS_INVENTIONS': { icon: '💡', color: '#9c27b0' },
  'TECHNOLOGY_THAT_CHANGED_EVERYTHING': { icon: '📱', color: '#8e24aa' },
  'TRANSPORTATION_EVOLUTION': { icon: '🚗', color: '#7b1fa2' },
  'BIOTECHNOLOGY_GENETIC_ENGINEERING': { icon: '🧬', color: '#6a1b9a' },
  'MICROBIOLOGY_TINY_ORGANISMS': { icon: '🦠', color: '#4a148c' },
  'ANCIENT_MYSTERIES_LOST_CIVILIZATIONS': { icon: '🏛️', color: '#ffe0b2' },
  'ARCHAEOLOGICAL_DISCOVERIES_MYSTERIES_FINISHEDEDIT': { icon: '🏺', color: '#ffcc80' },
  'FAMOUS_HISTORICAL_FIGURES_THEIR_SECRETS': { icon: '👑', color: '#ffb74d' },
  'MILITARY_HISTORY_WARFARE': { icon: '⚔️', color: '#ffa726' },
  'EXPLORATION_DISCOVERY': { icon: '🧭', color: '#ff9800' },
  'LOST_TECHNOLOGIES_ANCIENT_KNOWLEDGE': { icon: '🔮', color: '#f57c00' },
  'SOCIAL_MOVEMENTS_HISTORY': { icon: '✊', color: '#e65100' },
  'RELIGIOUS_HISTORY_BELIEF_SYSTEMS': { icon: '🕉️', color: '#bf360c' },
  'ART_MOVEMENTS_ARTISTIC_REVOLUTIONS': { icon: '🎨', color: '#fce4ec' },
  'ART_MOVEMENTS_ARTISTIC_REVOLUTIONS_PARTIAL': { icon: '🖼️', color: '#f8bbd0' },
  'MUSIC_MUSICIANS_THROUGH_HISTORY': { icon: '🎵', color: '#f48fb1' },
  'LITERATURE_WORLD_AUTHORS': { icon: '📚', color: '#f06292' },
  'LANGUAGES_LINGUISTICS': { icon: '🗣️', color: '#ec407a' },
  'ARCHITECTURE_BUILT_WONDERS': { icon: '🏰', color: '#e91e63' },
  'PHILOSOPHY_BIG_QUESTIONS': { icon: '🤔', color: '#e1f5fe' },
  'MYSTERIES_OF_CONSCIOUSNESS_THE_MIND': { icon: '💭', color: '#b3e5fc' },
  'UNSOLVED_MYSTERIES_UNEXPLAINED_PHENOMENA': { icon: '👻', color: '#fff9c4' },
  'ECONOMICS_ECONOMIC_SYSTEMS_FINISHEDEDIT': { icon: '💰', color: '#fff59d' },
  'LEGAL_SYSTEM_JUSTICE_ODDITIES': { icon: '⚖️', color: '#fff176' },
  'SPORTS_RECORDS_ATHLETIC_EXTREMES': { icon: '🏆', color: '#ffee58' },
  'WORLD_RECORDS_EXTREME_ACHIEVEMENTS': { icon: '🥇', color: '#ffeb3b' }
};

async function loadCategoryLessonsView(categoryId, categoryName) {
  const container = document.getElementById('explorer');
  const grid = document.getElementById('topicsGrid');

  // Update explore header
  const header = container.querySelector('.explore-header h2');
  if (header) header.textContent = categoryName;

  grid.innerHTML = '<div style="text-align:center;color:#bbb;padding:40px 0;">Loading...</div>';

  try {
    // Get the category data from cache
    const data = await loadCategories();
    const categories = data.categories || [];
    const parentCategory = categories.find(c => c.id === categoryId);

    if (!parentCategory) {
      grid.innerHTML = '<p style="color:#f00;text-align:center;">Category not found</p>';
      return;
    }

    const backBtn = `<button class="explore-back-btn" onclick="loadLessonCards()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      Back
    </button>`;

    // Display subcategories with engaging icons and colors
    const subcategoryCards = parentCategory.subCategories.map((subFolder, idx) => {
      const meta = subcategoryMeta[subFolder] || { icon: '📖', color: '#e0e0e0' };
      const displayName = subFolder
        .replace(/_FINISHEDEDITED_FINISHEDEDIT$/, '')
        .replace(/_FINISHEDEDITED$/, '')
        .replace(/_FINISHEDEDIT$/, '')
        .replace(/_PARTIAL$/, '')
        .replace(/_/g, ' ');
      return `
        <div class="explore-category-card" onclick="loadSubcategoryLessons('${categoryId}', '${subFolder}', '${displayName}', '${categoryName}')" style="cursor:pointer;transition:transform 0.2s;border:2px solid #f0f0f0;">
          <div class="explore-category-icon" style="background:${meta.color};font-size:2.5em;border-radius:12px;padding:20px;margin-bottom:10px;">${meta.icon}</div>
          <div class="explore-category-card-title" style="font-size:0.95em;font-weight:600;">${displayName}</div>
        </div>`;
    }).join('');

    grid.innerHTML = backBtn + '<div class="explore-grid subcategory-grid">' + subcategoryCards + '</div>';
  } catch (error) {
    console.error('Error:', error);
    grid.innerHTML = '<p style="color:#f00;text-align:center;">Failed to load subcategories</p>';
  }
}

async function loadSubcategoryLessons(categoryId, subcategoryFolder, subcategoryName, parentCategoryName) {
  const container = document.getElementById('explorer');
  const grid = document.getElementById('topicsGrid');

  const header = container.querySelector('.explore-header h2');
  if (header) header.textContent = subcategoryName;

  grid.innerHTML = '<div style="text-align:center;color:#bbb;padding:40px 0;">Loading...</div>';

  try {
    const lessons = await loadCategoryLessons(categoryId);

    // Filter lessons to only those from this subcategory
    const subcategoryLessons = lessons.filter(l => l.subcategory === subcategoryFolder);

    const backBtn = `<button class="explore-back-btn" onclick="loadCategoryLessonsView('${categoryId}', '${parentCategoryName}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      Back
    </button>`;

    const ACCENT_COLORS = [
      '#667eea','#f59e0b','#10b981','#ef4444','#8b5cf6',
      '#06b6d4','#f97316','#ec4899','#14b8a6','#6366f1'
    ];

    const TICK_SVG = `<svg class="lesson-read-tick" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#ecfdf5"/><polyline points="7 12 10.5 15.5 17 9" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    const rows = subcategoryLessons.map((lesson, idx) => {
      const color = ACCENT_COLORS[idx % ACCENT_COLORS.length];
      const rawText = typeof lesson.lesson === 'string' ? lesson.lesson : (lesson.lesson?.learn || lesson.lesson?.overview || '');
      const lessonText = typeof rawText === 'string' ? rawText : '';
      const preview = lessonText.substring(0, 100);
      const thumbUrl = optimiseImageUrl(lesson.image || (lesson.lesson && lesson.lesson.image), 200);
      const read = isLessonRead(lesson);

      const rightSlot = thumbUrl
        ? `<div class="lesson-card-thumb">
             <img src="${thumbUrl}" alt="" loading="lazy">
             ${read ? `<div class="lesson-card-tick">${TICK_SVG}</div>` : ''}
           </div>`
        : (read
            ? TICK_SVG
            : `<svg class="lesson-chevron" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" style="width:18px;height:18px;"><polyline points="9 18 15 12 9 6"/></svg>`
          );

      return `
      <div class="explore-category-row" data-lesson-idx="${lessons.indexOf(lesson)}" data-accent="${color}" onclick="selectLessonFromCard('${categoryId}', ${lessons.indexOf(lesson)})">
        <div class="lesson-accent-bar" style="background:${color};"></div>
        <div class="explore-category-info">
          <div class="explore-category-name">${cleanTitle(lesson.title, lesson.topic)}</div>
          <div class="explore-category-desc">${preview}${preview.length >= 100 ? '…' : ''}</div>
        </div>
        ${rightSlot}
      </div>`;
    }).join('');

    grid.innerHTML = backBtn + (rows || '<p style="text-align:center;color:#bbb;padding:40px 0;">No lessons found.</p>');

    // Silently preload all images for this subcategory in the background
    subcategoryLessons.forEach(l => {
      const u = optimiseImageUrl(l.image || (l.lesson && l.lesson.image));
      if (u) { const i = new Image(); i.src = u; }
    });
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

// Display lesson full view
function displayFullLesson(lesson) {
  startReadTimer();
  // Kick off image fetch immediately so it's in the browser cache by render time
  const _preloadUrl = optimiseImageUrl(lesson.image || (lesson.lesson && lesson.lesson.image));
  if (_preloadUrl) { const _img = new Image(); _img.src = _preloadUrl; }
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

  const imageUrl = optimiseImageUrl(lesson.image || (lesson.lesson && lesson.lesson.image));
  modal.innerHTML = `
    <div class="full-lesson-header">
      <button class="close-btn" onclick="closeFullLesson()">←Back</button>
      <div class="lesson-progress">${currentCardIndex + 1} / ${currentLessonsArray.length}</div>
    </div>

    <div class="full-lesson-content">
      ${imageUrl ? `<div class="lesson-hero-image"><img src="${imageUrl}" alt="${cleanTitle(lesson.title, lesson.topic)}" loading="lazy"></div>` : ''}
      <h2>${cleanTitle(lesson.title, lesson.topic)}</h2>
      ${!shouldHideTopicTag(lesson.title) ? `<span class="topic-tag">${lesson.topic}</span>` : ''}

      <div class="lesson-section fun-fact-section">
        <div class="lesson-section-title">✨ Did You Know?</div>
        <div class="lesson-section-content">${content.funFact || ''}</div>
      </div>

      ${content.simpler ? `
        <div class="lesson-section">
          <div class="lesson-section-content">${content.simpler}</div>
        </div>
      ` : ''}

      <div class="lesson-section">
        <div class="lesson-section-content">${content.learn || content.explanation || ''}</div>
      </div>

      ${content.deeperDive ? `
        <div class="lesson-section">
          <div class="lesson-section-content">${content.deeperDive}</div>
        </div>
      ` : ''}

      <div class="lesson-section">
        <div class="lesson-section-content"><strong>${content.keyTakeaway || ''}</strong></div>
      </div>

      ${keyElementsHtml}
      ${referencesHtml}
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
  const modal = document.getElementById('fullLessonModal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';

  // Update the row icon in-place so the tick shows immediately without a re-render
  const lesson = currentLessonsArray[currentCardIndex];
  if (lesson && isLessonRead(lesson)) {
    const row = document.querySelector(`.explore-category-row[data-lesson-idx="${currentCardIndex}"]`);
    if (row) {
      const TICK = `<svg class="lesson-read-tick" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#ecfdf5"/><polyline points="7 12 10.5 15.5 17 9" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      const thumb = row.querySelector('.lesson-card-thumb');
      if (thumb) {
        // Thumbnail card — add tick badge overlay if not already there
        if (!thumb.querySelector('.lesson-card-tick')) {
          const badge = document.createElement('div');
          badge.className = 'lesson-card-tick';
          badge.innerHTML = TICK;
          thumb.appendChild(badge);
        }
      } else {
        // No-image card — swap chevron for tick
        const svg = row.querySelector('svg');
        if (svg && !svg.classList.contains('lesson-read-tick')) {
          svg.outerHTML = TICK;
        }
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
