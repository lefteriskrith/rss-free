import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalUrl,
  dateFromUrl,
  extractArticles,
  findFeedLinks,
  findArticleImage,
  findSiteIcon,
  isLikelyArticle,
  isLikelyLogoImage,
  itemImageUrl,
  normalizeInputUrl
} from "../server.js";

test("normalizes user-entered URLs", () => {
  assert.equal(normalizeInputUrl("example.com"), "https://example.com/");
  assert.equal(normalizeInputUrl("http://example.com/blog"), "http://example.com/blog");
  assert.equal(normalizeInputUrl("ftp://example.com"), "");
  assert.equal(normalizeInputUrl("not a url"), "");
});

test("canonical URLs remove hash and common tracking params", () => {
  assert.equal(
    canonicalUrl("https://example.com/post?utm_source=newsletter&id=12#comments"),
    "https://example.com/post?id=12"
  );
});

test("discovers RSS and Atom alternate links from homepage HTML", () => {
  const html = `
    <html>
      <head>
        <link rel="alternate" type="application/rss+xml" href="/feed.xml">
        <link rel="alternate" type="application/atom+xml" href="https://example.com/atom.xml">
      </head>
    </html>
  `;

  assert.deepEqual(findFeedLinks(html, "https://example.com/blog"), [
    "https://example.com/feed.xml",
    "https://example.com/atom.xml"
  ]);
});

test("extracts likely article links and ignores navigation/footer/sidebar links", () => {
  const html = `
    <main>
      <nav><a href="/about">About</a></nav>
      <article>
        <a href="/2026/06/05/rss-reader-update" title="RSS reader update">Read more</a>
        <img src="/images/rss-reader-update.jpg" alt="">
        <time datetime="2026-06-05">June 5, 2026</time>
        <p>A short useful excerpt for the reader.</p>
      </article>
      <footer><a href="/privacy">Privacy</a></footer>
    </main>
  `;

  const posts = extractArticles(html, "https://example.com/");

  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, "RSS reader update");
  assert.equal(posts[0].url, "https://example.com/2026/06/05/rss-reader-update");
  assert.equal(posts[0].excerpt, "A short useful excerpt for the reader.");
  assert.equal(posts[0].date, "2026-06-05T00:00:00.000Z");
  assert.equal(posts[0].imageUrl, "https://example.com/images/rss-reader-update.jpg");
});

test("article heuristic rejects off-site and utility links", () => {
  assert.equal(isLikelyArticle("https://example.com/2026/06/05/story", "https://example.com"), true);
  assert.equal(isLikelyArticle("https://other.example.net/2026/06/05/story", "https://example.com"), false);
  assert.equal(isLikelyArticle("https://example.com/privacy", "https://example.com"), false);
});

test("extracts dates from article URLs", () => {
  assert.equal(dateFromUrl("https://example.com/2026/06/05/story"), "2026-06-05T00:00:00.000Z");
  assert.equal(dateFromUrl("https://example.com/2026/06/story"), "2026-06-01T00:00:00.000Z");
});

test("extracts feed item and site images", () => {
  assert.equal(
    itemImageUrl(
      {
        link: "https://example.com/posts/story",
        mediaThumbnail: { url: "/thumb.jpg" }
      },
      "https://example.com/feed.xml"
    ),
    "https://example.com/thumb.jpg"
  );

  assert.equal(
    findSiteIcon('<meta property="og:image" content="/brand.png"><link rel="icon" href="/favicon.ico">',
      "https://example.com/blog"),
    "https://example.com/brand.png"
  );
});

test("extracts article page image metadata", () => {
  const html = `
    <html>
      <head>
        <meta property="og:image" content="/news/story-cover.jpg">
      </head>
      <body>
        <article><img src="/fallback.jpg" alt=""></article>
      </body>
    </html>
  `;

  assert.equal(findArticleImage(html, "https://example.com/news/story"), "https://example.com/news/story-cover.jpg");
});

test("treats repeated brand images as missing post images", () => {
  const counts = new Map([["https://example.com/logo.png", 5]]);

  assert.equal(isLikelyLogoImage("https://example.com/logo.png", "https://example.com/news/story", counts), true);
  assert.equal(isLikelyLogoImage("data:image/png;base64,AAAA", "https://example.com/news/story", counts), true);
  assert.equal(isLikelyLogoImage("https://example.com/images/story-cover.webp", "https://example.com/news/story", counts), false);
});
