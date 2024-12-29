const axios = require('axios');
const cheerio = require('cheerio');

async function searchMangaReadmanhwa(input, numOfSearch) {
  const url = `https://readmanhwa.com/api/comics?nsfw=true&q=${encodeURIComponent(input)}&per_page=${numOfSearch}&sort=title`;
  const { data } = await axios.get(url, {
    headers: {
      'X-NSFW': 'true',
      'Accept-Language': 'en'
    }
  });

  if (data.total === 0) {
    throw new Error('No manga found');
  }

  return data.data.map(manga => ({
    name: manga.title,
    slug: manga.slug,
    latest: manga.uploaded_at,
    status: manga.status,
    url: `https://readmanhwa.com/comics/${manga.slug}`
  }));
}

async function fetchMangaDetailsReadmanhwa(slug) {
  const url = `https://readmanhwa.com/api/comics/${slug}/chapters?nsfw=true`;
  const { data } = await axios.get(url, {
    headers: {
      'X-NSFW': 'true'
    }
  });

  const pages = data.map(chapter => chapter.number).sort((a, b) => b - a);

  return {
    pages,
    referer: 'readmanhwa.com'
  };
}

async function downloadChapterReadmanhwa(slug, page) {
  const url = `https://readmanhwa.com/api/comics/${slug}/chapter-${page}/images?nsfw=true`;
  const { data } = await axios.get(url, {
    headers: {
      'X-NSFW': 'true'
    }
  });

  return data.map(image => image.source_url);
}

module.exports = {
  searchMangaReadmanhwa,
  fetchMangaDetailsReadmanhwa,
  downloadChapterReadmanhwa
};

