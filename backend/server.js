const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const path = require('path');
const fs = require('fs');

app.use(cors());
app.use(express.json());

const frontendPath = path.join(__dirname, '..', 'frontend');
const lessonsDir = path.join(__dirname, 'lessons');

app.use(express.static(frontendPath));

// Category mapping: organize lesson folders into 14 parent categories
const categoryMapping = {
  'Science': [
    'EXTREME_PHYSICS',
    'NANOTECHNOLOGY_THE_INCREDIBLY_TINY',
    'CHEMISTRY_THE_ELEMENTS',
    'BIOCHEMICAL_WONDERS_MOLECULAR_MACHINES',
    'MATHEMATICS_BEYOND_NUMBERS_FINISHEDEDIT'
  ],
  'Biology': [
    'GENETICS_HEREDITY',
    'EVOLUTIONARY_MARVELS_ORIGINS',
    'HUMAN_EVOLUTION_ORIGINS_FINISHEDEDIT',
    'CELLULAR_BIOLOGY',
    'BOTANY_PLANT_SCIENCE'
  ],
  'Medicine & Health': [
    'MEDICINE_DISEASE_BREAKTHROUGHS_FINISHEDEDIT',
    'MEDICAL_MIRACLES_BIOLOGICAL_PUZZLES_FINISHEDEDIT',
    'NEUROSCIENCE_BRAIN_FUNCTION_FINISHEDEDIT',
    'PSYCHOLOGY_HUMAN_BEHAVIOR_FINISHEDEDIT',
    'IMMUNOLOGY_DEFENSE_SYSTEMS_FINISHEDEDIT',
    'INCREDIBLE_HUMAN_BIOLOGY_FINISHEDEDIT',
    'BEHAVIORAL_SCIENCE_FINISHEDEDIT'
  ],
  'Animals & Nature': [
    'WEIRD_ANIMAL_ABILITIES_MYSTERIES',
    'SENSORY_SUPERPOWERS_HIDDEN_PERCEPTION_FINISHEDEDITED',
    'PALEONTOLOGY_PREHISTORIC_LIFE_FINISHEDEDIT',
    'ECOLOGY_ECOSYSTEMS',
    'EXTREME_ADAPTATIONS_SURVIVAL_STRATEGIES_FINISHEDEDIT',
    'IMPOSSIBLE_FEATS_OF_NATURE_FINISHEDEDIT',
    'INCREDIBLE_NATURAL_PHENOMENA_FINISHEDEDIT'
  ],
  'Marine & Ocean': [
    'OCEAN_EXPLORATION_MARINE_MYSTERIES_FINISHEDEDITED_FINISHEDEDIT',
    'OCEAN_MYSTERIES_DEEP_SEA_WONDERS_FINISHEDEDIT'
  ],
  'Space & Cosmos': [
    'ASTRONOMY_CELESTIAL_OBJECTS',
    'ASTRONOMY_PHENOMENA',
    'SPACE_COSMIC_MYSTERIES_FINISHEDEDIT',
    'COSMIC_CATASTROPHES_FUTURE_THREATS_FINISHEDEDIT'
  ],
  'Earth & Environment': [
    'ENVIRONMENTAL_SCIENCE_CLIMATE',
    'WORLD_GEOGRAPHY_HIDDEN_WONDERS',
    'GEOLOGY_EARTH_SCIENCE_FINISHEDEDIT',
    'CATASTROPHES',
    'DANGEROUS_EXTREME_PHENOMENA'
  ],
  'Technology & Innovation': [
    'ARTIFICIAL_INTELLIGENCE_MACHINE_LEARNING',
    'COMPUTER_SCIENCE_BREAKTHROUGHS',
    'CRYPTOGRAPHY_SECURITY',
    'ROBOTICS_AUTOMATION_FINISHEDEDIT',
    'ENGINEERING_IMPOSSIBILITIES_THAT_ACTUALLY_EXIST',
    'TECHNOLOGICAL_BREAKTHROUGHS_INVENTIONS',
    'TECHNOLOGY_THAT_CHANGED_EVERYTHING',
    'TRANSPORTATION_EVOLUTION',
    'BIOTECHNOLOGY_GENETIC_ENGINEERING',
    'MICROBIOLOGY_TINY_ORGANISMS_FINISHEDEDIT'
  ],
  'History & Exploration': [
    'ANCIENT_MYSTERIES_LOST_CIVILIZATIONS',
    'ARCHAEOLOGICAL_DISCOVERIES_MYSTERIES_FINISHEDEDIT',
    'FAMOUS_HISTORICAL_FIGURES_THEIR_SECRETS_FINISHEDEDIT',
    'MILITARY_HISTORY_WARFARE_FINISHEDEDIT',
    'EXPLORATION_DISCOVERY',
    'LOST_TECHNOLOGIES_ANCIENT_KNOWLEDGE_FINISHEDEDIT',
    'SOCIAL_MOVEMENTS_HISTORY_FINISHEDEDIT',
    'RELIGIOUS_HISTORY_BELIEF_SYSTEMS_FINISHEDEDIT'
  ],
  'Culture & Arts': [
    'ART_MOVEMENTS_ARTISTIC_REVOLUTIONS_PARTIAL',
    'MUSIC_MUSICIANS_THROUGH_HISTORY_FINISHEDEDIT',
    'LITERATURE_WORLD_AUTHORS_FINISHEDEDIT',
    'LANGUAGES_LINGUISTICS_FINISHEDEDIT',
    'ARCHITECTURE_BUILT_WONDERS'
  ],
  'Philosophy & Consciousness': [
    'PHILOSOPHY_BIG_QUESTIONS_FINISHEDEDIT',
    'MYSTERIES_OF_CONSCIOUSNESS_THE_MIND_FINISHEDEDIT'
  ],
  'Mysteries & Unexplained': [
    'UNSOLVED_MYSTERIES_UNEXPLAINED_PHENOMENA'
  ],
  'Society & Economics': [
    'ECONOMICS_ECONOMIC_SYSTEMS_FINISHEDEDIT',
    'LEGAL_SYSTEM_JUSTICE_ODDITIES_FINISHEDEDIT'
  ],
  'Sports & Records': [
    'SPORTS_RECORDS_ATHLETIC_EXTREMES_FINISHEDEDIT',
    'WORLD_RECORDS_EXTREME_ACHIEVEMENTS'
  ]
};

// Find actual folder on disk regardless of _FINISHEDEDIT / _PARTIAL suffix mismatches
const allLessonFolders = fs.existsSync(lessonsDir) ? fs.readdirSync(lessonsDir) : [];
function resolveFolder(baseName) {
  // 1. Exact match
  if (allLessonFolders.includes(baseName)) return path.join(lessonsDir, baseName);
  // 2. Mapping name is a prefix of the folder (FOO → FOO_FINISHEDEDIT)
  const match = allLessonFolders.find(f => f.startsWith(baseName + '_') || f.startsWith(baseName + '-'));
  if (match) return path.join(lessonsDir, match);
  // 3. Folder name is a prefix of the mapping name (FOO_FINISHEDEDIT → FOO)
  const reverse = allLessonFolders.find(f => baseName.startsWith(f + '_') || baseName.startsWith(f + '-'));
  return reverse ? path.join(lessonsDir, reverse) : null;
}

// Gemini configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL   = 'gemini-1.5-flash';
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

async function callGemini(prompt) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Ollama configuration (kept as fallback for local dev)
const OLLAMA_API_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'mistral';

// Load custom curated lessons
let customLessons = {};
try {
  const customPath = './customLessons.json';
  if (fs.existsSync(customPath)) {
    customLessons = JSON.parse(fs.readFileSync(customPath, 'utf8'));
    console.log(`✅ Loaded ${Object.keys(customLessons).length} custom topics`);
  }
} catch (error) {
  console.warn('⚠️  No custom lessons found');
}

// Load generated lesson pool (fallback)
let lessonPool = {};
try {
  const poolPath = './lessonPool.json';
  if (fs.existsSync(poolPath)) {
    lessonPool = JSON.parse(fs.readFileSync(poolPath, 'utf8'));
    console.log(`✅ Loaded lesson pool with ${Object.keys(lessonPool).length} topics`);
  }
} catch (error) {
  console.warn('⚠️  No lesson pool found.');
}

// Simple in-memory rate limiter
const rateLimitStore = {};
const HOURLY_LIMIT = 5;
const DAILY_LIMIT = 30;

function initializeUserRateLimit(userId) {
  if (!rateLimitStore[userId]) {
    rateLimitStore[userId] = {
      hourlyCount: 0,
      dailyCount: 0,
      hourResetTime: Date.now() + 3600000, // 1 hour from now
      dayResetTime: Date.now() + 86400000   // 24 hours from now
    };
  }
}

function checkRateLimit(userId) {
  initializeUserRateLimit(userId);
  const now = Date.now();
  const user = rateLimitStore[userId];

  // Reset hourly counter if needed
  if (now > user.hourResetTime) {
    user.hourlyCount = 0;
    user.hourResetTime = now + 3600000;
  }

  // Reset daily counter if needed
  if (now > user.dayResetTime) {
    user.dailyCount = 0;
    user.dayResetTime = now + 86400000;
  }

  return {
    hourlyRemaining: Math.max(0, HOURLY_LIMIT - user.hourlyCount),
    dailyRemaining: Math.max(0, DAILY_LIMIT - user.dailyCount),
    isLimited: user.hourlyCount >= HOURLY_LIMIT || user.dailyCount >= DAILY_LIMIT,
    nextResetHourly: user.hourResetTime,
    nextResetDaily: user.dayResetTime
  };
}

function incrementRateLimit(userId) {
  initializeUserRateLimit(userId);
  rateLimitStore[userId].hourlyCount++;
  rateLimitStore[userId].dailyCount++;
}

// Middleware to add or retrieve user ID
app.use((req, res, next) => {
  const userId = req.headers['x-user-id'] || req.cookies?.userId || `anonymous-${Date.now()}-${Math.random()}`;
  req.userId = userId;

  // Set user ID in response headers for client to store
  res.setHeader('X-User-ID', userId);
  next();
});

const topics = [
  'Science', 'History', 'Technology', 'Nature', 'Psychology',
  'Philosophy', 'Space', 'Biology', 'Art', 'Literature',
  'Economics', 'Geography', 'Medicine', 'Physics', 'Chemistry'
];

const topicSubtopics = {
  'Science': ['Particle Physics', 'Molecular Biology', 'Astrophysics', 'Quantum Computing', 'Nanotechnology', 'Genetic Engineering', 'CRISPR Technology', 'Dark Matter', 'String Theory', 'Fusion Energy'],
  'History': ['Ancient Civilizations', 'Medieval Times', 'Renaissance', 'Industrial Revolution', 'Modern Warfare', 'Ancient Rome', 'Victorian Era', 'Cold War', 'Ancient Egypt', 'Silk Road'],
  'Technology': ['Artificial Intelligence', 'Blockchain', 'Virtual Reality', 'Biotechnology', '5G Networks', 'Quantum Computing', 'Robotics', 'Cybersecurity', 'Cloud Computing', 'Machine Learning'],
  'Nature': ['Ecosystems', 'Weather Systems', 'Ocean Currents', 'Rainforests', 'Desert Ecosystems', 'Coral Reefs', 'Migration Patterns', 'Photosynthesis', 'Carbon Cycle', 'Biodiversity'],
  'Psychology': ['Cognitive Biases', 'Memory Formation', 'Dream Analysis', 'Mental Health', 'Child Development', 'Behavioral Economics', 'Social Psychology', 'Trauma Recovery', 'Mindfulness', 'Emotional Intelligence'],
  'Philosophy': ['Ethics', 'Existentialism', 'Metaphysics', 'Logic', 'Epistemology', 'Stoicism', 'Utilitarianism', 'Phenomenology', 'Skepticism', 'Free Will vs Determinism'],
  'Space': ['Black Holes', 'Exoplanets', 'Nebulas', 'Galaxies', 'Supernovas', 'Gravitational Waves', 'Space Exploration', 'Cosmic Radiation', 'Solar Flares', 'Mars Colonization'],
  'Biology': ['Evolution', 'Photosynthesis', 'Cell Division', 'DNA Replication', 'Enzymes', 'Immune System', 'Neurotransmitters', 'Hormones', 'Protein Folding', 'Microbiome'],
  'Art': ['Renaissance Painting', 'Modern Art', 'Sculpture', 'Digital Art', 'Photography', 'Abstract Expressionism', 'Street Art', 'Installation Art', 'Color Theory', 'Impressionism'],
  'Literature': ['Shakespeare', 'Poetry', 'Science Fiction', 'Dystopian Novels', 'Fantasy Worlds', 'Historical Fiction', 'Symbolism', 'Character Development', 'Narrative Structure', 'Literary Devices'],
  'Economics': ['Supply and Demand', 'Inflation', 'Stock Markets', 'Cryptocurrency', 'Trade Wars', 'GDP Growth', 'Income Inequality', 'Monetary Policy', 'Economic Cycles', 'Sustainable Economics'],
  'Geography': ['Plate Tectonics', 'Climate Zones', 'Mountains', 'Rivers', 'Human Migration', 'Urbanization', 'Natural Resources', 'Desertification', 'Ocean Zones', 'Biodiversity Hotspots'],
  'Medicine': ['Vaccines', 'Antibiotics', 'Gene Therapy', 'Surgical Techniques', 'Diagnosis Methods', 'Pharmacology', 'Neurosurgery', 'Immunotherapy', 'Regenerative Medicine', 'Personalized Medicine'],
  'Physics': ['Thermodynamics', 'Quantum Mechanics', 'Relativity', 'Electromagnetism', 'Optics', 'Acoustics', 'Mechanics', 'Fluid Dynamics', 'Wave Properties', 'Atomic Structure'],
  'Chemistry': ['Chemical Bonding', 'Periodic Table', 'Acids and Bases', 'Organic Chemistry', 'Redox Reactions', 'Polymers', 'Catalysis', 'Electrochemistry', 'Crystallography', 'Reaction Kinetics']
};

// Fetch image from Wikimedia Commons based on topic
async function fetchLessonImage(topic, title) {
  try {
    // Try to search for images related to the topic
    const searchQuery = encodeURIComponent(topic);
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${searchQuery}&srnamespace=6&srlimit=1&format=json`, {
      timeout: 5000
    });

    const data = await response.json();

    if (data.query?.search && data.query.search.length > 0) {
      const fileTitle = data.query.search[0].title;

      // Get the file info to get the URL
      const fileResponse = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(fileTitle)}&prop=imageinfo&iiprop=url&format=json`, {
        timeout: 5000
      });

      const fileData = await fileResponse.json();
      const pages = fileData.query?.pages || {};
      const pageKey = Object.keys(pages)[0];

      if (pageKey && pages[pageKey].imageinfo) {
        const imageInfo = pages[pageKey].imageinfo[0];
        return {
          url: imageInfo.url,
          credit: 'Wikimedia Commons',
          creditUrl: `https://commons.wikimedia.org/wiki/${fileTitle.replace(/ /g, '_')}`
        };
      }
    }
  } catch (error) {
    console.error('Error fetching image:', error.message);
  }

  return null;
}

// Generate a detailed lesson
app.post('/api/lesson', async (req, res) => {
  try {
    const { topic, fresh } = req.body; // fresh=true for paid users wanting AI-generated lessons
    const userId = req.userId;

    // Prefer custom lessons - only pick from available custom topics
    const customTopics = Object.keys(customLessons);
    let selectedTopic = topic;

    if (!selectedTopic && customTopics.length > 0) {
      // If no topic specified, pick from custom lessons
      selectedTopic = customTopics[Math.floor(Math.random() * customTopics.length)];
    } else if (!selectedTopic) {
      // Fallback to random topic if no custom lessons exist
      selectedTopic = topics[Math.floor(Math.random() * topics.length)];
      if (topicSubtopics[selectedTopic]) {
        selectedTopic = topicSubtopics[selectedTopic][Math.floor(Math.random() * topicSubtopics[selectedTopic].length)];
      }
    }

    // Try custom curated lessons first (highest priority)
    console.log(`Lesson request: topic=${selectedTopic}, fresh=${fresh}, hasCustom=${!!customLessons[selectedTopic]}`);
    if (!fresh && customLessons[selectedTopic]) {
      const customLessonsArray = customLessons[selectedTopic];
      console.log(`✅ Found ${customLessonsArray.length} custom lessons for ${selectedTopic}`);
      if (customLessonsArray.length > 0) {
        const randomLesson = customLessonsArray[Math.floor(Math.random() * customLessonsArray.length)];
        return res.json({
          success: true,
          lesson: { ...randomLesson, id: Date.now(), source: 'custom' },
          rateLimitInfo: {
            hourlyRemaining: HOURLY_LIMIT,
            dailyRemaining: DAILY_LIMIT,
            hourlyLimit: HOURLY_LIMIT,
            dailyLimit: DAILY_LIMIT,
            message: '📚 Loaded from curated lessons'
          }
        });
      }
    }

    // Try to serve from generated lesson pool (fallback)
    if (!fresh && Object.keys(lessonPool).length > 0 && lessonPool[selectedTopic]) {
      const pooledLessons = lessonPool[selectedTopic];
      if (pooledLessons.length > 0) {
        const randomLesson = pooledLessons[Math.floor(Math.random() * pooledLessons.length)];
        return res.json({
          success: true,
          lesson: { ...randomLesson, id: Date.now(), source: 'pool' },
          rateLimitInfo: {
            hourlyRemaining: HOURLY_LIMIT,
            dailyRemaining: DAILY_LIMIT,
            hourlyLimit: HOURLY_LIMIT,
            dailyLimit: DAILY_LIMIT,
            message: '🎓 Loaded from lesson library'
          }
        });
      }
    }

    // Check rate limits for AI-generated lessons (paid users)
    const rateLimitStatus = checkRateLimit(userId);

    if (rateLimitStatus.isLimited) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: `You've reached your limit. Daily remaining: ${rateLimitStatus.dailyRemaining}/${DAILY_LIMIT}. Hourly remaining: ${rateLimitStatus.hourlyRemaining}/${HOURLY_LIMIT}`,
        nextResetHourly: rateLimitStatus.nextResetHourly,
        nextResetDaily: rateLimitStatus.nextResetDaily,
        dailyRemaining: rateLimitStatus.dailyRemaining,
        hourlyRemaining: rateLimitStatus.hourlyRemaining
      });
    }

    const prompt = `Generate detailed educational content about ${selectedTopic}. Return ONLY valid JSON, NO other text.

{
  "title": "An interesting title about ${selectedTopic}",
  "topic": "${selectedTopic}",
  "explanation": "7-10 sentences covering: 1) What it is, 2) Historical context, 3) Why it matters, 4) Real-world applications",
  "simpler": "2-3 simple sentences for a 10-year-old using everyday examples they understand",
  "keyTakeaway": "The most important single insight someone should remember about ${selectedTopic}",
  "deeperDive": "8-10 advanced sentences for curious minds covering recent discoveries and complex mechanisms",
  "funFact": "One surprising or interesting fact that makes people say 'wow'",
  "keyElements": {
    "people": ["Name of a famous scientist or expert in ${selectedTopic}", "Name of another key figure", "Name of a third important person"],
    "places": ["Name of a real university or institution known for ${selectedTopic}", "Name of another relevant place", "Name of a third location"],
    "years": ["A significant year or era in ${selectedTopic} history with what happened", "Another important year or period", "A recent development or discovery"],
    "concepts": ["A fundamental principle of ${selectedTopic}", "A major theory or framework", "A key breakthrough or innovation"]
  },
  "relatedTopics": ["One related topic", "Another related topic", "A third related topic"],
  "references": [{"title": "Wikipedia: ${selectedTopic}", "url": "https://en.wikipedia.org/wiki/${selectedTopic.replace(/\\s+/g,'_')}", "author": "Wikipedia"}]
}

CRITICAL RULES:
- Return ONLY the JSON object
- Escape all quote marks in content as \"
- NO markdown, NO extra text before or after
- Fill EVERY field with REAL, SPECIFIC content - NEVER generic placeholders
- keyElements must contain ACTUAL names, places, years, and concepts - NOT "Expert 1", "Place 1", "Throughout history", or "Many ideas"
- simpler must be genuinely simple and use everyday examples
- funFact must be interesting and surprising`;

    let content;
    if (GEMINI_API_KEY) {
      content = await callGemini(prompt);
    } else {
      const response = await fetch(`${OLLAMA_API_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false })
      });
      if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);
      const data = await response.json();
      content = data.response;
    }

    try {
      // Clean up the content
      let jsonStr = content.trim();

      // Remove markdown code blocks if present
      jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '').replace(/```/g, '');

      // Remove any text before the first { or after the last }
      const firstBrace = jsonStr.indexOf('{');
      const lastBrace = jsonStr.lastIndexOf('}');

      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
      }

      // Fix unescaped newlines in JSON strings (common issue with Llama output)
      jsonStr = jsonStr.replace(/"\s*\n\s*"/g, '" "').replace(/(\w)"(\n)(\w)/g, '$1\\n$3');

      let lesson = JSON.parse(jsonStr);

      // Validate required fields exist and have real content
      const isValidField = (field) => {
        return field &&
               typeof field === 'string' &&
               field.trim().length > 10 &&
               !field.includes('The basic idea') &&
               !field.includes('Generic') &&
               !field.includes('Throughout history') &&
               !field.includes('Around the world') &&
               !field.includes('Various experts') &&
               !field.includes('Many ideas');
      };

      // Check for generic/fallback content in simpler field
      if (!isValidField(lesson.simpler)) {
        console.warn('Simpler field has generic content, will regenerate');
        throw new Error('Simpler field contains generic content');
      }

      // Check if keyElements has real data (not all placeholders)
      if (lesson.keyElements) {
        const hasRealData =
          (Array.isArray(lesson.keyElements.people) && lesson.keyElements.people[0] && !lesson.keyElements.people[0].includes('Various')) &&
          (Array.isArray(lesson.keyElements.concepts) && lesson.keyElements.concepts[0] && !lesson.keyElements.concepts[0].includes('Many'));

        if (!hasRealData) {
          console.warn('KeyElements has placeholder data, will regenerate');
          throw new Error('KeyElements contains placeholder data');
        }
      }

      // Clean up text fields
      if (typeof lesson.explanation === 'string') {
        lesson.explanation = lesson.explanation.trim();
      }
      if (typeof lesson.simpler === 'string') {
        lesson.simpler = lesson.simpler.trim();
      }
      if (typeof lesson.deeperDive === 'string') {
        lesson.deeperDive = lesson.deeperDive.trim();
      }
      if (typeof lesson.funFact === 'string') {
        lesson.funFact = lesson.funFact.trim();
      }

      // Validate core structure
      if (!lesson.title || !isValidField(lesson.explanation) || !isValidField(lesson.simpler)) {
        throw new Error('Missing or invalid required fields');
      }

      // Post-process: If keyElements still has placeholders, extract from explanation
      if (lesson.keyElements && lesson.explanation) {
        const isPlaceholder = (str) =>
          !str ||
          str === 'Various experts' ||
          str === 'Around the world' ||
          str === 'Throughout history' ||
          str === 'Many ideas' ||
          str === 'Expert 1' ||
          str === 'Place 1' ||
          str === 'Year 1' ||
          str === 'Concept 1' ||
          str.includes('Various') ||
          str.includes('Around') ||
          str.includes('Throughout') ||
          str.includes('Many') ||
          str.includes('ideas');

        // Extract people: Look for capitalized names in the explanation
        if (lesson.keyElements.people.some(isPlaceholder)) {
          const peopleMatches = lesson.explanation
            .match(/\b([A-Z][a-zäöü]+\s+(?:[A-Z][a-z]+|[A-Z][a-zäöü]+|[A-Z]\.)+)/g) || [];
          if (peopleMatches.length > 0) {
            lesson.keyElements.people = [...new Set(peopleMatches)].slice(0, 3);
          }
        }

        // Extract concepts: Important words from explanation
        if (lesson.keyElements.concepts.some(isPlaceholder)) {
          const conceptWords = lesson.explanation
            .split(/[.!?,;:]/)
            .slice(2, 5)
            .join(' ')
            .split(' ')
            .filter(w => w.length > 6);
          if (conceptWords.length > 0) {
            lesson.keyElements.concepts = conceptWords.slice(0, 3).map(w => w.replace(/[^a-zA-Z]/g, ''));
          }
        }

        // Extract places: Look for institutions or locations
        if (lesson.keyElements.places.some(isPlaceholder)) {
          const placeMatches = lesson.explanation.match(/\b[A-Z][a-z]+\s+(?:University|Institute|Academy|Observatory|Laboratory|Center|Hospital|Department)\b/gi);
          if (placeMatches && placeMatches.length > 0) {
            lesson.keyElements.places = placeMatches.slice(0, 3);
          } else {
            // Fallback: Extract other proper nouns
            const properNouns = lesson.explanation.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g) || [];
            if (properNouns.length > 0) {
              lesson.keyElements.places = properNouns.slice(2, 5);
            }
          }
        }

        // Extract years
        if (lesson.keyElements.years.some(isPlaceholder)) {
          const yearMatches = lesson.explanation.match(/(?:in\s+)?([0-9]{4}|[0-9]{2}th\s+century)/gi) || [];
          if (yearMatches.length > 0) {
            lesson.keyElements.years = yearMatches.slice(0, 3);
          }
        }
      }

      lesson.id = Date.now();
      lesson.date = new Date().toISOString();
      lesson.topic = lesson.topic || selectedTopic;

      // Increment rate limit counter
      incrementRateLimit(userId);
      const updatedStatus = checkRateLimit(userId);

      res.json({
        success: true,
        lesson,
        rateLimitInfo: {
          hourlyRemaining: updatedStatus.hourlyRemaining,
          dailyRemaining: updatedStatus.dailyRemaining,
          hourlyLimit: HOURLY_LIMIT,
          dailyLimit: DAILY_LIMIT
        }
      });
    } catch (e) {
      console.error('JSON Parse Error:', e.message, 'Content sample:', content.substring(0, 100));
      // Extract real content from the raw response
      let explanationText = "";
      let simplerText = "";
      let deeperDiveText = "";
      let keyTakeaway = "";
      let funFact = "";
      let keyPeople = ["Key researchers in " + selectedTopic];
      let keyPlaces = ["Important institutions"];
      let keyYears = ["Historical dates"];
      let keyConcepts = ["Fundamental principles"];

      if (content && typeof content === 'string') {
        // Try to extract each field using regex patterns
        const explainMatch = content.match(/"explanation"\s*:\s*"([^"]*(?:\\"[^"]*)*)"/) ||
                            content.match(/explanation["\s:]*([^,\n]{50,300})/i);
        if (explainMatch) {
          explanationText = explainMatch[1]
            .replace(/\\"/g, '"')
            .replace(/\\n/g, ' ')
            .trim()
            .substring(0, 600);
        }

        const simplerMatch = content.match(/"simpler"\s*:\s*"([^"]*(?:\\"[^"]*)*)"/) ||
                            content.match(/simpler["\s:]*([^,\n]{30,200})/i);
        if (simplerMatch) {
          simplerText = simplerMatch[1]
            .replace(/\\"/g, '"')
            .replace(/\\n/g, ' ')
            .trim()
            .substring(0, 300);
        }

        const diveMatch = content.match(/"deeperDive"\s*:\s*"([^"]*(?:\\"[^"]*)*)"/) ||
                         content.match(/deeper["\s:]*([^,\n]{50,400})/i);
        if (diveMatch) {
          deeperDiveText = diveMatch[1]
            .replace(/\\"/g, '"')
            .replace(/\\n/g, ' ')
            .trim()
            .substring(0, 500);
        }

        const factMatch = content.match(/"funFact"\s*:\s*"([^"]*(?:\\"[^"]*)*)"/) ||
                         content.match(/fun["\s:]*([^,\n]{20,150})/i);
        if (factMatch) {
          funFact = factMatch[1]
            .replace(/\\"/g, '"')
            .trim()
            .substring(0, 200);
        }

        const takeawayMatch = content.match(/"keyTakeaway"\s*:\s*"([^"]*(?:\\"[^"]*)*)"/) ||
                             content.match(/key\s*takeaway["\s:]*([^,\n]{20,100})/i);
        if (takeawayMatch) {
          keyTakeaway = takeawayMatch[1]
            .replace(/\\"/g, '"')
            .trim()
            .substring(0, 150);
        }

        // Try to extract real names/places/years from content
        const peopleMatch = content.match(/people["\s:]*\[([^\]]+)\]/i);
        if (peopleMatch) {
          keyPeople = peopleMatch[1]
            .split(',')
            .map(p => p.replace(/"/g, '').replace(/'/g, '').trim())
            .filter(p => p.length > 2)
            .slice(0, 3);
        }

        const placesMatch = content.match(/places["\s:]*\[([^\]]+)\]/i);
        if (placesMatch) {
          keyPlaces = placesMatch[1]
            .split(',')
            .map(p => p.replace(/"/g, '').replace(/'/g, '').trim())
            .filter(p => p.length > 2)
            .slice(0, 3);
        }

        const yearsMatch = content.match(/years["\s:]*\[([^\]]+)\]/i);
        if (yearsMatch) {
          keyYears = yearsMatch[1]
            .split(',')
            .map(y => y.replace(/"/g, '').replace(/'/g, '').trim())
            .filter(y => y.length > 2)
            .slice(0, 3);
        }

        const conceptsMatch = content.match(/concepts["\s:]*\[([^\]]+)\]/i);
        if (conceptsMatch) {
          keyConcepts = conceptsMatch[1]
            .split(',')
            .map(c => c.replace(/"/g, '').replace(/'/g, '').trim())
            .filter(c => c.length > 2)
            .slice(0, 3);
        }
      }

      // Fallback with extracted content
      const fallback = {
        title: `${selectedTopic} Insight`,
        topic: selectedTopic,
        explanation: explanationText || `${selectedTopic} is a fascinating and important field of study with wide-ranging applications and deep historical significance that continues to evolve today.`,
        simpler: simplerText || `${selectedTopic} is about how things work at a fundamental level. Think of it like learning the basic rules of a game before you can play it well.`,
        keyTakeaway: keyTakeaway || `Understanding ${selectedTopic} helps us solve real-world problems and understand the world around us.`,
        deeperDive: deeperDiveText || `Advanced study of ${selectedTopic} involves complex theories, cutting-edge research, and applications in multiple fields.`,
        funFact: funFact || `One fascinating aspect of ${selectedTopic} is how it connects to everyday phenomena we often take for granted.`,
        keyElements: {
          people: keyPeople.length > 0 ? keyPeople : ["Notable researchers", "Key scientists", "Important thinkers"],
          places: keyPlaces.length > 0 ? keyPlaces : ["Universities", "Research centers", "Key institutions"],
          years: keyYears.length > 0 ? keyYears : ["Historical period", "Modern era", "Contemporary times"],
          concepts: keyConcepts.length > 0 ? keyConcepts : ["Fundamental principle", "Key theory", "Core concept"]
        },
        relatedTopics: topics.filter(t => t !== selectedTopic).slice(0, 3),
        id: Date.now(),
        date: new Date().toISOString()
      };

      // Post-process fallback: Extract real data from explanation
      if (fallback.keyElements && fallback.explanation) {
        // Extract people
        const peopleMatches = fallback.explanation
          .match(/\b([A-Z][a-zäöü]+\s+(?:[A-Z][a-z]+|[A-Z][a-zäöü]+|[A-Z]\.)+)/g) || [];
        if (peopleMatches.length > 0) {
          fallback.keyElements.people = [...new Set(peopleMatches)].slice(0, 3);
        }

        // Extract concepts
        const conceptWords = fallback.explanation
          .split(/[.!?,;:]/)
          .slice(2, 5)
          .join(' ')
          .split(' ')
          .filter(w => w.length > 6);
        if (conceptWords.length > 0) {
          fallback.keyElements.concepts = conceptWords.slice(0, 3).map(w => w.replace(/[^a-zA-Z]/g, ''));
        }

        // Extract places
        const placeMatches = fallback.explanation.match(/\b[A-Z][a-z]+\s+(?:University|Institute|Academy|Observatory|Laboratory|Center|Hospital)\b/gi);
        if (placeMatches && placeMatches.length > 0) {
          fallback.keyElements.places = placeMatches.slice(0, 3);
        }

        // Extract years
        const yearMatches = fallback.explanation.match(/(?:in\s+)?([0-9]{4}|[0-9]{2}th\s+century)/gi);
        if (yearMatches && yearMatches.length > 0) {
          fallback.keyElements.years = yearMatches.slice(0, 3);
        }
      }

      // Increment rate limit counter
      incrementRateLimit(userId);
      const updatedStatus = checkRateLimit(userId);

      res.json({
        success: true,
        lesson: fallback,
        rateLimitInfo: {
          hourlyRemaining: updatedStatus.hourlyRemaining,
          dailyRemaining: updatedStatus.dailyRemaining,
          hourlyLimit: HOURLY_LIMIT,
          dailyLimit: DAILY_LIMIT
        }
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: 'Failed to generate lesson' });
  }
});

// Get all categories with their subcategories
app.get('/api/categories', (req, res) => {
  const categories = Object.keys(categoryMapping).map(parentCategory => {
    const folderNames = categoryMapping[parentCategory];
    let lessonCount = 0;

    // Count lessons in all folders for this category
    folderNames.forEach(folderName => {
      const folderPath = resolveFolder(folderName);
      if (folderPath && fs.existsSync(folderPath)) {
        const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.json') && !f.includes('_progress'));
        lessonCount += files.length;
      }
    });

    return {
      id: parentCategory.toLowerCase().replace(/\s+/g, '-'),
      name: parentCategory,
      count: lessonCount,
      subCategories: folderNames
    };
  });
  res.json({ categories });
});

// Get lessons for a specific category
app.get('/api/categories/:category/lessons', (req, res) => {
  try {
    const { category } = req.params;
    const parentCategoryName = Object.keys(categoryMapping).find(key =>
      key.toLowerCase().replace(/\s+/g, '-') === category.toLowerCase()
    );

    if (!parentCategoryName || !categoryMapping[parentCategoryName]) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const folderNames = categoryMapping[parentCategoryName];
    const allLessons = [];

    // Load lessons from all folders in this category
    folderNames.forEach(folderName => {
      const folderPath = resolveFolder(folderName);

      if (folderPath && fs.existsSync(folderPath)) {
        const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.json') && !f.includes('_progress'));

        files.forEach(file => {
          try {
            const filePath = path.join(folderPath, file);
            const lesson = JSON.parse(fs.readFileSync(filePath, 'utf8'));

            // Add metadata about which subcategory this came from
            lesson.subcategory = folderName;
            allLessons.push(lesson);
          } catch (e) {
            console.warn(`Failed to parse lesson: ${file} in ${folderName}`);
          }
        });
      }
    });

    res.json({
      category: parentCategoryName,
      lessons: allLessons,
      count: allLessons.length
    });
  } catch (error) {
    console.error('Error loading lessons:', error);
    res.status(500).json({ error: 'Failed to load lessons' });
  }
});

// Get available topics
app.get('/api/topics', (req, res) => {
  res.json({ topics });
});

// Deep dive - extensive information about a topic
app.post('/api/deepdive', async (req, res) => {
  try {
    const { topic, lessonTitle } = req.body;

    const prompt = `Provide an extensive, detailed deep dive about "${topic}" that goes beyond basic knowledge. This is meant to provide comprehensive understanding.${lessonTitle ? ` The user already learned about "${lessonTitle}", so provide new information and perspectives not covered there.` : ''}

Generate a response with multiple detailed paragraphs covering:
1. Historical context and evolution
2. Current state and recent developments
3. Different perspectives and theories
4. Real-world applications and implications
5. Future outlook and emerging trends

Make it educational, engaging, and truly in-depth (at least 500 words).`;

    let content;
    if (GEMINI_API_KEY) {
      content = await callGemini(prompt);
    } else {
      const response = await fetch(`${OLLAMA_API_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false })
      });
      if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);
      const data = await response.json();
      content = data.response || '';
    }

    res.json({
      success: true,
      deepDive: {
        topic,
        content,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Deep dive error:', error.message);
    res.status(500).json({ error: 'Failed to generate deep dive' });
  }
});

// Serve index.html for any unmatched routes (SPA fallback)
app.get('*', (req, res) => {
  const html = fs.readFileSync(path.join(frontendPath, 'index.html'), 'utf8');
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`🎓 Teach Me Something running on port ${PORT}`);
});
