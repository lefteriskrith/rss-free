const STORAGE_KEY = "rss-yo-state-v1";

const state = loadState();
let currentFilter = "all";
let currentGroup = "all";
let readObserver;
let renderTimer;

const elements = {
  addForm: document.querySelector("#add-source-form"),
  addGroupForm: document.querySelector("#add-group-form"),
  sourceUrl: document.querySelector("#source-url"),
  sourceGroup: document.querySelector("#source-group"),
  groupName: document.querySelector("#group-name"),
  groupFilter: document.querySelector("#group-filter"),
  refreshAll: document.querySelector("#refresh-all"),
  exportOpml: document.querySelector("#export-opml"),
  importOpml: document.querySelector("#opml-import"),
  themeToggle: document.querySelector("#theme-toggle"),
  sourcesList: document.querySelector("#sources-list"),
  sourceCount: document.querySelector("#source-count"),
  feedList: document.querySelector("#feed-list"),
  status: document.querySelector("#status-text"),
  filterButtons: document.querySelectorAll(".filter"),
  sourceTemplate: document.querySelector("#source-template"),
  postTemplate: document.querySelector("#post-template")
};

applyTheme();
render();

elements.addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = elements.sourceUrl.value.trim();
  if (!url) return;
  await addOrRefreshSource(url, { group: elements.sourceGroup.value || "General" });
  elements.sourceUrl.value = "";
});

elements.addGroupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const groupName = normalizeGroup(elements.groupName.value);
  if (!groupName) return;
  ensureGroup(groupName);
  elements.sourceGroup.value = groupName;
  elements.groupName.value = "";
  saveState();
  render();
  setStatus(`Created group ${groupName}.`);
});

elements.refreshAll.addEventListener("click", async () => {
  await refreshAllSources();
});

elements.themeToggle.addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  saveState();
  applyTheme();
});

elements.exportOpml.addEventListener("click", () => {
  const xml = buildOpml();
  downloadText("rss-yo-sources.opml", xml);
});

elements.importOpml.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const entries = parseOpmlEntries(text);
  for (const entry of entries) {
    await addOrRefreshSource(entry.url, { quiet: true, group: entry.group });
  }
  setStatus(`Imported ${entries.length} source${entries.length === 1 ? "" : "s"} from OPML.`);
  elements.importOpml.value = "";
});

elements.groupFilter.addEventListener("change", () => {
  currentGroup = elements.groupFilter.value;
  render();
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
      group: normalizeGroup(options.group) || "General",
      addedAt: new Date().toISOString(),
      lastChecked: ""
    };

    source.inputUrl = url;
    source.siteUrl = result.siteUrl;
    source.feedUrl = result.feedUrl;
    source.title = result.title || source.title;
    source.mode = result.mode;
    source.group = normalizeGroup(options.group) || source.group || "General";
    source.lastChecked = new Date().toISOString();
    ensureGroup(source.group);

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
  normalizeState();
  renderGroupControls();
  renderSources();
  renderPosts();
  elements.filterButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === currentFilter);
  });
}

function renderSources() {
  elements.sourcesList.innerHTML = "";
  elements.sourceCount.textContent = String(state.sources.length);

  groupedSources().forEach(([groupName, sources]) => {
    const heading = document.createElement("li");
    heading.className = "group-heading";
    heading.textContent = groupName;
    elements.sourcesList.appendChild(heading);

    sources.forEach((source) => {
    const fragment = elements.sourceTemplate.content.cloneNode(true);
    const item = fragment.querySelector(".source-item");
    const groupSelect = item.querySelector(".source-group-select");
    item.querySelector("strong").textContent = source.title;
    item.querySelector("small").textContent = source.group || "General";
    item.querySelector("span").textContent = source.mode === "rss" ? source.feedUrl : source.siteUrl;

    state.groups.forEach((group) => {
      groupSelect.appendChild(new Option(group, group, false, group === source.group));
    });
    groupSelect.addEventListener("change", () => {
      source.group = groupSelect.value;
      saveState();
      render();
      setStatus(`${source.title} moved to ${source.group}.`);
    });

    item.querySelector(".mark-source-read").addEventListener("click", () => {
      const count = markSourceRead(source.id);
      saveState();
      render();
      setStatus(`${source.title}: marked ${count} post${count === 1 ? "" : "s"} as read.`);
    });

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
  });
}

function renderPosts() {
  disconnectReadObserver();
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

    article.dataset.postId = post.id;
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

    article.addEventListener("mouseenter", () => {
      if (post.read) return;
      post.read = true;
      article.classList.add("read");
      toggle.title = "Mark unread";
      toggle.setAttribute("aria-label", "Mark unread");
      saveState();
      if (currentFilter !== "all") scheduleRender();
    });

    fragment.querySelector(".source-name").textContent = post.sourceTitle;
    time.textContent = formatDate(post.date || post.discoveredAt);
    time.dateTime = post.date || post.discoveredAt;
    fragment.querySelector("h3").textContent = post.title;
    fragment.querySelector("p").textContent = post.excerpt || post.url;

    elements.feedList.appendChild(fragment);
  });

  observeUnreadPosts();
}

function filteredPosts() {
  return state.posts
    .filter((post) => {
      if (currentGroup !== "all" && sourceGroupForPost(post) !== currentGroup) return false;
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
  const sourceGroups = state.sources.reduce((groups, source) => {
    const group = source.group || "General";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(source);
    return groups;
  }, new Map());
  const outlines = [...sourceGroups.entries()]
    .map(([group, sources]) => `    <outline text="${escapeXml(group)}" title="${escapeXml(group)}">
${sources
  .map((source) => `      <outline text="${escapeXml(source.title)}" title="${escapeXml(source.title)}" type="rss" xmlUrl="${escapeXml(source.feedUrl || source.inputUrl)}" htmlUrl="${escapeXml(source.siteUrl || source.inputUrl)}" />`)
  .join("\n")}
    </outline>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>RSS Yo Sources</title>
  </head>
  <body>
${outlines}
  </body>
</opml>`;
}

function parseOpmlEntries(text) {
  const document = new DOMParser().parseFromString(text, "text/xml");
  return [...document.querySelectorAll("outline")]
    .map((outline) => {
      const url = outline.getAttribute("xmlUrl") || outline.getAttribute("htmlUrl") || outline.getAttribute("url");
      if (!url) return null;
      const parent = outline.parentElement?.tagName?.toLowerCase() === "outline" ? outline.parentElement : null;
      const group = normalizeGroup(parent?.getAttribute("title") || parent?.getAttribute("text")) || "General";
      return { url, group };
    })
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
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    return {
      sources: stored.sources || [],
      posts: stored.posts || [],
      groups: stored.groups || [],
      theme: stored.theme || "light"
    };
  } catch {
    return { sources: [], posts: [], groups: ["General"], theme: "light" };
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

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  elements.themeToggle.textContent = state.theme === "dark" ? "Light" : "Dark";
}

function normalizeState() {
  state.groups = [...new Set(["General", ...(state.groups || []), ...state.sources.map((source) => source.group || "General")])];
  state.sources.forEach((source) => {
    source.group = normalizeGroup(source.group) || "General";
  });
}

function renderGroupControls() {
  const selectedSourceGroup = elements.sourceGroup.value || "General";
  const selectedFilterGroup = currentGroup;

  elements.sourceGroup.innerHTML = "";
  state.groups.forEach((group) => {
    elements.sourceGroup.appendChild(new Option(group, group, false, group === selectedSourceGroup));
  });

  elements.groupFilter.innerHTML = "";
  elements.groupFilter.appendChild(new Option("All groups", "all", false, selectedFilterGroup === "all"));
  state.groups.forEach((group) => {
    elements.groupFilter.appendChild(new Option(group, group, false, group === selectedFilterGroup));
  });
}

function ensureGroup(groupName) {
  const group = normalizeGroup(groupName) || "General";
  if (!state.groups.includes(group)) state.groups.push(group);
  return group;
}

function normalizeGroup(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function groupedSources() {
  const groups = new Map();
  state.sources
    .slice()
    .sort((a, b) => (a.group || "General").localeCompare(b.group || "General") || a.title.localeCompare(b.title))
    .forEach((source) => {
      const group = source.group || "General";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(source);
    });
  return [...groups.entries()];
}

function sourceGroupForPost(post) {
  return state.sources.find((source) => source.id === post.sourceId)?.group || "General";
}

function markSourceRead(sourceId) {
  let count = 0;
  state.posts.forEach((post) => {
    if (post.sourceId === sourceId && !post.read) {
      post.read = true;
      count += 1;
    }
  });
  return count;
}

function observeUnreadPosts() {
  if (!("IntersectionObserver" in window)) return;

  readObserver = new IntersectionObserver(
    (entries) => {
      let changed = false;

      entries.forEach((entry) => {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.65) return;

        const post = state.posts.find((candidate) => candidate.id === entry.target.dataset.postId);
        if (!post || post.read) return;

        post.read = true;
        changed = true;
        entry.target.classList.add("read");
        const toggle = entry.target.querySelector(".read-toggle");
        toggle.title = "Mark unread";
        toggle.setAttribute("aria-label", "Mark unread");
        readObserver.unobserve(entry.target);
      });

      if (changed) {
        saveState();
        if (currentFilter !== "all") scheduleRender();
      }
    },
    {
      threshold: [0.65],
      rootMargin: "0px 0px -12% 0px"
    }
  );

  document.querySelectorAll(".post:not(.read)").forEach((post) => {
    readObserver.observe(post);
  });
}

function disconnectReadObserver() {
  if (readObserver) {
    readObserver.disconnect();
    readObserver = null;
  }
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 450);
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
