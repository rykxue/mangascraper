const axios = require('axios');
const cheerio = require('cheerio');

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
    referer: 'mangakakalot.com'
  };
}

async function downloadChapterManganelo(url) {
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const images = [];
  $('.container-chapter-reader img').each((_, el) => {
    images.push($(el).attr('src'));
  });

  return images;
}

module.exports = {
  searchMangaManganelo,
  fetchMangaDetailsManganelo,
  downloadChapterManganelo
};

