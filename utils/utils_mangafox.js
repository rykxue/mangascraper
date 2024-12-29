const axios = require('axios');
const cheerio = require('cheerio');

async function searchMangaMangafox(input, numOfSearch) {
  const url = `http://m.fanfox.net/search?k=${encodeURIComponent(input)}`;
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const results = [];
  $('.post-one.clearfix').each((i, el) => {
    if (i >= numOfSearch) return false;
    const $el = $(el);
    results.push({
      name: $el.find('.title').text().trim(),
      url: $el.find('a').attr('href'),
      status: $el.find('.status').text().trim(),
      genre: $el.find('p').first().text().trim()
    });
  });

  if (results.length === 0) {
    throw new Error('No manga found');
  }

  return results;
}

async function fetchMangaDetailsMangafox(slug) {
  const url = `http://m.fanfox.net/manga/${slug}`;
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const pages = [];
  $('a[href*="/manga/"]').each((_, el) => {
    const href = $(el).attr('href');
    const match = href.match(/c(\d+(?:\.\d+)?)/);
    if (match) {
      pages.push(parseFloat(match[1]));
    }
  });

  return {
    pages: pages.sort((a, b) => b - a),
    referer: 'fanfox.net'
  };
}

async function downloadChapterMangafox(slug, chapter) {
  const url = `http://m.fanfox.net/roll_manga/${slug}/c${chapter.toString().padStart(3, '0')}/1.html`;
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const images = [];
  $('img.reader-main-img').each((_, el) => {
    const imgUrl = $(el).attr('data-src');
    if (imgUrl) images.push(imgUrl);
  });

  return images;
}

module.exports = {
  searchMangaMangafox,
  fetchMangaDetailsMangafox,
  downloadChapterMangafox
};

