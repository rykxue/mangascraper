const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const port = process.env.PORT || 3000;

// Helper function to fetch HTML content
async function fetchHTML(url) {
  const { data } = await axios.get(url);
  return cheerio.load(data);
}

// Helper function to extract manga information
async function getMangaInfo(name, source = 'mangadex') {
  let mangaId, mangaTitle;

  switch (source) {
    case 'mangadex':
      const searchResponse = await axios.get(`https://api.mangadex.org/manga`, {
        params: {
          title: name,
          limit: 1,
          order: { relevance: 'desc' }
        }
      });
      if (searchResponse.data.data.length === 0) {
        throw new Error('Manga not found');
      }
      mangaId = searchResponse.data.data[0].id;
      mangaTitle = searchResponse.data.data[0].attributes.title.en;
      return { mangaId, mangaTitle };

    case 'mangafox':
      const searchUrl = `https://fanfox.net/search?k=${encodeURIComponent(name)}`;
      const $ = await fetchHTML(searchUrl);
      const firstResult = $('.line-list li').first();
      const mangaUrl = firstResult.find('.manga-list-4-item-title a').attr('href');
      mangaTitle = firstResult.find('.manga-list-4-item-title').text().trim();
      if (!mangaUrl) {
        throw new Error('Manga not found');
      }
      return { mangaUrl: `https://fanfox.net${mangaUrl}`, mangaTitle };

    case 'mangakakalot':
      const kakalotSearchUrl = `https://mangakakalot.com/search/story/${encodeURIComponent(name)}`;
      const $kakalot = await fetchHTML(kakalotSearchUrl);
      const kakalotFirstResult = $('.story_item').first();
      const kakalotMangaUrl = kakalotFirstResult.find('.story_name a').attr('href');
      mangaTitle = kakalotFirstResult.find('.story_name a').text().trim();
      if (!kakalotMangaUrl) {
        throw new Error('Manga not found');
      }
      return { mangaUrl: kakalotMangaUrl, mangaTitle };

    default:
      throw new Error('Unsupported source');
  }
}

// Helper function to get chapter images
async function getChapterImages(chapterInfo, source) {
  switch (source) {
    case 'mangadex':
      const { data } = await axios.get(`https://api.mangadex.org/at-home/server/${chapterInfo.id}`);
      const baseUrl = data.baseUrl;
      const chapterHash = data.chapter.hash;
      return data.chapter.data.map(page => `${baseUrl}/data/${chapterHash}/${page}`);

    case 'mangafox':
      const $ = await fetchHTML(chapterInfo.url);
      return $('.reader-main .reader-main-img').map((_, elem) => $(elem).attr('data-src')).get();

    case 'mangakakalot':
      const $kakalot = await fetchHTML(chapterInfo.url);
      return $('.container-chapter-reader img').map((_, elem) => $(elem).attr('src')).get();

    default:
      throw new Error('Unsupported source');
  }
}

// Helper function to parse chapter range
function parseChapterRange(range) {
  const parts = range.split('-');
  if (parts.length === 1) {
    return [parseInt(parts[0], 10)];
  } else if (parts.length === 2) {
    const start = parseInt(parts[0], 10);
    const end = parseInt(parts[1], 10);
    return Array.from({length: end - start + 1}, (_, i) => start + i);
  } else {
    throw new Error('Invalid chapter range format');
  }
}

app.get('/readmanga', async (req, res) => {
  const { name, chapters, source = 'mangadex', format = 'json', quality = 'high' } = req.query;

  if (!name || !chapters) {
    return res.status(400).json({ error: 'Missing name or chapters parameter' });
  }

  try {
    const mangaInfo = await getMangaInfo(name, source);
    const chapterList = parseChapterRange(chapters);

    const mangaData = {
      mangaTitle: mangaInfo.mangaTitle,
      source,
      quality,
      chapters: []
    };

    for (const chapterNum of chapterList) {
      let chapterInfo;

      if (source === 'mangadex') {
        const chapterResponse = await axios.get(`https://api.mangadex.org/chapter`, {
          params: {
            manga: mangaInfo.mangaId,
            chapter: chapterNum.toString(),
            translatedLanguage: ['en'],
            limit: 1
          }
        });
        if (chapterResponse.data.data.length === 0) {
          console.warn(`Chapter ${chapterNum} not found for ${mangaInfo.mangaTitle}`);
          continue;
        }
        chapterInfo = { id: chapterResponse.data.data[0].id };
      } else {
        chapterInfo = {
          url: source === 'mangafox' 
            ? `${mangaInfo.mangaUrl}chapter-${chapterNum}.html`
            : `${mangaInfo.mangaUrl}/chapter-${chapterNum}`
        };
      }

      const images = await getChapterImages(chapterInfo, source);

      // Apply quality filter
      const filteredImages = quality === 'low' ? images.filter((_, index) => index % 2 === 0) : images;

      mangaData.chapters.push({
        chapterNumber: chapterNum,
        images: filteredImages
      });
    }

    if (format === 'xml') {
      res.set('Content-Type', 'application/xml');
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<manga>\n';
      xml += `  <title>${mangaData.mangaTitle}</title>\n`;
      xml += `  <source>${source}</source>\n`;
      xml += `  <quality>${quality}</quality>\n`;
      xml += '  <chapters>\n';
      mangaData.chapters.forEach(chapter => {
        xml += `    <chapter number="${chapter.chapterNumber}">\n`;
        chapter.images.forEach(img => {
          xml += `      <image>${img}</image>\n`;
        });
        xml += '    </chapter>\n';
      });
      xml += '  </chapters>\n</manga>';
      res.send(xml);
    } else {
      res.json(mangaData);
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch manga data', message: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

