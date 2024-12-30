import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import express from 'express';
import puppeteer from 'puppeteer';

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
const staticDir = path.join(process.cwd(), 'public/static');
await fs.mkdir(staticDir, { recursive: true });
app.use('/static', express.static(staticDir));

// Utility function to sanitize filenames
function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

// Function to search for manga on Mangakakalot
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
      url: $el.find('.story_name a').attr('href'),
      latest: $el.find('.story_chapter a').attr('title'),
      updated: $el.find('.story_item_right').text().match(/Updated : (.*)/)[1],
    });
  });

  if (results.length === 0) {
    throw new Error('No manga found');
  }

  return results;
}

// Function to get chapter URLs from Chapmanganato
async function getChapterUrls(mangaUrl, chapterRange) {
  const { data } = await axios.get(mangaUrl);
  const $ = cheerio.load(data);

  const chapterLinks = {};

  // Iterate over each chapter item in the list
  $('ul.row-content-chapter li.a-h').each((_, el) => {
    const chapterText = $(el).find('.chapter-name').text();
    const chapterUrl = $(el).find('a').attr('href');
    const chapterNumber = parseInt(chapterText.match(/Chapter (\d+(\.\d+)?)/i)?.[1]);

    if (chapterNumber && chapterRange.includes(chapterNumber)) {
      chapterLinks[chapterNumber] = chapterUrl;
    }
  });

  return chapterLinks;
}

// Function to get chapter images using Puppeteer
async function getChapterImagesFromChapmanganato(chapterUrl) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(chapterUrl, { waitUntil: 'networkidle0' }); // Wait for the page to load

  // Extract image URLs from the page
  const images = await page.evaluate(() => {
    const imgElements = document.querySelectorAll('.container-chapter-reader img');
    return Array.from(imgElements).map(img => img.src || img.dataset.src);
  });

  await browser.close();
  return images;
}

// Function to download images from a manga chapter
async function downloadChapterManganelo(url, title, chapter, outputDir, baseUrl) {
  const images = await getChapterImagesFromChapmanganato(url);

  const downloadPromises = [];
  const chapterDir = path.join(outputDir, sanitizeFilename(`${title}_chapter_${chapter}`));

  await fs.mkdir(chapterDir, { recursive: true });

  images.forEach((imgUrl, index) => {
    const filename = `${sanitizeFilename(title)}_chapter_${chapter}_${index + 1}.jpg`;
    const filePath = path.join(chapterDir, filename);

    // Push download promise for parallel downloading
    downloadPromises.push(
      axios({
        url: imgUrl,
        method: 'GET',
        responseType: 'arraybuffer',
      }).then((response) => {
        return fs.writeFile(filePath, response.data);
      })
    );
  });

  // Wait for all downloads to complete
  await Promise.all(downloadPromises);

  return images.map(imgUrl => `${baseUrl}/static/${sanitizeFilename(title)}/chapter_${chapter}/${sanitizeFilename(title)}_chapter_${chapter}_${images.indexOf(imgUrl) + 1}.jpg`);
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
    const chapterRange = parseChapterRange(chapter);

    const searchResults = await searchMangaManganelo(name, 1);
    if (searchResults.length === 0) {
      return res.status(404).json({ error: 'No manga found.' });
    }

    const manga = searchResults[0];
    const sanitizedTitle = sanitizeFilename(manga.name);
    const outputDir = path.join(staticDir, sanitizedTitle);
    await fs.mkdir(outputDir, { recursive: true });

    const chapterUrls = await getChapterUrls(manga.url, chapterRange);
    const downloadedChapters = {};

    for (const [chapterNum, chapterUrl] of Object.entries(chapterUrls)) {
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
