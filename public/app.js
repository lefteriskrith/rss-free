const STORAGE_KEY = "rss-yo-state-v1";

const state = loadState();
let currentFilter = "all";

const elements = {
  addForm: document.querySelector("#add-source-form"),
  sourceUrl: document.querySelector("#source-url"),
  refreshAll: document.querySelector("#refresh-all"),
  exportOpml: document.querySelector("#export-opml"),
  importOpml: document.querySelector("#opml-import"),
  sourcesList: document.querySelector("#sources-list"),
  sourceCount: document.querySelector("#source-count"),
  feedList: document.querySelector("#feed-list"),
  status: document.querySelector("#status-text"),
  filterButtons: document.querySelectorAll(".filter"),
  sourceTemplate: document.querySelector("#source-template"),
  postTemplate: document.querySelector("#post-template")
};

render();

elements.addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = elements.sourceUrl.value.trim();
  if (!url) return;
  await addOrRefreshSource(url);
  elements.sourceUrl.value = "";
});

elements.refreshAll.addEventListener("click", async () => {
  await refreshAllSources();
});

elements.exportOpml.addEventListener("click", () => {
  const xml = buildOpml();
  downloadText("rss-yo-sources.opml", xml);
});

elements.importOpml.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const urls = parseOpmlUrls(text);
  for (const url of urls) {
    await addOrRefreshSource(url, { quiet: true });
  }
  setStatus(`Imported ${urls.length} source${urls.length === 1 ? "" : "s"}.`);
  elements.importOpml.value = "";
});

elements.filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    render();
  });
});

async function addOrRefreshSource(url, options = {}) {
  setBusy(true);
  setStatus(`Checking ${url}...`);

  try {
    const result = await fetchJson(`/api/discover?url=${encodeURIComponent(url)}`);
    const sourceId = canonicalUrl(result.feedUrl || result.siteUrl || url);
    const existing = state.sources.find((source) => source.id === sourceId || source.inputUrl === url);
    const source = existing || {
      id: sourceId,
      inputUrl: url,
      siteUrl: result.siteUrl,
      feedUrl: result.feedUrl,
      title: result.title,
      mode: result.mode,
      addedAt: new Date().toISOString(),
      lastChecked: ""
    };

    source.inputUrl = url;
    source.siteUrl = result.siteUrl;
    source.feedUrl = result.feedUrl;
    source.title = result.title || source.title;
    source.mode = result.mode;
    source.lastChecked = new Date().toISOString();

    if (!existing) state.sources.push(source);

    const added = mergePosts(result.posts || [], source);
    saveState();
    render();

    if (!options.quiet) {
      setStatus(`${source.title}: ${added} new post${added === 1 ? "" : "s"} found.`);
    }
  } catch (error) {
    setStatus(error.message || "Could not refresh this source.");
  } finally {
    setBusy(false);
  }
}

async function refreshAllSources() {
  if (!state.sources.length) {
    setStatus("Add a source first.");
    return;
  }

  setBusy(true);
  let added = 0;

  for (const source of state.sources) {
    setStatus(`Refreshing ${source.title}...`);
    try {
      const result = await fetchJson(`/api/discover?url=${encodeURIComponent(source.inputUrl || source.siteUrl || source.feedUrl)}`);
      source.siteUrl = result.siteUrl;
      source.feedUrl = result.feedUrl;
      source.title = result.title || source.title;
      source.mode = result.mode;
      source.lastChecked = new Date().toISOString();
      added += mergePosts(result.posts || [], source);
    } catch (error) {
      console.warn(`Refresh failed for ${source.title}`, error);
    }
  }

  saveState();
  render();
  setBusy(false);
  setStatus(`Refresh complete. ${added} new post${added === 1 ? "" : "s"} added.`);
}

function mergePosts(posts, source) {
  let added = 0;
  const known = new Set(state.posts.map((post) => post.id));

  posts.forEach((post) => {
    const url = canonicalUrl(post.url || post.id);
    if (!url || known.has(url)) return;
    known.add(url);
    state.posts.push({
      id: url,
      sourceId: source.id,
      sourceTitle: source.title,
      title: post.title || "Untitled",
      url,
      date: post.date || "",
      excerpt: post.excerpt || "",
      author: post.author || "",
      read: false,
      discoveredAt: new Date().toISOString()
    });
    added += 1;
  });

  return added;
}

function render() {
  renderSources();
  renderPosts();
  elements.filterButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === currentFilter);
  });
}

function renderSources() {
  elements.sourcesList.innerHTML = "";
  elements.sourceCount.textContent = String(state.sources.length);

  state.sources.forEach((source) => {
    const fragment = elements.sourceTemplate.content.cloneNode(true);
    const item = fragment.querySelector(".source-item");
    item.querySelector("strong").textContent = source.title;
    item.querySelector("span").textContent = source.mode === "rss" ? source.feedUrl : source.siteUrl;

    item.querySelector(".copy-rss").addEventListener("click", async () => {
      await navigator.clipboard.writeText(buildRssForSource(source));
      setStatus(`Copied generated RSS for ${source.title}.`);
    });

    item.querySelector(".remove-source").addEventListener("click", () => {
      state.sources = state.sources.filter((candidate) => candidate.id !== source.id);
      state.posts = state.posts.filter((post) => post.sourceId !== source.id);
      saveState();
      render();
      setStatus(`${source.title} removed.`);
    });

    elements.sourcesList.appendChild(fragment);
  });
}

function renderPosts() {
  elements.feedList.innerHTML = "";
  const posts = filteredPosts();

  if (!posts.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = state.sources.length ? "No posts match this filter." : "Add a website or import OPML to populate your feed.";
    elements.feedList.appendChild(empty);
    return;
  }

  posts.forEach((post) => {
    const fragment = elements.postTemplate.content.cloneNode(true);
    const article = fragment.querySelector(".post");
    const toggle = fragment.querySelector(".read-toggle");
    const link = fragment.querySelector(".post-link");
    const time = fragment.querySelector("time");

    article.classList.toggle("read", post.read);
    toggle.title = post.read ? "Mark unread" : "Mark read";
    toggle.setAttribute("aria-label", toggle.title);
    toggle.addEventListener("click", () => {
      post.read = !post.read;
      saveState();
      render();
    });

    link.href = post.url;
    link.addEventListener("click", () => {
      post.read = true;
      saveState();
      render();
    });

    fragment.querySelector(".source-name").textContent = post.sourceTitle;
    time.textContent = formatDate(post.date || post.discoveredAt);
    time.dateTime = post.date || post.discoveredAt;
    fragment.querySelector("h3").textContent = post.title;
    fragment.querySelector("p").textContent = post.excerpt || post.url;

    elements.feedList.appendChild(fragment);
  });
}

function filteredPosts() {
  return state.posts
    .filter((post) => {
      if (currentFilter === "read") return post.read;
      if (currentFilter === "unread") return !post.read;
      return true;
    })
    .sort((a, b) => dateValue(b.date || b.discoveredAt) - dateValue(a.date || a.discoveredAt));
}

function buildRssForSource(source) {
  const posts = state.posts
    .filter((post) => post.sourceId === source.id)
    .sort((a, b) => dateValue(b.date || b.discoveredAt) - dateValue(a.date || a.discoveredAt));
  const siteUrl = source.siteUrl || source.feedUrl || source.inputUrl;

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(source.title)}</title>
    <link>${escapeXml(siteUrl)}</link>
    <description>Generated by RSS Yo from discovered posts.</description>
${posts
  .map((post) => `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(post.url)}</link>
      <guid>${escapeXml(post.url)}</guid>
      ${post.date ? `<pubDate>${new Date(post.date).toUTCString()}</pubDate>` : ""}
      <description>${escapeXml(post.excerpt)}</description>
    </item>`)
  .join("\n")}
  </channel>
</rss>`;
}

function buildOpml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>RSS Yo Sources</title>
  </head>
  <body>
${state.sources
  .map((source) => `    <outline text="${escapeXml(source.title)}" title="${escapeXml(source.title)}" type="rss" xmlUrl="${escapeXml(source.feedUrl || source.inputUrl)}" htmlUrl="${escapeXml(source.siteUrl || source.inputUrl)}" />`)
  .join("\n")}
  </body>
</opml>`;
}

function parseOpmlUrls(text) {
  const document = new DOMParser().parseFromString(text, "text/xml");
  return [...document.querySelectorAll("outline")]
    .map((outline) => outline.getAttribute("xmlUrl") || outline.getAttribute("htmlUrl") || outline.getAttribute("url"))
    .filter(Boolean);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Request failed.");
  }
  return payload;
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { sources: [], posts: [] };
  } catch {
    return { sources: [], posts: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function setStatus(message) {
  elements.status.textContent = message;
}

function setBusy(isBusy) {
  elements.addForm.querySelector("button").disabled = isBusy;
  elements.refreshAll.disabled = isBusy;
}

function canonicalUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach((key) => parsed.searchParams.delete(key));
    return parsed.toString();
  } catch {
    return url;
  }
}

function formatDate(value) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
}

function dateValue(value) {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function escapeXml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
