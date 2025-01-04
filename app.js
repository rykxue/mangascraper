const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const port = process.env.PORT || 10001;

// Utility function to handle HTTP requests with retries
async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios(url, options);
      return response.data;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(res => setTimeout(res, 1000 * Math.pow(2, i))); // Exponential backoff
    }
  }
}

async function searchMangaManganelo(input, numOfSearch) {
  const url = `https://mangakakalot.com/search/story/${encodeURIComponent(input.replace(/ /g, '_'))}`;
  const data = await fetchWithRetry(url);
  const $ = cheerio.load(data);

  const results = [];
  $('.story_item').each((i, el) => {
    if (i >= numOfSearch) return false;
    const $el = $(el);
    const updated = $el.find('.story_item_right').text().match(/Updated : (.*)/);
    results.push({
      name: $el.find('.story_name a').text().trim(),
      url: $el.find('.story_name a').attr('href'),
      referer: $el.find('.story_name a').attr('href'),
      latest: $el.find('.story_chapter a').attr('title'),
      updated: updated ? updated[1] : 'Unknown',
    });
  });

  if (results.length === 0) {
    throw new Error('No manga found');
  }

  return results;
}

async function fetchMangaDetailsManganelo(url) {
  const data = await fetchWithRetry(url);
  const $ = cheerio.load(data);

  const pages = [];
  $('.chapter-list .row').each((_, el) => {
    const chapterUrl = $(el).find('a').attr('href');
    const chapterMatch = chapterUrl.match(/chapter-(\d+(?:\.\d+)?)/);
    if (chapterMatch) {
      pages.push(chapterMatch[1]);
    }
  });

  return {
    pages: pages.reverse(),
  };
}

async function downloadChapterManganelo(url, referer, mangaTitle, chapterNum) {
  const data = await fetchWithRetry(url, { headers: { Referer: referer } });
  const $ = cheerio.load(data);

  const images = [];
  $('.container-chapter-reader img').each((_, el) => {
    const src = $(el).attr('src');
    if (src) images.push(src);
  });

  const chapterFolder = path.join('downloads', mangaTitle, `chapter-${chapterNum}`);
  await fs.mkdir(chapterFolder, { recursive: true });

  const downloadedImages = await Promise.all(images.map(async (imageUrl, index) => {
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      headers: { Referer: referer }
    });
    const extension = path.extname(imageUrl);
    const filename = `page-${index + 1}${extension}`;
    const filePath = path.join(chapterFolder, filename);
    await fs.writeFile(filePath, imageResponse.data);
    return {
      originalUrl: imageUrl,
      localPath: filePath
    };
  }));

  return downloadedImages;
}

async function getMangaInfo(name, source = 'mangadex', language = 'en') {
  switch (source) {
    case 'mangadex': {
      const searchResponse = await fetchWithRetry('https://api.mangadex.org/manga', {
        params: {
          title: name,
          limit: 1,
          order: { relevance: 'desc' },
        },
      });

      if (searchResponse.data.length === 0) {
        throw new Error('Manga not found');
      }

      return {
        mangaId: searchResponse.data[0].id,
        mangaTitle: searchResponse.data[0].attributes.title.en || name,
        language,
      };
    }
    case 'mangazero': {
      const searchResult = await searchMangaManganelo(name, 1);
      const mangaDetails = await fetchMangaDetailsManganelo(searchResult[0].url);
      return {
        mangaUrl: searchResult[0].url,
        mangaTitle: searchResult[0].name,
        chapters: mangaDetails.pages,
        referer: searchResult[0].referer,
      };
    }
    default:
      throw new Error('Unsupported source');
  }
}

async function getChapterImages(chapterInfo, source, referer, mangaTitle, chapterNum) {
  switch (source) {
    case 'mangadex': {
      const data = await fetchWithRetry(`https://api.mangadex.org/at-home/server/${chapterInfo.id}`);
      const baseUrl = data.baseUrl;
      const chapterHash = data.chapter.hash;
      return data.chapter.data.map(page => ({
        originalUrl: `${baseUrl}/data/${chapterHash}/${page}`,
        localPath: null
      }));
    }
    case 'mangazero': {
      return await downloadChapterManganelo(chapterInfo.url, referer, mangaTitle, chapterNum);
    }
    default:
      throw new Error('Unsupported source');
  }
}

function parseChapterRange(range) {
  const parts = range.split('-').map(part => parseFloat(part.trim()));
  if (parts.length === 1) {
    return [parts[0]];
  } else if (parts.length === 2) {
    const [start, end] = parts;
    if (isNaN(start) || isNaN(end) || start > end) {
      throw new Error('Invalid chapter range format');
    }
    return Array.from({ length: Math.floor(end - start + 1) }, (_, i) => start + i);
  } else {
    throw new Error('Invalid chapter range format');
  }
}

app.get('/manga', async (req, res) => {
  const { name, chapters, source = 'mangadex', quality = 'high', language = 'en' } = req.query;

  if (!name || !chapters) {
    return res.status(400).json({ error: 'Missing name or chapters parameter' });
  }

  try {
    const mangaInfo = await getMangaInfo(name, source, language);
    const chapterList = parseChapterRange(chapters);

    const mangaData = {
      mangaTitle: mangaInfo.mangaTitle,
      source,
      quality,
      language,
      chapters: [],
    };

    for (const chapterNum of chapterList) {
      let chapterInfo;

      if (source === 'mangadex') {
        const chapterResponse = await fetchWithRetry('https://api.mangadex.org/chapter', {
          params: {
            manga: mangaInfo.mangaId,
            chapter: chapterNum.toString(),
            translatedLanguage: [language],
            limit: 1,
          },
        });

        if (chapterResponse.data.length === 0) {
          console.warn(`Chapter ${chapterNum} not found for ${mangaInfo.mangaTitle}`);
          continue;
        }
        chapterInfo = { id: chapterResponse.data[0].id };
      } else {
        chapterInfo = {
          url: `${mangaInfo.mangaUrl}/chapter-${chapterNum}`,
        };
      }

      const images = await getChapterImages(chapterInfo, source, mangaInfo.referer, mangaInfo.mangaTitle, chapterNum);
      const filteredImages = quality === 'low' ? images.filter((_, index) => index % 2 === 0) : images;

      mangaData.chapters.push({
        chapterNumber: chapterNum,
        images: filteredImages,
      });
    }

    res.json(mangaData);
  } catch (error) {
    console.error('Error in /manga route:', error);
    res.status(500).json({ error: 'Failed to fetch manga data', message: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
