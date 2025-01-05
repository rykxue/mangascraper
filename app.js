const express = require('express');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const { searchMangazero, fetchInfoMangazero, downloadChapterMangazero } = require('./utils/mangazero');
const { searchWeebverse, fetchInfoWeebverse, downloadChapterWeebverse } = require('./utils/weebverse');
const { searchWeebverse2, fetchInfoWeebverse2, downloadChapterWeebverse2 } = require('./utils/weebverse2');

const app = express();
const port = process.env.PORT || 10001;

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
};

app.get('*', (req, res) => {
  res.sendFile(__dirname + '/public/error.html');
}

app.use('/images', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static('downloads'));

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

async function getMangaInfo(name, source = 'mangadex', language = 'en') {
  switch (source) {
    case 'mangadex': {
      const searchResponse = await axios.get('https://api.mangadex.org/manga', {
        params: {
          title: name,
          limit: 5,
          order: { relevance: 'desc' },
        },
      });

      if (searchResponse.data.data.length === 0) {
        throw new Error('Manga not found');
      }

      return {
        mangaId: searchResponse.data.data[0].id,
        mangaTitle: searchResponse.data.data[0].attributes.title.en || name,
        language,
      };
    }
    case 'mangazero': {
      const searchResult = await searchMangazero(name, 1);
      const mangaDetails = await fetchInfoMangazero(searchResult[0].url);
      return {
        mangaUrl: searchResult[0].url,
        mangaTitle: searchResult[0].name,
        chapters: mangaDetails.pages,
        referer: searchResult[0].referer,
      };
    }
    case 'weebverse': {
      const searchResult = await searchWeebverse(name, 1);
      const mangaDetails = await fetchInfoWeebverse(searchResult[0].slug);
      return {
        mangaSlug: searchResult[0].slug,
        mangaTitle: searchResult[0].name,
        chapters: mangaDetails.pages,
        referer: mangaDetails.referer,
      };
    }
    case 'weebverse2': {
      const searchResult = await searchWeebverse2(name, 1);
      const mangaDetails = await fetchInfoWeebverse2(searchResult[0].slug);
      return {
        mangaSlug: searchResult[0].slug,
        mangaTitle: searchResult[0].name,
        chapters: mangaDetails.pages,
        referer: mangaDetails.referer,
      };
    }
    default:
      throw new Error('Unsupported source');
  }
}

async function getChapterImages(chapterInfo, source, referer, mangaTitle, chapterNum, baseUrl) {
  switch (source) {
    case 'mangadex': {
      const data = await axios.get(`https://api.mangadex.org/at-home/server/${chapterInfo.id}`);
      const baseUrl = data.data.baseUrl;
      const chapterHash = data.data.chapter.hash;
      return data.data.chapter.data.map(page => `${baseUrl}/data/${chapterHash}/${page}`);
    }
    case 'mangazero': {
      const images = await downloadChapterMangazero(chapterInfo.url, referer, mangaTitle, chapterNum, baseUrl);
      return images.map(img => img.localPath);
    }
    case 'weebverse': {
      return await downloadChapterWeebverse(chapterInfo.mangaSlug, chapterNum);
    }
    case 'weebverse2': {
    	return await downloadChapterWeebverse2(chapterInfo.mangaSlug, chapterNum);
    }
    default:
      throw new Error('Unsupported source');
  }
}

function parseChapterRange(range) {
  const parts = range.split('-').map(part => parseFloat(part.trim()));
  if (parts.length === 1) {
    // Single chapter (e.g., "3.5")
    if (isNaN(parts[0])) {
      throw new Error('Invalid chapter number');
    }
    return [parts[0]];
  } else if (parts.length === 2) {
    // Range (e.g., "1-3.5")
    const [start, end] = parts;
    if (isNaN(start) || isNaN(end) || start > end) {
      throw new Error('Invalid chapter range format');
    }
    const result = [];
    for (let i = start; i <= end; i += 0.5) {
      result.push(Number(i.toFixed(1)));
    }
    return result;
  } else {
    throw new Error('Invalid chapter range format');
  }
             }

app.get('/manga', async (req, res) => {
  const { name, chapters, source = 'weebverse', quality = 'high', language = 'en' } = req.query;

  if (!name || !chapters) {
    return res.status(400).json({ error: 'Missing name or chapters parameter' });
  }

  try {
    const baseUrl = getBaseUrl(req);
    const mangaInfo = await getMangaInfo(name, source, language);
    const chapterList = parseChapterRange(chapters);

    const mangaData = {
      manga: mangaInfo.mangaTitle,
      source,
      quality,
      chapters: [],
    };

    for (const chapterNum of chapterList) {
      let chapterInfo;

      if (source === 'mangadex') {
        const chapterResponse = await axios.get('https://api.mangadex.org/chapter', {
          params: {
            manga: mangaInfo.mangaId,
            chapter: chapterNum.toString(),
            translatedLanguage: [language],
            limit: 5,
          },
        });

        if (chapterResponse.data.data.length === 0) {
          console.warn(`Chapter ${chapterNum} not found for ${mangaInfo.mangaTitle}`);
          continue;
        }
        chapterInfo = { id: chapterResponse.data.data[0].id };
      } else if (source === 'mangazero') {
        chapterInfo = {
          url: `${mangaInfo.mangaUrl}/chapter-${chapterNum}`,
        };
      } else if (source === 'weebverse') {
        chapterInfo = {
          mangaSlug: mangaInfo.mangaSlug,
        };
      } else if (source === 'weebverse2') {
        chapterInfo = {
          mangaSlug: mangaInfo.mangaSlug,
        };
      }

      const images = await getChapterImages(chapterInfo, source, mangaInfo.referer, mangaInfo.mangaTitle, chapterNum, baseUrl);
      const filteredImages = quality === 'low' ? images.filter((_, index) => index % 2 === 0) : images;

      mangaData.chapters.push({
        chapter: chapterNum,
        images: filteredImages,
      });
    }

    res.json(mangaData);
  } catch (error) {
    console.error('Error in /manga route:', error);
    res.status(500).json({ error: 'Failed to fetch manga data', message: error.message });
  }
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

fs.mkdir('downloads', { recursive: true }).catch(console.error);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
