const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 5005;

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

const LESSONS_DIR = path.join(__dirname, 'backend', 'lessons');

// Serve index.html for root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Get all categories
app.get('/api/categories', (req, res) => {
  try {
    const categories = fs.readdirSync(LESSONS_DIR).filter(file => {
      const stat = fs.statSync(path.join(LESSONS_DIR, file));
      return stat.isDirectory();
    });

    const categoryData = categories.map(cat => {
      const lessonsPath = path.join(LESSONS_DIR, cat);
      const lessons = fs.readdirSync(lessonsPath).filter(f => f.endsWith('.json'));
      return {
        id: cat,
        name: cat.replace(/_/g, ' '),
        count: lessons.length
      };
    });

    res.json(categoryData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load categories' });
  }
});

// Get lessons by category
app.get('/api/categories/:category/lessons', (req, res) => {
  try {
    const { category } = req.params;
    const lessonsPath = path.join(LESSONS_DIR, category);

    if (!fs.existsSync(lessonsPath)) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const lessons = fs.readdirSync(lessonsPath)
      .filter(f => f.endsWith('.json'))
      .map(file => {
        const content = fs.readFileSync(path.join(lessonsPath, file), 'utf-8');
        const lesson = JSON.parse(content);
        // Attach routing keys so the frontend can build share/deep-link URLs
        lesson._id = file.replace('.json', '');
        lesson._category = category;
        return lesson;
      });

    res.json(lessons);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load lessons' });
  }
});

// Get single lesson
app.get('/api/categories/:category/lessons/:lessonId', (req, res) => {
  try {
    const { category, lessonId } = req.params;
    const lessonsPath = path.join(LESSONS_DIR, category);
    const lessonFile = path.join(lessonsPath, `${lessonId}.json`);

    if (!fs.existsSync(lessonFile)) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const content = fs.readFileSync(lessonFile, 'utf-8');
    res.json(JSON.parse(content));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load lesson' });
  }
});

// Get featured lessons (first 6)
app.get('/api/lessons/featured', (req, res) => {
  try {
    const categories = fs.readdirSync(LESSONS_DIR).filter(file => {
      const stat = fs.statSync(path.join(LESSONS_DIR, file));
      return stat.isDirectory();
    });

    const featured = [];

    for (const category of categories) {
      if (featured.length >= 6) break;

      const lessonsPath = path.join(LESSONS_DIR, category);
      const lessons = fs.readdirSync(lessonsPath)
        .filter(f => f.endsWith('.json'))
        .slice(0, 1);

      lessons.forEach(file => {
        const content = fs.readFileSync(path.join(lessonsPath, file), 'utf-8');
        featured.push(JSON.parse(content));
      });
    }

    res.json(featured);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load featured lessons' });
  }
});

// Search lessons
app.get('/api/lessons/search', (req, res) => {
  try {
    const query = (req.query.q || '').toLowerCase();
    const results = [];

    const categories = fs.readdirSync(LESSONS_DIR).filter(file => {
      const stat = fs.statSync(path.join(LESSONS_DIR, file));
      return stat.isDirectory();
    });

    for (const category of categories) {
      const lessonsPath = path.join(LESSONS_DIR, category);
      const lessons = fs.readdirSync(lessonsPath).filter(f => f.endsWith('.json'));

      for (const file of lessons) {
        const content = fs.readFileSync(path.join(lessonsPath, file), 'utf-8');
        const lesson = JSON.parse(content);

        if (
          lesson.title.toLowerCase().includes(query) ||
          lesson.topic.toLowerCase().includes(query) ||
          lesson.lesson.learn.toLowerCase().includes(query)
        ) {
          results.push({ ...lesson, category });
          if (results.length >= 20) break;
        }
      }
      if (results.length >= 20) break;
    }

    res.json(results);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to search lessons' });
  }
});

// Share URL handler — injects OG meta tags so link-unfurl previews show the lesson image
app.get('/share/:category/:id', (req, res) => {
  try {
    const { category, id } = req.params;
    const lessonFile = path.join(LESSONS_DIR, category, `${id}.json`);
    if (!fs.existsSync(lessonFile)) {
      return res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
    }
    const lesson = JSON.parse(fs.readFileSync(lessonFile, 'utf-8'));
    const title = lesson.title || 'Pocket Topics';
    const desc  = (lesson.lesson && (lesson.lesson.keyTakeaway || lesson.lesson.funFact)) || '';
    const imageUrl = lesson.image ? lesson.image.split('?')[0] : '';
    const origin = `${req.protocol}://${req.get('host')}`;

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escHtml(title)} | Pocket Topics</title>
  <meta name="description" content="${escHtml(desc)}">
  <meta property="og:type"        content="article">
  <meta property="og:site_name"   content="Pocket Topics">
  <meta property="og:title"       content="${escHtml(title)}">
  <meta property="og:description" content="${escHtml(desc)}">
  ${imageUrl ? `<meta property="og:image" content="${escHtml(imageUrl)}">` : ''}
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:title"       content="${escHtml(title)}">
  <meta name="twitter:description" content="${escHtml(desc)}">
  ${imageUrl ? `<meta name="twitter:image" content="${escHtml(imageUrl)}">` : ''}
  <meta http-equiv="refresh" content="0;url=${origin}/">
</head>
<body>
  <script>window.location.replace('${origin}/')</script>
</body>
</html>`);
  } catch (error) {
    console.error(error);
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
  }
});

// Catch-all: serve the SPA for any other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ Lesson Server running on http://localhost:${PORT}`);
  console.log(`📚 Serving lessons from: ${LESSONS_DIR}\n`);
});
