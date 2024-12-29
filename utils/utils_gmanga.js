const axios = require('axios');
const crypto = require('crypto');

async function searchMangaGmanga(input, numOfSearch) {
  const url = 'https://gmanga.org/api/quick_search';
  const postData = {
    query: input,
    includes: ['Manga']
  };

  const { data } = await axios.post(url, postData, {
    headers: {
      'Content-Type': 'application/json',
      'Referer': 'gmanga.org'
    }
  });

  if (data[0].data.length === 0) {
    throw new Error('No manga found');
  }

  return data[0].data.slice(0, numOfSearch).map(manga => ({
    name: manga.title,
    slug: manga.id,
    latest: manga.latest_chapter,
    status: manga.story_status === 2 ? 'Ongoing' : manga.story_status === 3 ? 'Completed' : 'Unknown',
    url: `https://gmanga.org/mangas/${manga.id}`
  }));
}

async function fetchMangaDetailsGmanga(slug) {
  const url = `https://gmanga.org/api/mangas/${slug}/releases`;
  const { data } = await axios.get(url);

  const decryptedData = decryptGmangaData(data.data);
  const pages = JSON.parse(decryptedData).rows[2].rows.map(row => row[1]).sort((a, b) => b - a);

  return {
    pages,
    referer: 'gmanga.org'
  };
}

function decryptGmangaData(encryptedData) {
  const [data, iv, key] = encryptedData.split('|');
  const decipher = crypto.createDecipheriv('aes-256-cbc', crypto.createHash('sha256').update(key).digest(), Buffer.from(iv, 'base64'));
  let decrypted = decipher.update(data, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function downloadChapterGmanga(slug, page) {
  const url = `https://gmanga.org/mangas/${slug}/${page}/`;
  const { data } = await axios.get(url);

  const $ = cheerio.load(data);
  const readerData = JSON.parse($('.js-react-on-rails-component').attr('data-props'));
  const release = readerData.readerDataAction.readerData.release;
  const images = release.webp_pages || release.pages;

  return images.map(img => `https://media.gmanga.org/uploads/releases/${release.storage_key}/mq${release.webp_pages ? '_webp' : ''}/${img}`);
}

module.exports = {
  searchMangaGmanga,
  fetchMangaDetailsGmanga,
  downloadChapterGmanga
};

