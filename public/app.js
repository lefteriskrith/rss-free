const STORAGE_KEY = "rss-yo-state-v1";

const state = loadState();
let currentFilter = "all";
let currentGroup = "all";
let currentSource = "all";
let readObserver;
let renderTimer;
let draggedGroup = "";
let contextPostId = "";

const elements = {
  addForm: document.querySelector("#add-source-form"),
  addGroupForm: document.querySelector("#add-group-form"),
  sidebarPanels: document.querySelectorAll(".sidebar-panel"),
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
  contextMenu: document.querySelector("#post-context-menu"),
  contextReadToggle: document.querySelector("#context-read-toggle"),
  contextFavoriteToggle: document.querySelector("#context-favorite-toggle"),
  sourceTemplate: document.querySelector("#source-template"),
  postTemplate: document.querySelector("#post-template")
};

applyTheme();
bindSidebarPanels();
bindPostContextMenu();
render();

elements.addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = elements.sourceUrl.value.trim();
  if (!url) return;
  await addOrRefreshSource(url, { group: elements.sourceGroup.value || "General" });
  elements.sourceUrl.value = "";
  closeSidebarPanel("add-source-panel");
});

elements.addGroupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const groupName = normalizeGroup(elements.groupName.value);
  if (!groupName) return;
  ensureGroup(groupName);
  setGroupCollapsed(groupName, false);
  elements.sourceGroup.value = groupName;
  elements.groupName.value = "";
  saveState();
  render();
  setStatus(`Created group ${groupName}.`);
  closeSidebarPanel("add-group-panel");
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
  await importOpmlEntries(entries);
  elements.importOpml.value = "";
});

elements.groupFilter.addEventListener("change", () => {
  currentGroup = elements.groupFilter.value;
  currentSource = "all";
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
    const existing = findExistingSource(result, url, sourceId);
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
    setGroupCollapsed(source.group, false);

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
      favorite: false,
      discoveredAt: new Date().toISOString()
    });
    added += 1;
  });

  return added;
}

function findExistingSource(result, originalUrl, sourceId) {
  const incoming = sourceFingerprints({
    id: sourceId,
    inputUrl: originalUrl,
    siteUrl: result.siteUrl,
    feedUrl: result.feedUrl
  });

  return state.sources.find((source) => {
    const stored = sourceFingerprints(source);
    return [...incoming].some((fingerprint) => stored.has(fingerprint));
  });
}

function sourceFingerprints(source) {
  const urls = [source.id, source.inputUrl, source.siteUrl, source.feedUrl].filter(Boolean);
  const fingerprints = new Set();

  urls.forEach((url) => {
    const canonical = canonicalUrl(url);
    fingerprints.add(canonical);
    fingerprints.add(canonical.replace(/\/$/, ""));
    fingerprints.add(canonical.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, ""));
  });

  return fingerprints;
}

async function importOpmlEntries(entries) {
  const importedGroups = [...new Set(entries.map((entry) => normalizeGroup(entry.group) || "General"))];
  let moved = 0;
  let addedOrRefreshed = 0;

  importedGroups.forEach((group) => {
    ensureGroup(group);
    setGroupCollapsed(group, false);
  });

  render();
  setStatus(`Found ${importedGroups.length} group${importedGroups.length === 1 ? "" : "s"} in OPML. Organizing sources...`);

  const missingEntries = [];

  entries.forEach((entry) => {
    const group = normalizeGroup(entry.group) || "General";
    const existing = findExistingSourceByUrl(entry.url);

    if (existing) {
      if (existing.group !== group) moved += 1;
      existing.group = group;
      ensureGroup(group);
      setGroupCollapsed(group, false);
      return;
    }

    missingEntries.push({ ...entry, group });
  });

  saveState();
  render();

  for (const entry of missingEntries) {
    await addOrRefreshSource(entry.url, { quiet: true, group: entry.group });
    addedOrRefreshed += 1;
  }

  saveState();
  render();
  setStatus(
    `Imported ${entries.length} source${entries.length === 1 ? "" : "s"} into ${importedGroups.length} group${importedGroups.length === 1 ? "" : "s"}; moved ${moved}, fetched ${addedOrRefreshed}.`
  );
}

function findExistingSourceByUrl(url) {
  const incoming = sourceFingerprints({ id: url, inputUrl: url, siteUrl: url, feedUrl: url });
  return state.sources.find((source) => {
    const stored = sourceFingerprints(source);
    return [...incoming].some((fingerprint) => stored.has(fingerprint));
  });
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

  state.groups.forEach((groupName) => {
    const sources = state.sources
      .filter((source) => source.group === groupName)
      .sort((a, b) => a.title.localeCompare(b.title));
    const unreadCount = sources.reduce((total, source) => total + unreadCountForSource(source.id), 0);
    const isCollapsed = isGroupCollapsed(groupName);
    const displayName = displayGroupName(groupName);
    const heading = document.createElement("li");
    heading.className = "group-heading";
    heading.dataset.group = groupName;
    heading.draggable = true;
    heading.classList.toggle("active", currentGroup === groupName && currentSource === "all");
    heading.classList.toggle("collapsed", isCollapsed);
    heading.innerHTML = `
      <button class="group-drag" type="button" title="Drag to reorder" aria-label="Drag ${escapeHtml(displayName)}">::</button>
      <button class="group-toggle" type="button" aria-expanded="${String(!isCollapsed)}">${isCollapsed ? "Show" : "Hide"}</button>
      <button class="group-view" type="button" aria-label="Show unread from ${escapeHtml(displayName)}">
        <span class="group-name">${escapeHtml(displayName)}</span>
        <em>${unreadCount}</em>
      </button>
      <button class="group-delete" type="button" title="Delete group" aria-label="Delete ${escapeHtml(displayName)}">x</button>`;
    heading.addEventListener("dragstart", (event) => {
      draggedGroup = groupName;
      heading.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", groupName);
    });
    heading.addEventListener("dragend", () => {
      draggedGroup = "";
      heading.classList.remove("dragging");
    });
    heading.addEventListener("dragover", (event) => {
      if (!draggedGroup || draggedGroup === groupName) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      heading.classList.add("drag-over");
    });
    heading.addEventListener("dragleave", () => {
      heading.classList.remove("drag-over");
    });
    heading.addEventListener("drop", (event) => {
      event.preventDefault();
      heading.classList.remove("drag-over");
      reorderGroup(draggedGroup, groupName);
    });
    heading.querySelector(".group-view").addEventListener("click", () => {
      currentGroup = groupName;
      currentSource = "all";
      currentFilter = "unread";
      elements.groupFilter.value = groupName;
      render();
      setStatus(`Showing unread from ${displayName}.`);
    });
    heading.querySelector(".group-toggle").addEventListener("click", (event) => {
      event.stopPropagation();
      setGroupCollapsed(groupName, !isCollapsed);
      render();
      setStatus(`${isCollapsed ? "Opened" : "Closed"} ${displayName}.`);
    });
    heading.querySelector(".group-delete").addEventListener("click", (event) => {
      event.stopPropagation();
      deleteGroup(groupName);
    });
    elements.sourcesList.appendChild(heading);

    if (isCollapsed) return;

    sources.forEach((source) => {
    const fragment = elements.sourceTemplate.content.cloneNode(true);
    const item = fragment.querySelector(".source-item");
    const groupSelect = item.querySelector(".source-group-select");
    const sourceSelect = item.querySelector(".source-select");
    const editPanel = item.querySelector(".source-edit");
    const editButton = item.querySelector(".edit-source");
    const sourceUnread = unreadCountForSource(source.id);
    item.classList.toggle("active", currentSource === source.id);
    item.querySelector("strong").textContent = source.title;
    item.querySelector(".source-unread").textContent = String(sourceUnread);
    item.querySelector(".source-unread").title = `${sourceUnread} unread`;
    item.querySelector("small").textContent = source.group || "General";
    item.querySelector("span").textContent = source.mode === "rss" ? source.feedUrl : source.siteUrl;

    sourceSelect.addEventListener("click", () => {
      currentSource = source.id;
      currentGroup = "all";
      elements.groupFilter.value = "all";
      render();
      setStatus(`Showing ${source.title}.`);
    });

    state.groups.forEach((group) => {
      groupSelect.appendChild(new Option(group, group, false, group === source.group));
    });
    groupSelect.addEventListener("change", () => {
      source.group = groupSelect.value;
      saveState();
      render();
      setStatus(`${source.title} moved to ${source.group}.`);
    });

    editButton.addEventListener("click", () => {
      const isHidden = editPanel.classList.toggle("hidden");
      editButton.textContent = isHidden ? "Edit" : "Close";
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

    item.querySelector(".delete-source").addEventListener("click", () => {
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
    article.classList.toggle("favorite", Boolean(post.favorite));
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

    article.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showPostContextMenu(post.id, event.clientX, event.clientY);
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
      if (currentSource !== "all" && post.sourceId !== currentSource) return false;
      if (currentGroup !== "all" && sourceGroupForPost(post) !== currentGroup) return false;
      if (currentFilter === "read") return post.read;
      if (currentFilter === "unread") return !post.read;
      if (currentFilter === "favorite") return Boolean(post.favorite);
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
      const group = getOutlineGroup(outline);
      return { url, group };
    })
    .filter(Boolean);
}

function getOutlineGroup(outline) {
  return groupFromCategory(outline.getAttribute("category")) || groupFromParentOutline(outline) || "General";
}

function groupFromCategory(category) {
  const value = normalizeGroup(category);
  if (!value) return "";
  const first = value.split(",")[0].trim();
  const clean = first
    .split("/")
    .map((part) => normalizeGroup(part))
    .filter(Boolean)
    .at(-1);
  return clean || "";
}

function groupFromParentOutline(outline) {
  let parent = outline.parentElement;

  while (parent && parent.tagName?.toLowerCase() !== "body") {
    if (parent.tagName?.toLowerCase() === "outline") {
      const group = normalizeGroup(parent.getAttribute("title") || parent.getAttribute("text"));
      if (group) return group;
    }
    parent = parent.parentElement;
  }

  return "";
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
      collapsedGroups: stored.collapsedGroups || {},
      theme: stored.theme || "light"
    };
  } catch {
    return { sources: [], posts: [], groups: ["General"], collapsedGroups: {}, theme: "light" };
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

function bindSidebarPanels() {
  elements.sidebarPanels.forEach((panel) => {
    const toggle = panel.querySelector(".panel-toggle");
    toggle.addEventListener("click", () => {
      setSidebarPanelOpen(panel, panel.classList.contains("collapsed"));
    });
  });
}

function bindPostContextMenu() {
  elements.contextReadToggle.addEventListener("click", () => {
    const post = findContextPost();
    if (!post) return;
    post.read = !post.read;
    saveState();
    hidePostContextMenu();
    render();
    setStatus(`${post.read ? "Marked read" : "Marked unread"}: ${post.title}`);
  });

  elements.contextFavoriteToggle.addEventListener("click", () => {
    const post = findContextPost();
    if (!post) return;
    post.favorite = !post.favorite;
    saveState();
    hidePostContextMenu();
    render();
    setStatus(`${post.favorite ? "Added favorite" : "Removed favorite"}: ${post.title}`);
  });

  document.addEventListener("click", (event) => {
    if (!elements.contextMenu.contains(event.target)) hidePostContextMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hidePostContextMenu();
  });
}

function showPostContextMenu(postId, x, y) {
  contextPostId = postId;
  const post = findContextPost();
  if (!post) return;

  elements.contextReadToggle.textContent = post.read ? "Mark unread" : "Mark read";
  elements.contextFavoriteToggle.textContent = post.favorite ? "Remove favorite" : "Add favorite";
  elements.contextMenu.classList.remove("hidden");

  const width = elements.contextMenu.offsetWidth || 180;
  const height = elements.contextMenu.offsetHeight || 80;
  const left = Math.min(x, window.innerWidth - width - 10);
  const top = Math.min(y, window.innerHeight - height - 10);
  elements.contextMenu.style.left = `${Math.max(10, left)}px`;
  elements.contextMenu.style.top = `${Math.max(10, top)}px`;
}

function hidePostContextMenu() {
  contextPostId = "";
  elements.contextMenu.classList.add("hidden");
}

function findContextPost() {
  return state.posts.find((post) => post.id === contextPostId);
}

function setSidebarPanelOpen(panel, isOpen) {
  panel.classList.toggle("collapsed", !isOpen);
  panel.querySelector(".panel-toggle").setAttribute("aria-expanded", String(isOpen));
}

function closeSidebarPanel(panelId) {
  const panel = document.getElementById(panelId);
  if (panel) setSidebarPanelOpen(panel, false);
}

function normalizeState() {
  const before = JSON.stringify({
    groups: state.groups,
    collapsedGroups: state.collapsedGroups,
    sourceGroups: state.sources.map((source) => source.group)
  });

  state.collapsedGroups = state.collapsedGroups || {};
  const existingGroups = [...new Set((state.groups || []).map((group) => normalizeGroup(group)).filter(Boolean))];
  const fallbackGroup = existingGroups[0] || "General";

  state.sources.forEach((source) => {
    source.group = normalizeGroup(source.group) || fallbackGroup;
  });
  state.groups = [
    ...new Set([
      ...existingGroups,
      ...state.sources.map((source) => source.group)
    ])
  ];
  if (!state.groups.length) state.groups = ["General"];
  state.collapsedGroups = Object.fromEntries(
    Object.entries(state.collapsedGroups)
      .map(([group, collapsed]) => [normalizeGroup(group), Boolean(collapsed)])
      .filter(([group]) => state.groups.includes(group))
  );

  const after = JSON.stringify({
    groups: state.groups,
    collapsedGroups: state.collapsedGroups,
    sourceGroups: state.sources.map((source) => source.group)
  });
  if (before !== after) saveState();
}

function renderGroupControls() {
  const selectedSourceGroup = elements.sourceGroup.value || state.groups[0] || "General";
  const selectedFilterGroup = currentSource === "all" ? currentGroup : "all";

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

function reorderGroup(fromGroup, toGroup) {
  const from = normalizeGroup(fromGroup);
  const to = normalizeGroup(toGroup);
  if (!from || !to || from === to) return;

  const groups = state.groups.filter((group) => group !== from);
  const toIndex = groups.indexOf(to);
  if (toIndex === -1) return;

  groups.splice(toIndex, 0, from);
  state.groups = groups;
  saveState();
  render();
  setStatus(`Moved ${from} before ${to}.`);
}

function deleteGroup(groupName) {
  const group = normalizeGroup(groupName);
  if (!group) return;

  const sourceCount = state.sources.filter((source) => source.group === group).length;
  const remainingGroups = state.groups.filter((candidate) => candidate !== group);
  const fallbackGroup = remainingGroups[0] || "Ungrouped";
  const message = sourceCount
    ? `Delete group "${group}" and move ${sourceCount} source${sourceCount === 1 ? "" : "s"} to ${fallbackGroup}?`
    : `Delete empty group "${group}"?`;

  if (!window.confirm(message)) return;

  if (!remainingGroups.length) remainingGroups.push(fallbackGroup);
  state.sources.forEach((source) => {
    if (source.group === group) source.group = fallbackGroup;
  });
  state.groups = remainingGroups;
  delete state.collapsedGroups[group];

  if (currentGroup === group) currentGroup = "all";
  if (!state.sources.some((source) => source.id === currentSource)) currentSource = "all";

  saveState();
  render();
  setStatus(`${group} deleted. ${sourceCount ? `Sources moved to ${fallbackGroup}.` : ""}`);
}

function normalizeGroup(value) {
  const group = String(value || "")
    .replace(/^[\\/]+|[\\/]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return group === "." ? "" : group;
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

function unreadCountForSource(sourceId) {
  return state.posts.filter((post) => post.sourceId === sourceId && !post.read).length;
}

function isGroupCollapsed(groupName) {
  return Boolean(state.collapsedGroups?.[groupName]);
}

function setGroupCollapsed(groupName, isCollapsed) {
  state.collapsedGroups = state.collapsedGroups || {};
  const group = normalizeGroup(groupName) || "General";
  if (isCollapsed) {
    state.collapsedGroups[group] = true;
  } else {
    delete state.collapsedGroups[group];
  }
}

function displayGroupName(groupName) {
  return normalizeGroup(groupName) || "General";
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = String(value || "");
  return element.innerHTML;
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
