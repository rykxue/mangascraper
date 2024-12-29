const axios = require('axios');
const cheerio = require('cheerio');

// Utility function to encode URLs properly
const urlEncode = (str) => encodeURIComponent(str).replace(/%20/g, '+');

// Utility function to fetch HTML content
async function fetchHTML(url, headers = {}) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        ...headers
      }
    });
    return cheerio.load(response.data);
  } catch (error) {
    console.error(`Error fetching ${url}:`, error.message);
    throw error;
  }
}

// Utility function to download images
async function downloadImages(imageUrls, referer) {
  const images = [];
  for (const url of imageUrls) {
    try {
      const response = await axios.get(url, {
        headers: {
          Referer: referer,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        responseType: 'arraybuffer'
      });
      images.push({
        url,
        data: response.data,
        contentType: response.headers['content-type']
      });
    } catch (error) {
      console.error(`Error downloading ${url}:`, error.message);
    }
  }
  return images;
}

// Parse chapter range (e.g., "1-5" or "1,2,3")
function parseChapterRange(range) {
  if (!range) return [];
  
  const chapters = [];
  const parts = range.split(',');
  
  for (const part of parts) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      for (let i = start; i <= end; i++) {
        chapters.push(i);
      }
    } else {
      chapters.push(Number(part));
    }
  }
  
  return [...new Set(chapters)].sort((a, b) => a - b);
}

module.exports = {
  urlEncode,
  fetchHTML,
  downloadImages,
  parseChapterRange
};

