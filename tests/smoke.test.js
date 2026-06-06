import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("main HTML includes required reader controls", async () => {
  const html = await readFile("public/index.html", "utf8");

  [
    'id="add-source-form"',
    'id="add-source-panel"',
    'id="add-group-panel"',
    'class="panel-toggle"',
    'rel="icon"',
    "/assets/rss-yo-logo.svg",
    'class="brand-mark"',
    'id="source-group"',
    'id="add-group-form"',
    'id="refresh-all"',
    'id="theme-toggle"',
    'id="group-filter"',
    'id="opml-import"',
    'id="export-opml"',
    'data-filter="favorite"',
    'id="post-context-menu"',
    'id="context-read-toggle"',
    'id="context-favorite-toggle"',
    'class="source-select"',
    'class="source-title-row"',
    'class="source-unread"',
    'class="mark-source-read"',
    'class="copy-rss"',
    'class="edit-source"',
    'class="source-edit hidden"',
    'class="delete-source"'
  ].forEach((needle) => assert.ok(html.includes(needle), `Missing ${needle}`));
});

test("client script wires key reader behaviors", async () => {
  const script = await readFile("public/app.js", "utf8");

  [
    "parseOpmlEntries",
    "importOpmlEntries",
    "getOutlineGroup",
    "groupFromCategory",
    "groupFromParentOutline",
    "buildOpml",
    "bindPostContextMenu",
    "showPostContextMenu",
    "hidePostContextMenu",
    "findContextPost",
    "findExistingSource",
    "findExistingSourceByUrl",
    "sourceFingerprints",
    "contextmenu",
    "favorite",
    "markSourceRead",
    "renderGroupControls",
    "currentSource",
    "collapsedGroups",
    "isGroupCollapsed",
    "setGroupCollapsed",
    "reorderGroup",
    "deleteGroup",
    "group-view",
    "dragstart",
    "drop",
    "Show",
    "Hide",
    "window.confirm",
    'document.createElement("div")',
    "localStorage.setItem"
  ].forEach((needle) => assert.ok(script.includes(needle), `Missing ${needle}`));

  ["bindSidebarPanels", "setSidebarPanelOpen", "closeSidebarPanel"].forEach((needle) =>
    assert.ok(script.includes(needle), `Missing ${needle}`)
  );

  assert.ok(!script.includes('document.createElement("template")'), "HTML escaping should not use template elements.");
  assert.ok(!script.includes('groupName === "General" ? " disabled"'), "General group delete should not be disabled.");
  assert.ok(!script.includes("IntersectionObserver"), "Posts should not be auto-marked read by viewport visibility.");
  assert.ok(!script.includes('addEventListener("mouseenter"'), "Posts should not be auto-marked read on hover.");
});

test("stylesheet includes dark theme and group styles", async () => {
  const css = await readFile("public/styles.css", "utf8");

  [
    ':root[data-theme="dark"]',
    ".group-heading",
    ".group-view",
    ".group-toggle",
    ".sidebar-panel.collapsed .panel-body",
    ".panel-toggle",
    ".group-name",
    ".group-drag",
    ".group-delete",
    ".drag-over",
    ".source-item.active",
    ".source-unread",
    ".source-select .source-title-row",
    "min-width: 28px",
    ".source-actions button",
    ".source-edit.hidden",
    ".delete-source",
    ".source-group-select",
    ".context-menu",
    ".post.favorite",
    ".post:hover"
  ].forEach((needle) => assert.ok(css.includes(needle), `Missing ${needle}`));
});

test("logo asset is available as an SVG favicon", async () => {
  const logo = await readFile("public/assets/rss-yo-logo.svg", "utf8");

  assert.ok(logo.includes("<svg"), "Logo should be an SVG file.");
  assert.ok(logo.includes("#ff7a1a"), "Logo should use the orange RSS brand color.");
});
