const axios = require('axios');
const cheerio = require('cheerio');

async function searchWeebverse(input, numOfSearch) {
  const url = 'https://manga4life.com/search/';
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const scriptContent = $('script:contains("vm.Directory")').html();
  const mangaList = JSON.parse(scriptContent.match(/vm\.Directory = (.*);/)[1]);

  const results = mangaList
    .filter(manga => manga.s.toLowerCase().includes(input.toLowerCase()))
    .slice(0, numOfSearch)
    .map(manga => ({
      name: manga.s,
      slug: manga.i,
      latest: manga.l,
      status: manga.ss,
      updated: manga.ls
    }));

  if (results.length === 0) {
    throw new Error('No manga found');
  }

  return results;
}

async function fetchInfoWeebverse(slug) {
  const url = `https://manga4life.com/manga/${slug}`;
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const scriptContent = $('script:contains("vm.Chapters")').html();
  const chaptersData = JSON.parse(scriptContent.match(/vm\.Chapters = (.*);/)[1]);

  const pages = chaptersData.map(chapter => {
    const chapterNumber = chapter.Chapter.slice(1, -1);
    return parseFloat(chapterNumber) || parseInt(chapterNumber);
  }).sort((a, b) => b - a);

  return {
    pages,
    referer: 'manga4life.com'
  };
}

async function downloadChapterWeebverse(slug, chapter) {
  const url = `https://manga4life.com/read-online/${slug}-chapter-${chapter}-index-1.html`;
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const scriptContent = $('script:contains("vm.CurChapter")').html();
  const chapterData = JSON.parse(scriptContent.match(/vm\.CurChapter = (.*);/)[1]);

  const directory = chapterData.Directory !== '' ? `/${chapterData.Directory}` : '';
  const chNumber = chapterData.Chapter.slice(1, -1).padStart(4, '0');
  const totalPages = parseInt(chapterData.Page);

  const images = [];
  for (let i = 1; i <= totalPages; i++) {
    const pageNumber = i.toString().padStart(3, '0');
    images.push(`https://hot.planeptune.us/manga/${slug}${directory}/${chNumber}-${pageNumber}.png`);
  }

  return images;
}

module.exports = {
  searchWeebverse,
  fetchInfoWeebverse,
  downloadChapterWeebverse
};
