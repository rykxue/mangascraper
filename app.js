const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const port = process.env.PORT || 10001;

async function searchMangaManganelo(input, numOfSearch) {
  const url = `https://m.manganelo.com/search/story/${encodeURIComponent(input.replace(/ /g, '_'))}`;
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const results = [];
  $('.story_item').each((i, el) => {
    if (i >= numOfSearch) return false;
    const $el = $(el);
    results.push({
      name: $el.find('.story_name a').text().trim(),
      url: $el.find('.story_name a').attr('href'),
      referer: $el.find('.story_name a').attr('href'), // Extract referer from the chapter URL
      latest: $el.find('.story_chapter a').attr('title'),
      updated: $el.find('.story_item_right').text().match(/Updated : (.*)/)[1],
    });
  });

  if (results.length === 0) {
    throw new Error('No manga found');
  }

  return results;
}

async function fetchMangaDetailsManganelo(url) {
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const pages = [];
  $('.chapter-list .row').each((_, el) => {
    const chapterUrl = $(el).find('a').attr('href');
    const chapterNum = chapterUrl.match(/chapter-(\d+(?:\.\d+)?)/)[1];
    pages.push(chapterNum);
  });

  return {
    pages: pages.reverse(),
  };
}

async function downloadChapterManganelo(url, referer) {
  const { data } = await axios.get(url, { headers: { Referer: referer } });
  const $ = cheerio.load(data);

  const images = [];
  $('.container-chapter-reader img').each((_, el) => {
    images.push($(el).attr('src'));
  });

  return images;
}

async function getMangaInfo(name, source = 'mangadex') {
  switch (source) {
    case 'mangadex': {
      const searchResponse = await axios.get(`https://api.mangadex.org/manga`, {
        params: {
          title: name,
          limit: 1,
          order: { relevance: 'desc' },
        },
      });

      if (searchResponse.data.data.length === 0) {
        throw new Error('Manga not found');
      }

      return {
        mangaId: searchResponse.data.data[0].id,
        mangaTitle: searchResponse.data.data[0].attributes.title.en,
      };
    }
    case 'mangazero': {
      const searchResult = await searchMangaManganelo(name, 1);
      const mangaDetails = await fetchMangaDetailsManganelo(searchResult[0].url);
      return {
        mangaUrl: searchResult[0].url,
        mangaTitle: searchResult[0].name,
        chapters: mangaDetails.pages,
        referer: searchResult[0].referer, // Pass referer for future use
      };
    }
    default:
      throw new Error('Unsupported source');
  }
}

async function getChapterImages(chapterInfo, source, referer) {
  switch (source) {
    case 'mangadex': {
      const { data } = await axios.get(`https://api.mangadex.org/at-home/server/${chapterInfo.id}`);
      const baseUrl = data.baseUrl;
      const chapterHash = data.chapter.hash;
      return data.chapter.data.map(page => `${baseUrl}/data/${chapterHash}/${page}`);
    }
    case 'mangazero': {
      return await downloadChapterManganelo(chapterInfo.url, referer);
    }
    default:
      throw new Error('Unsupported source');
  }
}

function parseChapterRange(range) {
  const parts = range.split('-');
  if (parts.length === 1) {
    return [parseInt(parts[0], 10)];
  } else if (parts.length === 2) {
    const start = parseInt(parts[0], 10);
    const end = parseInt(parts[1], 10);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  } else {
    throw new Error('Invalid chapter range format');
  }
}

app.get('/manga', async (req, res) => {
  const { name, chapters, source = 'mangadex', quality = 'high' } = req.query;

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
      chapters: [],
    };

    for (const chapterNum of chapterList) {
      let chapterInfo;

      if (source === 'mangadex') {
        const chapterResponse = await axios.get(`https://api.mangadex.org/chapter`, {
          params: {
            manga: mangaInfo.mangaId,
            chapter: chapterNum.toString(),
            translatedLanguage: ['en'],
            limit: 1,
          },
        });

        if (chapterResponse.data.data.length === 0) {
          console.warn(`Chapter ${chapterNum} not found for ${mangaInfo.mangaTitle}`);
          continue;
        }
        chapterInfo = { id: chapterResponse.data.data[0].id };
      } else {
        chapterInfo = {
          url: `${mangaInfo.mangaUrl}/chapter-${chapterNum}`,
        };
      }

      const images = await getChapterImages(chapterInfo, source, mangaInfo.referer);
      const filteredImages = quality === 'low' ? images.filter((_, index) => index % 2 === 0) : images;

      mangaData.chapters.push({
        chapterNumber: chapterNum,
        images: filteredImages,
      });
    }

    res.json(mangaData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch manga data', message: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
