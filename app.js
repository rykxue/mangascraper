const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Static files for serving downloaded images
const staticDir = path.join(__dirname, 'public/static');
if (!fs.existsSync(staticDir)) {
  fs.mkdirSync(staticDir, { recursive: true });
}
app.use('/static', express.static(staticDir));

// Utility: Parse chapter range
function parseChapterRange(chapters) {
  if (!chapters) return [];
  return chapters.split(',').flatMap((range) => {
    const [start, end] = range.split('-').map(Number);
    if (end) {
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
    return [start];
  });
}

// Scraping logic for Manganelo
async function searchMangaManganelo(input, numOfSearch) {
  const url = `https://mangakakalot.com/search/story/${encodeURIComponent(input.replace(/ /g, '_'))}`;
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const results = [];
  $('.story_item').each((i, el) => {
    if (i >= numOfSearch) return false;
    const $el = $(el);
    results.push({
      name: $el.find('.story_name a').text().trim(),
      url: $el.find('.story_name a').attr('href'),
      latest: $el.find('.story_chapter a').attr('title'),
      updated: $el.find('.story_item_right').text().match(/Updated : (.*)/)[1]
    });
  });

  if (results.length === 0) {
    throw new Error('No manga found');
  }

  return results;
}

async function downloadChapterManganelo(chapterUrl) {
  try {
    const { data } = await axios.get(chapterUrl); // Go to the chapter URL
    const $ = cheerio.load(data);

    const images = [];
    $('.container-chapter-reader img').each((_, el) => {
      const imgSrc = $(el).attr('src');
      if (imgSrc) {
        images.push(imgSrc); // Collect image sources
      }
    });

    return images; // Return all image URLs
  } catch (error) {
    console.error(`Error fetching chapter from ${chapterUrl}:`, error.message);
    throw new Error(`Failed to download chapter from ${chapterUrl}`);
  }
}

// API Endpoints
app.get('/api/manga', async (req, res) => {
  try {
    const { name, chapters, format = 'json' } = req.query;

    if (!name) {
      return res.status(400).json({ error: 'Name parameter is required' });
    }

    const chapterList = parseChapterRange(chapters);

    // Search and download images
    const searchResult = await searchMangaManganelo(name, 1);
    if (!searchResult || searchResult.length === 0) {
      return res.status(404).json({ error: 'Manga not found' });
    }

    const title = searchResult[0].name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const chapterImages = await Promise.all(
      chapterList.map(async (chapter) => {
        const chapterUrl = `${searchResult[0].url}/chapter-${chapter}`;
        const images = await downloadChapterManganelo(chapterUrl);

        // Save images locally
        const chapterDir = path.join(staticDir, title, `chapter_${chapter}`);
        if (!fs.existsSync(chapterDir)) {
          fs.mkdirSync(chapterDir, { recursive: true });
        }

        const localImages = [];
        await Promise.all(
          images.map(async (imgUrl, index) => {
            const filename = `${title}_${chapter}_${index + 1}.jpg`;
            const filePath = path.join(chapterDir, filename);

            const response = await axios({
              url: imgUrl,
              method: 'GET',
              responseType: 'stream'
            });

            await new Promise((resolve, reject) => {
              const writer = fs.createWriteStream(filePath);
              response.data.pipe(writer);
              writer.on('finish', resolve);
              writer.on('error', reject);
            });

            localImages.push(`/static/${title}/chapter_${chapter}/${filename}`);
          })
        );

        return localImages;
      })
    );

    // Build response
    const data = {
      title: searchResult[0].name,
      source: 'manganelo',
      status: searchResult[0].latest || 'Unknown',
      chapters: chapterList.map((chapter, index) => ({
        chapter,
        images: chapterImages[index]
      }))
    };

    // Format output (JSON or XML)
    if (format === 'xml') {
      res.set('Content-Type', 'application/xml');
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<manga>\n';
      xml += `  <title>${data.title}</title>\n`;
      xml += `  <source>${data.source}</source>\n`;
      xml += `  <status>${data.status}</status>\n`;
      xml += '  <chapters>\n';
      data.chapters.forEach((chapter) => {
        xml += `    <chapter number="${chapter.chapter}">\n`;
        chapter.images.forEach((image) => {
          xml += `      <image>${image}</image>\n`;
        });
        xml += '    </chapter>\n';
      });
      xml += '  </chapters>\n</manga>';
      return res.send(xml);
    }

    res.json(data);
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
