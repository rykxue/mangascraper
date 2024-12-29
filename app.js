const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
const staticDir = path.join(__dirname, 'public/static');
if (!fs.existsSync(staticDir)) {
  fs.mkdirSync(staticDir, { recursive: true });
}
app.use('/static', express.static(staticDir));

// Utility function to sanitize filenames
function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

// Function to search for manga
async function searchMangaManganelo(query, numOfResults = 1) {
  const url = `https://mangakakalot.com/search/story/${encodeURIComponent(query.replace(/ /g, '_'))}`;
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const results = [];
  $('.story_item').each((i, el) => {
    if (i >= numOfResults) return false;
    const $el = $(el);
    results.push({
      name: $el.find('.story_name a').text().trim(),
      url: $el.find('.story_chapter a').attr('href'),
      latest: $el.find('.story_chapter a').attr('title'),
      updated: $el.find('.story_item_right').text().match(/Updated : (.*)/)[1],
    });
  });

  if (results.length === 0) {
    throw new Error('No manga found');
  }

  return results;
}

// Function to download images from a manga chapter
async function downloadChapterManganelo(url, title, chapter, outputDir) {
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const images = [];
  const downloadPromises = [];
  const chapterDir = path.join(outputDir, sanitizeFilename(`${title}_chapter_${chapter}`));

  if (!fs.existsSync(chapterDir)) {
    fs.mkdirSync(chapterDir, { recursive: true });
  }

  $('.container-chapter-reader img').each((index, el) => {
    const imgUrl = $(el).attr('src');
    if (imgUrl) {
      const filename = `${sanitizeFilename(title)}_chapter_${chapter}_${index + 1}.jpg`;
      const filePath = path.join(chapterDir, filename);

      // Push download promise for parallel downloading
      downloadPromises.push(
        axios({
          url: imgUrl,
          method: 'GET',
          responseType: 'stream',
        }).then((response) => {
          return new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
          });
        })
      );

      images.push(`/static/${sanitizeFilename(title)}/chapter_${chapter}/${filename}`); // Public path
    }
  });

  // Wait for all downloads to complete
  await Promise.all(downloadPromises);

  return images;
}

// API endpoint for searching and downloading manga chapters
app.get('/api/manga', async (req, res) => {
  const { name, chapters } = req.query;

  if (!name) {
    return res.status(400).json({ error: 'Name parameter is required.' });
  }

  const chapterNumbers = chapters
    ? chapters.split(',').map((ch) => parseInt(ch, 10)).filter((ch) => !isNaN(ch))
    : [];

  try {
    const searchResults = await searchMangaManganelo(name, 1);
    if (searchResults.length === 0) {
      return res.status(404).json({ error: 'No manga found.' });
    }

    const manga = searchResults[0];
    const sanitizedTitle = sanitizeFilename(manga.name);
    const outputDir = path.join(staticDir, sanitizedTitle);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const downloadedChapters = {};
    for (const chapter of chapterNumbers) {
      const chapterUrl = `${manga.url}/chapter-${chapter}`;
      const images = await downloadChapterManganelo(chapterUrl, manga.name, chapter, outputDir);
      downloadedChapters[chapter] = images;
    }

    res.json({
      title: manga.name,
      url: manga.url,
      latest: manga.latest,
      chapters: downloadedChapters,
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: error.message });
  }
});

// Start the server
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
