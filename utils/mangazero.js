const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');

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

async function searchMangazero(input, numOfSearch) {
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

async function fetchInfoMangazero(url) {
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

async function downloadChapterMangazero(url, referer, mangaTitle, chapterNum, baseUrl) {
  const data = await fetchWithRetry(url, { headers: { Referer: referer } });
  const $ = cheerio.load(data);

  const images = [];
  $('.container-chapter-reader img').each((_, el) => {
    const src = $(el).attr('src');
    if (src) images.push(src);
  });

  const safeMangaTitle = mangaTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const chapterFolder = path.join('downloads', safeMangaTitle, `chapter-${chapterNum}`);
  await fs.mkdir(chapterFolder, { recursive: true });

  const downloadedImages = await Promise.all(images.map(async (imageUrl, index) => {
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      headers: { Referer: referer }
    });
    const extension = path.extname(imageUrl) || '.jpg';
    const filename = `page-${(index + 1).toString().padStart(3, '0')}${extension}`;
    const filePath = path.join(chapterFolder, filename);
    await fs.writeFile(filePath, imageResponse.data);

    const relativePath = path.join(safeMangaTitle, `chapter-${chapterNum}`, filename).replace(/\\/g, '/');
    return {
      originalUrl: imageUrl,
      localPath: `${baseUrl}/images/${relativePath}`
    };
  }));

  return downloadedImages;
}

module.exports = {
  searchMangazero,
  fetchInfoMangazero,
  downloadChapterMangazero
};
