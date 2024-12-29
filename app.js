const express = require('express');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

// Fetch manga information from MangaDex
async function fetchMangaDexManga(name) {
  try {
    const response = await axios.get('https://api.mangadex.org/manga', {
      params: {
        title: name,
        limit: 1,
        order: { relevance: 'desc' },
      },
    });

    if (response.data.data.length === 0) {
      throw new Error('Manga not found');
    }

    const manga = response.data.data[0];
    return {
      id: manga.id,
      title: manga.attributes.title.en,
    };
  } catch (error) {
    console.error('Error fetching MangaDex manga:', error.message);
    throw error;
  }
}

// Fetch chapters for a manga from MangaDex
async function fetchMangaDexChapters(mangaId) {
  try {
    const response = await axios.get(`https://api.mangadex.org/manga/${mangaId}/feed`, {
      params: {
        translatedLanguage: ['en'],
        order: { chapter: 'asc' },
      },
    });

    return response.data.data.map((chapter) => ({
      id: chapter.id,
      chapterNumber: chapter.attributes.chapter,
      title: chapter.attributes.title,
    }));
  } catch (error) {
    console.error('Error fetching MangaDex chapters:', error.message);
    throw error;
  }
}

// Fetch chapter images from MangaDex
async function fetchMangaDexChapterImages(chapterId) {
  try {
    const response = await axios.get(`https://api.mangadex.org/at-home/server/${chapterId}`);
    const { baseUrl, chapter } = response.data;

    return chapter.data.map((page) => `${baseUrl}/data/${chapter.hash}/${page}`);
  } catch (error) {
    console.error('Error fetching MangaDex chapter images:', error.message);
    throw error;
  }
}

app.get('/readmanga', async (req, res) => {
  const { name } = req.query;

  if (!name) {
    return res.status(400).json({ error: 'Missing name parameter' });
  }

  try {
    const manga = await fetchMangaDexManga(name);
    const chapters = await fetchMangaDexChapters(manga.id);

    const mangaData = {
      title: manga.title,
      chapters: [],
    };

    for (const chapter of chapters) {
      const images = await fetchMangaDexChapterImages(chapter.id);
      mangaData.chapters.push({
        chapterNumber: chapter.chapterNumber,
        title: chapter.title,
        images,
      });
    }

    res.json(mangaData);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch manga', message: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
