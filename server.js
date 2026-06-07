import express from "express";
import Parser from "rss-parser";
import * as cheerio from "cheerio";
import { fileURLToPath, pathToFileURL } from "url";
import { join } from "path";

const app = express();
const ROOT_DIR = fileURLToPath(new URL(".", import.meta.url));
const parser = new Parser({
  timeout: 12000,
  headers: {
    "User-Agent": "RSS Yo/1.0 (+local personal reader)"
  },
  customFields: {
    feed: ["image", "link"],
    item: [
      ["media:content", "mediaContent"],
      ["media:thumbnail", "mediaThumbnail"],
      ["itunes:image", "itunesImage"]
    ]
  }
});

const PORT = process.env.PORT || 5173;
const COMMON_FEED_PATHS = ["/feed", "/rss", "/rss.xml", "/atom.xml", "/feed.xml"];
const ARTICLE_IMAGE_LOOKUP_LIMIT = 24;
const ARTICLE_IMAGE_LOOKUP_CONCURRENCY = 4;
const ARTICLE_IMAGE_LOOKUP_TIMEOUT = 4500;
const LOGO_IMAGE_HINTS = /(avatar|brand|default|favicon|icon|logo|placeholder|site-logo|social-share|uh-logo|unboxholics)/i;
const ARTICLE_HINTS = [
  /\/\d{4}\/\d{1,2}\//,
  /\/\d{4}-\d{1,2}-\d{1,2}/,
  /\/(post|posts|article|articles|blog|news|story|stories)\//i
];
const SKIP_HINTS = /(about|account|advertis|archive|author|cart|category|comment|contact|cookie|feed|footer|help|login|logout|menu|privacy|profile|search|share|shop|signin|signup|tag|terms)/i;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(ROOT_DIR, "public")));

app.get("/api/discover", async (req, res) => {
  const targetUrl = normalizeInputUrl(req.query.url);

  if (!targetUrl) {
    res.status(400).json({ error: "A valid URL is required." });
    return;
  }

  try {
    const discovered = await discoverSource(targetUrl);
    res.json(discovered);
  } catch (error) {
    res.status(502).json({
      error: "Could not read this site.",
      detail: error.message
    });
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(PORT, () => {
    console.log(`RSS Yo is running at http://localhost:${PORT}`);
  });
}

async function discoverSource(inputUrl) {
  const directFeed = await tryParseFeed(inputUrl);
  if (directFeed) {
    return {
      inputUrl,
      siteUrl: directFeed.link || inputUrl,
      mode: "rss",
      feedUrl: inputUrl,
      title: directFeed.title || hostname(inputUrl),
      avatarUrl: directFeed.imageUrl || faviconUrl(directFeed.link || inputUrl),
      posts: directFeed.items
    };
  }

  const homepage = await fetchText(inputUrl);
  const htmlFeeds = findFeedLinks(homepage.text, homepage.finalUrl);
  const candidates = uniqueUrls([
    ...htmlFeeds,
    ...COMMON_FEED_PATHS.map((path) => new URL(path, homepage.finalUrl).toString())
  ]);

  for (const feedUrl of candidates) {
    const feed = await tryParseFeed(feedUrl);
    if (feed) {
      return {
        inputUrl,
        siteUrl: homepage.finalUrl,
        mode: "rss",
        feedUrl,
        title: feed.title || hostname(homepage.finalUrl),
        avatarUrl: feed.imageUrl || findSiteIcon(homepage.text, homepage.finalUrl) || faviconUrl(homepage.finalUrl),
        posts: feed.items
      };
    }
  }

  const scraped = extractArticles(homepage.text, homepage.finalUrl);
  normalizeItemImages(scraped, homepage.finalUrl);
  await enrichMissingItemImages(scraped);
  return {
    inputUrl,
    siteUrl: homepage.finalUrl,
    mode: "scrape",
    feedUrl: null,
    title: pageTitle(homepage.text) || hostname(homepage.finalUrl),
    avatarUrl: findSiteIcon(homepage.text, homepage.finalUrl) || faviconUrl(homepage.finalUrl),
    posts: scraped
  };
}

async function tryParseFeed(feedUrl) {
  try {
    const parsed = await parser.parseURL(feedUrl);
    if (!parsed.items?.length && !parsed.title) return null;

    const items = (parsed.items || []).map((item) => ({
      id: canonicalUrl(item.link || item.guid || feedUrl),
      title: cleanText(item.title) || "Untitled",
      url: canonicalUrl(item.link || item.guid || feedUrl),
      date: normalizeDate(item.isoDate || item.pubDate),
      excerpt: cleanText(item.contentSnippet || item.summary || item.content || ""),
      author: cleanText(item.creator || item.author || ""),
      imageUrl: itemImageUrl(item, feedUrl)
    }));

    normalizeItemImages(items, parsed.link || feedUrl);
    await enrichMissingItemImages(items);

    return {
      title: parsed.title,
      link: parsed.link,
      imageUrl: feedImageUrl(parsed),
      items
    };
  } catch {
    return null;
  }
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 12000);

  let response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "RSS Yo/1.0 (+local personal reader)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }

  const text = await response.text();
  return {
    text,
    finalUrl: response.url || url
  };
}

function findFeedLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const feeds = [];

  $("link[rel~='alternate']").each((_, element) => {
    const type = ($(element).attr("type") || "").toLowerCase();
    const href = $(element).attr("href");
    if (!href) return;
    if (type.includes("rss") || type.includes("atom") || type.includes("xml")) {
      feeds.push(toAbsoluteUrl(href, baseUrl));
    }
  });

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") || "";
    const text = $(element).text();
    if (/rss|atom|feed/i.test(`${href} ${text}`)) {
      feeds.push(toAbsoluteUrl(href, baseUrl));
    }
  });

  return uniqueUrls(feeds.filter(Boolean));
}

function extractArticles(html, baseUrl) {
  const $ = cheerio.load(html);
  const siteName = cleanText($("meta[property='og:site_name']").attr("content") || "");
  const candidates = new Map();

  $("nav, footer, aside, form, script, style, noscript, svg").remove();

  const contexts = $("article, main a[href], [role='main'] a[href], .content a[href], #content a[href], .post a[href], .entry a[href], .article a[href]");

  contexts.each((_, element) => {
    const $element = $(element);
    const link = $element.is("a") ? $element : $element.find("a[href]").first();
    const href = link.attr("href");
    const url = toAbsoluteUrl(href, baseUrl);
    if (!url || !isLikelyArticle(url, baseUrl)) return;

    const title =
      cleanText(link.attr("title")) ||
      cleanText($element.find("h1,h2,h3").first().text()) ||
      cleanText(link.text());

    if (!title || title.length < 4) return;

    const date =
      normalizeDate($element.find("time[datetime]").first().attr("datetime")) ||
      normalizeDate($element.find("time").first().text()) ||
      dateFromUrl(url);

    const excerpt =
      cleanText($element.find("p").first().text()) ||
      cleanText($element.closest("article,li,section,div").find("p").first().text());
    const imageUrl = firstImageUrl($, $element, baseUrl) || firstImageUrl($, $element.closest("article,li,section,div"), baseUrl);

    candidates.set(canonicalUrl(url), {
      id: canonicalUrl(url),
      title,
      url: canonicalUrl(url),
      date,
      excerpt,
      author: "",
      siteName,
      imageUrl
    });
  });

  return [...candidates.values()]
    .sort((a, b) => dateValue(b.date) - dateValue(a.date))
    .slice(0, 50);
}

function isLikelyArticle(url, baseUrl) {
  try {
    const parsed = new URL(url);
    const base = new URL(baseUrl);
    if (parsed.hostname !== base.hostname && !parsed.hostname.endsWith(`.${base.hostname}`)) return false;
    if (["mailto:", "tel:", "javascript:"].includes(parsed.protocol)) return false;
    if (SKIP_HINTS.test(parsed.pathname)) return false;
    if (parsed.pathname === "/" || parsed.pathname.split("/").filter(Boolean).length < 1) return false;
    return ARTICLE_HINTS.some((hint) => hint.test(parsed.pathname)) || parsed.pathname.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

function normalizeInputUrl(value) {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function toAbsoluteUrl(href, baseUrl) {
  if (!href) return "";
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
}

function canonicalUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach((key) => {
      parsed.searchParams.delete(key);
    });
    return parsed.toString();
  } catch {
    return url;
  }
}

function uniqueUrls(urls) {
  return [...new Set(urls.map(canonicalUrl).filter(Boolean))];
}

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(value) {
  if (!value) return "";
  const parsed = new Date(cleanText(value));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function dateFromUrl(url) {
  const match = url.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})?/);
  if (!match) return "";
  const year = match[1];
  const month = String(match[2]).padStart(2, "0");
  const day = String(match[3] || "01").padStart(2, "0");
  return normalizeDate(`${year}-${month}-${day}`);
}

function dateValue(value) {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function pageTitle(html) {
  const $ = cheerio.load(html);
  return cleanText($("meta[property='og:site_name']").attr("content") || $("title").first().text());
}

function feedImageUrl(feed) {
  const image = feed.image;
  const url = typeof image === "string" ? image : image?.url || image?.href;
  return url ? toAbsoluteUrl(url, feed.link || "") || url : "";
}

function itemImageUrl(item, baseUrl) {
  const candidates = [
    item.enclosure?.type?.startsWith("image/") ? item.enclosure.url : "",
    imageFieldUrl(item.mediaContent),
    imageFieldUrl(item.mediaThumbnail),
    imageFieldUrl(item.itunesImage),
    htmlImageUrl(item.content || item.summary || "", item.link || baseUrl)
  ];

  return candidates.map((url) => toAbsoluteUrl(url, item.link || baseUrl) || url).find(Boolean) || "";
}

function imageFieldUrl(value) {
  if (!value) return "";
  if (Array.isArray(value)) return value.map(imageFieldUrl).find(Boolean) || "";
  if (typeof value === "string") return value;
  return value.url || value.href || value.$?.url || value.$?.href || "";
}

function htmlImageUrl(html, baseUrl) {
  const $ = cheerio.load(html || "");
  return firstImageUrl($, $.root(), baseUrl);
}

async function enrichMissingItemImages(items) {
  const missing = items.filter((item) => needsArticleImageLookup(item) && item.url).slice(0, ARTICLE_IMAGE_LOOKUP_LIMIT);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < missing.length) {
      const item = missing[nextIndex];
      nextIndex += 1;
      item.imageUrl = await articlePageImageUrl(item.url);
    }
  }

  await Promise.all(Array.from({ length: Math.min(ARTICLE_IMAGE_LOOKUP_CONCURRENCY, missing.length) }, worker));
}

async function articlePageImageUrl(url) {
  try {
    const page = await fetchText(url, { timeoutMs: ARTICLE_IMAGE_LOOKUP_TIMEOUT });
    return findArticleImage(page.text, page.finalUrl);
  } catch {
    return "";
  }
}

function findArticleImage(html, baseUrl) {
  const $ = cheerio.load(html);
  const metaImage = $(
    "meta[property='og:image:secure_url'], meta[property='og:image'], meta[name='twitter:image'], meta[name='twitter:image:src']"
  )
    .first()
    .attr("content");

  if (metaImage) return toAbsoluteUrl(metaImage, baseUrl);

  const imageSrc = $("article img, main img, [role='main'] img").first().attr("src");
  return imageSrc ? toAbsoluteUrl(imageSrc, baseUrl) : "";
}

function normalizeItemImages(items, feedSiteUrl) {
  const counts = items.reduce((totals, item) => {
    if (!item.imageUrl) return totals;
    const key = imageFingerprint(item.imageUrl);
    totals.set(key, (totals.get(key) || 0) + 1);
    return totals;
  }, new Map());

  items.forEach((item) => {
    if (isLikelyLogoImage(item.imageUrl, feedSiteUrl, counts)) item.imageUrl = "";
  });
}

function needsArticleImageLookup(item) {
  return !item.imageUrl || isLikelyLogoImage(item.imageUrl, item.url);
}

function isLikelyLogoImage(imageUrl, pageUrl = "", counts = new Map()) {
  if (!imageUrl) return true;
  if (/^data:image\//i.test(imageUrl)) return true;

  try {
    const image = new URL(imageUrl, pageUrl || "https://example.com/");
    const page = pageUrl ? new URL(pageUrl) : null;
    const path = decodeURIComponent(image.pathname);
    const filename = path.split("/").pop() || "";
    const repeatedAcrossFeed = counts.get(imageFingerprint(image.toString())) >= 3;
    const isRootAsset = page && image.hostname === page.hostname && path.split("/").filter(Boolean).length <= 1;

    return repeatedAcrossFeed || isRootAsset || LOGO_IMAGE_HINTS.test(`${path} ${filename}`);
  } catch {
    return LOGO_IMAGE_HINTS.test(imageUrl);
  }
}

function imageFingerprint(imageUrl) {
  try {
    const url = new URL(imageUrl);
    url.search = "";
    url.hash = "";
    return url.toString().toLowerCase();
  } catch {
    return String(imageUrl || "").toLowerCase();
  }
}

function firstImageUrl($, scope, baseUrl) {
  const images = scope.find("img").toArray();

  for (const element of images) {
    const image = $(element);
    const src =
      image.attr("data-src") ||
      image.attr("data-lazy-src") ||
      image.attr("data-original") ||
      firstSrcsetUrl(image.attr("data-srcset") || image.attr("srcset")) ||
      image.attr("src");
    const absoluteUrl = src ? toAbsoluteUrl(src, baseUrl) : "";
    if (absoluteUrl && !isLikelyLogoImage(absoluteUrl, baseUrl)) return absoluteUrl;
  }

  return "";
}

function firstSrcsetUrl(srcset) {
  return (
    String(srcset || "")
      .split(",")
      .map((candidate) => candidate.trim().split(/\s+/)[0])
      .find(Boolean) || ""
  );
}

function findSiteIcon(html, baseUrl) {
  const $ = cheerio.load(html);
  const ogImage = $("meta[property='og:image'], meta[name='twitter:image']").first().attr("content");
  if (ogImage) return toAbsoluteUrl(ogImage, baseUrl);

  const icon = $("link[rel~='apple-touch-icon'], link[rel~='icon']").first().attr("href");
  return icon ? toAbsoluteUrl(icon, baseUrl) : "";
}

function faviconUrl(siteUrl) {
  try {
    const url = new URL(siteUrl);
    return `${url.origin}/favicon.ico`;
  } catch {
    return "";
  }
}

function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export {
  app,
  canonicalUrl,
  cleanText,
  dateFromUrl,
  discoverSource,
  extractArticles,
  findFeedLinks,
  findArticleImage,
  findSiteIcon,
  isLikelyLogoImage,
  isLikelyArticle,
  itemImageUrl,
  normalizeDate,
  normalizeInputUrl,
  pageTitle,
  toAbsoluteUrl,
  uniqueUrls
};
