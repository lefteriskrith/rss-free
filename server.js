import express from "express";
import Parser from "rss-parser";
import * as cheerio from "cheerio";

const app = express();
const parser = new Parser({
  timeout: 12000,
  headers: {
    "User-Agent": "RSS Yo/1.0 (+local personal reader)"
  }
});

const PORT = process.env.PORT || 5173;
const COMMON_FEED_PATHS = ["/feed", "/rss", "/rss.xml", "/atom.xml", "/feed.xml"];
const ARTICLE_HINTS = [
  /\/\d{4}\/\d{1,2}\//,
  /\/\d{4}-\d{1,2}-\d{1,2}/,
  /\/(post|posts|article|articles|blog|news|story|stories)\//i
];
const SKIP_HINTS = /(about|account|advertis|archive|author|cart|category|comment|contact|cookie|feed|footer|help|login|logout|menu|privacy|profile|rss|search|share|shop|signin|signup|tag|terms)/i;

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

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

app.listen(PORT, () => {
  console.log(`RSS Yo is running at http://localhost:${PORT}`);
});

async function discoverSource(inputUrl) {
  const directFeed = await tryParseFeed(inputUrl);
  if (directFeed) {
    return {
      inputUrl,
      siteUrl: inputUrl,
      mode: "rss",
      feedUrl: inputUrl,
      title: directFeed.title || hostname(inputUrl),
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
        posts: feed.items
      };
    }
  }

  const scraped = extractArticles(homepage.text, homepage.finalUrl);
  return {
    inputUrl,
    siteUrl: homepage.finalUrl,
    mode: "scrape",
    feedUrl: null,
    title: pageTitle(homepage.text) || hostname(homepage.finalUrl),
    posts: scraped
  };
}

async function tryParseFeed(feedUrl) {
  try {
    const parsed = await parser.parseURL(feedUrl);
    if (!parsed.items?.length && !parsed.title) return null;

    return {
      title: parsed.title,
      items: (parsed.items || []).map((item) => ({
        id: canonicalUrl(item.link || item.guid || feedUrl),
        title: cleanText(item.title) || "Untitled",
        url: canonicalUrl(item.link || item.guid || feedUrl),
        date: normalizeDate(item.isoDate || item.pubDate),
        excerpt: cleanText(item.contentSnippet || item.summary || item.content || ""),
        author: cleanText(item.creator || item.author || "")
      }))
    };
  } catch {
    return null;
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

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

    candidates.set(canonicalUrl(url), {
      id: canonicalUrl(url),
      title,
      url: canonicalUrl(url),
      date,
      excerpt,
      author: "",
      siteName
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

function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
