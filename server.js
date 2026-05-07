const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 5005;

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
        return JSON.parse(content);
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

app.listen(PORT, () => {
  console.log(`\n✅ Lesson Server running on http://localhost:${PORT}`);
  console.log(`📚 Serving lessons from: ${LESSONS_DIR}\n`);
});
