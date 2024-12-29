const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { urlEncode, fetchHTML, downloadImages, parseChapterRange } = require('./utils/scraper-utils');
const { searchMangaReadmanhwa, fetchMangaDetailsReadmanhwa, downloadChapterReadmanhwa } = require('./utils/readmanhwa');
const { searchMangaGmanga, fetchMangaDetailsGmanga, downloadChapterGmanga } = require('./utils/gmanga');
const { searchMangaManganelo, fetchMangaDetailsManganelo, downloadChapterManganelo } = require('./utils/manganelo');
const { searchMangaManga4life, fetchMangaDetailsManga4life, downloadChapterManga4life } = require('./utils/manga4life');
const { searchMangaMangafox, fetchMangaDetailsMangafox, downloadChapterMangafox } = require('./utils/mangafox');

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

// Manga sources
const SOURCES = {
  MANGAFOX: 'mangafox',
  READMANHWA: 'readmanhwa',
  MANGANELO: 'manganelo',
  MANGA4LIFE: 'manga4life',
  GMANGA: 'gmanga'
};

// API Endpoints
app.get('/api/manga', async (req, res) => {
  try {
    const { name, source = SOURCES.MANGAFOX, chapters, format = 'json' } = req.query;

    if (!name) {
      return res.status(400).json({ error: 'Name parameter is required' });
    }

    let searchResult, mangaDetails, chapterImages;
    const chapterList = parseChapterRange(chapters);

    switch (source.toLowerCase()) {
      case SOURCES.MANGAFOX:
        searchResult = await searchMangaMangafox(name, 1);
        mangaDetails = await fetchMangaDetailsMangafox(searchResult[0].url.split('/').pop());
        chapterImages = await Promise.all(chapterList.map(chapter => 
          downloadChapterMangafox(searchResult[0].url.split('/').pop(), chapter)
        ));
        break;
      case SOURCES.READMANHWA:
        searchResult = await searchMangaReadmanhwa(name, 1);
        mangaDetails = await fetchMangaDetailsReadmanhwa(searchResult[0].slug);
        chapterImages = await Promise.all(chapterList.map(chapter => 
          downloadChapterReadmanhwa(searchResult[0].slug, chapter)
        ));
        break;
      case SOURCES.MANGANELO:
        searchResult = await searchMangaManganelo(name, 1);
        mangaDetails = await fetchMangaDetailsManganelo(searchResult[0].url);
        chapterImages = await Promise.all(chapterList.map(chapter => 
          downloadChapterManganelo(`${searchResult[0].url}/chapter-${chapter}`)
        ));
        break;
      case SOURCES.MANGA4LIFE:
        searchResult = await searchMangaManga4life(name, 1);
        mangaDetails = await fetchMangaDetailsManga4life(searchResult[0].slug);
        chapterImages = await Promise.all(chapterList.map(chapter => 
          downloadChapterManga4life(searchResult[0].slug, chapter)
        ));
        break;
      case SOURCES.GMANGA:
        searchResult = await searchMangaGmanga(name, 1);
        mangaDetails = await fetchMangaDetailsGmanga(searchResult[0].slug);
        chapterImages = await Promise.all(chapterList.map(chapter => 
          downloadChapterGmanga(searchResult[0].slug, chapter)
        ));
        break;
      default:
        return res.status(400).json({ error: 'Invalid source' });
    }

    const data = {
      title: searchResult[0].name,
      source: source,
      status: searchResult[0].status,
      chapters: chapterList.map((chapter, index) => ({
        chapter: chapter,
        images: chapterImages[index]
      }))
    };

    if (format === 'xml') {
      res.set('Content-Type', 'application/xml');
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<manga>\n';
      xml += `  <title>${data.title}</title>\n`;
      xml += `  <source>${data.source}</source>\n`;
      xml += `  <status>${data.status}</status>\n`;
      xml += '  <chapters>\n';
      data.chapters.forEach(chapter => {
        xml += `    <chapter number="${chapter.chapter}">\n`;
        chapter.images.forEach(image => {
          xml += `      <image>${image}</image>\n`;
        });
        xml += '    </chapter>\n';
      });
      xml += '  </chapters>\n</manga>';
      return res.send(xml);
    }

    res.json(data);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Download endpoint
app.get('/api/download', async (req, res) => {
  try {
    const { url, referer } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    const images = await downloadImages([url], referer);
    
    if (images.length === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const image = images[0];
    res.set('Content-Type', image.contentType);
    res.send(image.data);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
