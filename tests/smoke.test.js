import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("main HTML includes required reader controls", async () => {
  const html = await readFile("public/index.html", "utf8");

  [
    'id="add-source-form"',
    'id="source-group"',
    'id="add-group-form"',
    'id="refresh-all"',
    'id="theme-toggle"',
    'id="group-filter"',
    'id="opml-import"',
    'id="export-opml"',
    'class="mark-source-read"',
    'class="copy-rss"'
  ].forEach((needle) => assert.ok(html.includes(needle), `Missing ${needle}`));
});

test("client script wires key reader behaviors", async () => {
  const script = await readFile("public/app.js", "utf8");

  [
    "parseOpmlEntries",
    "buildOpml",
    "observeUnreadPosts",
    "mouseenter",
    "markSourceRead",
    "renderGroupControls",
    "localStorage.setItem"
  ].forEach((needle) => assert.ok(script.includes(needle), `Missing ${needle}`));
});

test("stylesheet includes dark theme and group styles", async () => {
  const css = await readFile("public/styles.css", "utf8");

  [
    ':root[data-theme="dark"]',
    ".group-heading",
    ".source-group-select",
    ".post:hover"
  ].forEach((needle) => assert.ok(css.includes(needle), `Missing ${needle}`));
});
