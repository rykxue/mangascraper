const express = require("express")
const axios = require("axios")
const cheerio = require("cheerio")
const fs = require("fs").promises
const path = require("path")
const rateLimit = require("express-rate-limit")
const compression = require("compression")
const levenshtein = require("fast-levenshtein")

const app = express()
const port = process.env.PORT || 10001

// Enable gzip compression
app.use(compression())

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
})
app.use(limiter)

// Serve static files from the downloads directory with custom headers
app.use(
  "/images",
  (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin")
    next()
  },
  express.static("downloads"),
)

// Utility function to handle HTTP requests with retries
async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios(url, options)
      return response.data
    } catch (error) {
      if (i === retries - 1) throw error
      await new Promise((res) => setTimeout(res, 1000 * Math.pow(2, i))) // Exponential backoff
    }
  }
}

// Get the base URL for the server
function getBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}`
}

async function searchMangaReader(input, numOfSearch) {
  const url = `https://mangareader.to/search?keyword=${encodeURIComponent(input)}`
  const { data } = await axios.get(url)
  const $ = cheerio.load(data)

  const results = []
  $(".manga-item").each((i, el) => {
    if (i >= numOfSearch) return false
    const $el = $(el)
    results.push({
      name: $el.find(".manga-name").text().trim(),
      url: "https://mangareader.to" + $el.find("a").attr("href"),
      latest: $el.find(".fd-infor .fdi-item").first().text().trim(),
      updated: $el.find(".fd-infor .fdi-item").last().text().trim(),
    })
  })

  if (results.length === 0) {
    throw new Error("No manga found")
  }

  return results
}

async function fetchMangaReaderDetails(url) {
  const { data } = await axios.get(url)
  const $ = cheerio.load(data)

  const chapters = []
  $(".chapter-list .chapter-item").each((_, el) => {
    const $el = $(el)
    const chapterUrl = "https://mangareader.to" + $el.find("a").attr("href")
    const chapterMatch = chapterUrl.match(/chapter-(\d+(?:\.\d+)?)/)
    if (chapterMatch) {
      chapters.push(chapterMatch[1])
    }
  })

  return {
    chapters: chapters.reverse(),
    referer: "https://mangareader.to",
  }
}

async function downloadMangaReaderChapter(url, mangaTitle, chapterNum, baseUrl) {
  const { data } = await axios.get(url)
  const $ = cheerio.load(data)

  const images = []
  $(".chapter-content img").each((_, el) => {
    const src = $(el).attr("data-src") || $(el).attr("src")
    if (src) images.push(src)
  })

  // Sanitize manga title for file system
  const safeMangaTitle = mangaTitle.replace(/[^a-z0-9]/gi, "_").toLowerCase()
  const chapterFolder = path.join("downloads", safeMangaTitle, `chapter-${chapterNum}`)
  await fs.mkdir(chapterFolder, { recursive: true })

  const downloadedImages = await Promise.all(
    images.map(async (imageUrl, index) => {
      const imageResponse = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        headers: { Referer: "https://mangareader.to" },
      })
      const extension = path.extname(imageUrl) || ".jpg" // Fallback to .jpg if no extension
      const filename = `page-${(index + 1).toString().padStart(3, "0")}${extension}`
      const filePath = path.join(chapterFolder, filename)
      await fs.writeFile(filePath, imageResponse.data)

      // Generate web-accessible URL for the downloaded image
      const relativePath = path.join(safeMangaTitle, `chapter-${chapterNum}`, filename).replace(/\\/g, "/")
      return `${baseUrl}/images/${relativePath}`
    }),
  )

  return downloadedImages
}

async function searchWeebverseThree(input, numOfSearch) {
  const url = `https://mangakakalot.com/search/story/${encodeURIComponent(input.replace(/ /g, "_"))}`
  const data = await fetchWithRetry(url)
  const $ = cheerio.load(data)

  const results = []
  $(".story_item").each((i, el) => {
    if (i >= numOfSearch) return false
    const $el = $(el)
    const updated = $el
      .find(".story_item_right")
      .text()
      .match(/Updated : (.*)/)
    results.push({
      name: $el.find(".story_name a").text().trim(),
      url: $el.find(".story_name a").attr("href"),
      referer: $el.find(".story_name a").attr("href"),
      latest: $el.find(".story_chapter a").attr("title"),
      updated: updated ? updated[1] : "Unknown",
    })
  })

  if (results.length === 0) {
    throw new Error("No manga found")
  }

  return results
}

async function fetchWeebverseThreeDetails(url) {
  const data = await fetchWithRetry(url)
  const $ = cheerio.load(data)

  const pages = []
  $(".chapter-list .row").each((_, el) => {
    const chapterUrl = $(el).find("a").attr("href")
    const chapterMatch = chapterUrl ? chapterUrl.match(/chapter-(\d+(?:\.\d+)?)/) : null
    if (chapterMatch) {
      pages.push(chapterMatch[1])
    }
  })

  return {
    pages: pages.reverse(),
  }
}

async function downloadWeebverseThreeChapter(url, referer, mangaTitle, chapterNum, baseUrl) {
  const data = await fetchWithRetry(url, { headers: { Referer: referer } })
  const $ = cheerio.load(data)

  const images = []
  $(".container-chapter-reader img").each((_, el) => {
    const src = $(el).attr("src")
    if (src) images.push(src)
  })

  // Sanitize manga title for file system
  const safeMangaTitle = mangaTitle.replace(/[^a-z0-9]/gi, "_").toLowerCase()
  const chapterFolder = path.join("downloads", safeMangaTitle, `chapter-${chapterNum}`)
  await fs.mkdir(chapterFolder, { recursive: true })

  const downloadedImages = await Promise.all(
    images.map(async (imageUrl, index) => {
      const imageResponse = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        headers: { Referer: referer },
      })
      const extension = path.extname(imageUrl) || ".jpg" // Fallback to .jpg if no extension
      const filename = `page-${(index + 1).toString().padStart(3, "0")}${extension}`
      const filePath = path.join(chapterFolder, filename)
      await fs.writeFile(filePath, imageResponse.data)

      // Generate web-accessible URL for the downloaded image
      const relativePath = path.join(safeMangaTitle, `chapter-${chapterNum}`, filename).replace(/\\/g, "/")
      return `${baseUrl}/images/${relativePath}`
    }),
  )

  return downloadedImages
}

async function searchWeebverseOne(input, numOfSearch) {
  const url = "https://manga4life.com/search/"
  const { data } = await axios.get(url)
  const $ = cheerio.load(data)

  const scriptContent = $('script:contains("vm.Directory")').html()
  const mangaList = JSON.parse(scriptContent.match(/vm\.Directory = (.*);/)[1])

  const results = mangaList
    .filter((manga) => manga.s.toLowerCase().includes(input.toLowerCase()))
    .slice(0, numOfSearch)
    .map((manga) => ({
      name: manga.s,
      slug: manga.i,
      latest: manga.l,
      status: manga.ss,
      updated: manga.ls,
    }))

  if (results.length === 0) {
    throw new Error("No manga found")
  }

  return results
}

async function fetchWeebverseOneDetails(slug) {
  const url = `https://manga4life.com/manga/${slug}`
  const { data } = await axios.get(url)
  const $ = cheerio.load(data)

  const scriptContent = $('script:contains("vm.Chapters")').html()
  const chaptersData = JSON.parse(scriptContent.match(/vm\.Chapters = (.*);/)[1])

  const pages = chaptersData
    .map((chapter) => {
      const chapterNumber = chapter.Chapter.slice(1, -1)
      return Number.parseFloat(chapterNumber) || Number.parseInt(chapterNumber)
    })
    .sort((a, b) => b - a)

  return {
    pages,
    referer: "manga4life.com",
  }
}

async function downloadWeebverseOneChapter(slug, chapter) {
  const url = `https://manga4life.com/read-online/${slug}-chapter-${chapter}-index-1.html`
  const { data } = await axios.get(url)
  const $ = cheerio.load(data)

  const scriptContent = $('script:contains("vm.CurChapter")').html()
  const chapterData = JSON.parse(scriptContent.match(/vm\.CurChapter = (.*);/)[1])
  const scriptContent_ = $('script:contains("vm.CurPathName")').html()
  const chapterPath = scriptContent_.match(/vm\.CurPathName = "(.*)";/)[1]

  const directory = chapterData.Directory !== "" ? `/${chapterData.Directory}` : ""
  const domainName = chapterPath
  const chNumber = chapterData.Chapter.slice(1, -1).padStart(4, "0")
  const totalPages = Number.parseInt(chapterData.Page)

  const images = []
  for (let i = 1; i <= totalPages; i++) {
    const pageNumber = i.toString().padStart(3, "0")
    images.push(`https://${domainName}/manga/${slug}${directory}/${chNumber}-${pageNumber}.png`)
  }

  return images
}

async function getWeebverseInfo(title, source, language = "en") {
  switch (source) {
    case "2": {
      const searchResponse = await fetchWithRetry("https://api.mangadex.org/manga", {
        params: {
          title: title,
          limit: 1,
          order: { relevance: "desc" },
        },
      })

      if (searchResponse.data.length === 0) {
        throw new Error("Manga not found")
      }

      return {
        mangaId: searchResponse.data[0].id,
        mangaTitle: searchResponse.data[0].attributes.title.en || title,
        language,
      }
    }
    case "3": {
      const searchResult = await searchWeebverseThree(title, 1)
      const mangaDetails = await fetchWeebverseThreeDetails(searchResult[0].url)
      return {
        mangaUrl: searchResult[0].url,
        mangaTitle: searchResult[0].name,
        chapters: mangaDetails.pages,
        referer: searchResult[0].referer,
      }
    }
    case "4": {
      const searchResult = await searchWeebverseOne(title, 1)
      const mangaDetails = await fetchWeebverseOneDetails(searchResult[0].slug)
      return {
        mangaSlug: searchResult[0].slug,
        mangaTitle: searchResult[0].name,
        chapters: mangaDetails.pages,
        referer: mangaDetails.referer,
      }
    }
    case "1":
    default: {
      const searchResult = await searchMangaReader(title, 1)
      const mangaDetails = await fetchMangaReaderDetails(searchResult[0].url)
      return {
        mangaUrl: searchResult[0].url,
        mangaTitle: searchResult[0].name,
        chapters: mangaDetails.chapters,
        referer: mangaDetails.referer,
      }
    }
  }
}

async function getWeebverseChapterImages(chapterInfo, source, referer, mangaTitle, chapterNum, baseUrl) {
  switch (source) {
    case "2": {
      const data = await fetchWithRetry(`https://api.mangadex.org/at-home/server/${chapterInfo.id}`)
      const baseUrl = data.baseUrl
      const chapterHash = data.chapter.hash
      return data.chapter.data.map((page) => `${baseUrl}/data/${chapterHash}/${page}`)
    }
    case "3": {
      return await downloadWeebverseThreeChapter(chapterInfo.url, referer, mangaTitle, chapterNum, baseUrl)
    }
    case "4": {
      return await downloadWeebverseOneChapter(chapterInfo.mangaSlug, chapterNum)
    }
    case "1":
    default: {
      return await downloadMangaReaderChapter(chapterInfo.url, mangaTitle, chapterNum, baseUrl)
    }
  }
}

function parseChapterRange(range, availableChapters) {
  const parts = range.split("-").map((part) => Number.parseFloat(part.trim()))
  let start, end

  if (parts.length === 1) {
    start = end = parts[0]
  } else if (parts.length === 2) {
    ;[start, end] = parts
    if (isNaN(start) || isNaN(end) || start > end) {
      throw new Error("Invalid chapter range format")
    }
  } else {
    throw new Error("Invalid chapter range format")
  }

  // Ensure start and end are within available chapters
  start = Math.max(start, Math.min(...availableChapters))
  end = Math.min(end, Math.max(...availableChapters))

  // Limit the range to 10 chapters maximum
  end = Math.min(end, start + 9)

  return availableChapters.filter((chapter) => chapter >= start && chapter <= end)
}

function findClosestMatch(input, titles) {
  let closestMatch = titles[0]
  let minDistance = Number.POSITIVE_INFINITY

  for (const title of titles) {
    const distance = levenshtein.get(input.toLowerCase(), title.toLowerCase())
    if (distance < minDistance) {
      minDistance = distance
      closestMatch = title
    }
  }

  return closestMatch
}

app.get("/manga", async (req, res) => {
  const { title, chapter, source = "1", quality = "high" } = req.query

  if (!title || !chapter) {
    return res.status(400).json({ error: "Missing title or chapter parameter" })
  }

  try {
    const baseUrl = getBaseUrl(req)
    const mangaInfo = await getWeebverseInfo(title, source)

    // Find the closest match for the manga title
    const closestTitle = findClosestMatch(title, [mangaInfo.mangaTitle])

    const availableChapters = source === "2" ? [] : mangaInfo.chapters.map(Number)
    const chapterList = parseChapterRange(chapter, availableChapters)

    const mangaData = {
      manga: closestTitle,
      source,
      chapters: [],
    }

    for (const chapterNum of chapterList) {
      let chapterInfo

      if (source === "2") {
        const chapterResponse = await fetchWithRetry("https://api.mangadex.org/chapter", {
          params: {
            manga: mangaInfo.mangaId,
            chapter: chapterNum.toString(),
            translatedLanguage: [mangaInfo.language],
            limit: 1,
          },
        })

        if (chapterResponse.data.length === 0) {
          console.warn(`Chapter ${chapterNum} not found for ${closestTitle}`)
          continue
        }
        chapterInfo = { id: chapterResponse.data[0].id }
      } else if (source === "3") {
        chapterInfo = {
          url: `${mangaInfo.mangaUrl}/chapter-${chapterNum}`,
        }
      } else if (source === "4") {
        chapterInfo = {
          mangaSlug: mangaInfo.mangaSlug,
        }
      } else {
        chapterInfo = {
          url: `${mangaInfo.mangaUrl}/chapter-${chapterNum}`,
        }
      }

      const images = await getWeebverseChapterImages(
        chapterInfo,
        source,
        mangaInfo.referer,
        closestTitle,
        chapterNum,
        baseUrl,
      )
      const filteredImages = quality === "low" ? images.filter((_, index) => index % 2 === 0) : images

      mangaData.chapters.push({
        chapter: chapterNum,
        images: filteredImages,
      })
    }

    res.json(mangaData)
  } catch (error) {
    console.error("Error in /manga route:", error)
    res.status(500).json({ error: "Failed to fetch manga data", message: error.message })
  }
})

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err)
  res.status(500).json({ error: "Internal server error", message: err.message })
})

// Create downloads directory if it doesn't exist
fs.mkdir(path.join(__dirname, "downloads"), { recursive: true }).catch(console.error)

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})
