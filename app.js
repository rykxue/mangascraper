const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
const staticDir = path.join(process.cwd(), 'public/static');
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
async function downloadChapterManganelo(url, title, chapter, outputDir, baseUrl) {
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const images = [];
  const downloadPromises = [];
  const chapterDir = path.join(outputDir, sanitizeFilename(`${title}_chapter_${chapter}`));
  const publicPath = `${baseUrl}/static/${sanitizeFilename(title)}/chapter_${chapter}`;

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
          responseType: 'arraybuffer'
        }).then((response) => {
          return fs.promises.writeFile(filePath, response.data);
        })
      );

      images.push(`${publicPath}/${filename}`); // Publicly accessible URL
    }
  });

  // Wait for all downloads to complete
  await Promise.all(downloadPromises);

  return images;
}

// Parse chapter ranges
function parseChapterRange(range) {
  const [start, end] = range.split('-').map(Number);
  if (!start || !end || start > end) {
    throw new Error('Invalid chapter range format. Use "start-end", e.g., "1-5".');
  }
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

// API endpoint for searching and downloading manga chapters
app.get('/api/manga', async (req, res) => {
  const { name, chapter } = req.query;

  if (!name) {
    return res.status(400).json({ error: 'Name parameter is required.' });
  }

  if (!chapter) {
    return res.status(400).json({ error: 'Chapter parameter is required.' });
  }

  try {
    const chapterNumbers = parseChapterRange(chapter);

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
    for (const chapterNum of chapterNumbers) {
      const chapterUrl = `${manga.url}/chapter-${chapterNum}`;
      const images = await downloadChapterManganelo(chapterUrl, manga.name, chapterNum, outputDir, req.protocol + '://' + req.get('host'));
      downloadedChapters[chapterNum] = images;
      await new Promise(resolve => setTimeout(resolve, 1000)); // Add delay between chapter downloads
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

// Test the functionality
/*
const testManga = async () => {
  try {
    const mangaName = 'One Piece';
    const chapterRange = '1-3';
    const url = `http://localhost:${PORT}/api/manga?name=${encodeURIComponent(mangaName)}&chapter=${chapterRange}`;
    const response = await axios.get(url);
    console.log('API Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Test failed:', error.message);
  }
};

testManga();
*/
