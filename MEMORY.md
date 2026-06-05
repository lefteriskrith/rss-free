# RSS Yo Memory

This file is the project memory. Read it before making changes so the app behavior and prior decisions do not need to be re-explained.

## Working Rule

- Before making a new code change, run the full test suite with `npm test` to get a baseline.
- After each change, run `npm test` again.
- Any meaningful new feature, behavior change, limitation, or workflow decision must be added here.
- Keep this file current alongside README updates.

## App Summary

RSS Yo is a local/self-hosted personal RSS reader and RSS generator.

- Frontend: plain HTML/CSS/JavaScript in `public/`.
- Backend: Node.js + Express in `server.js`.
- Local run: `npm install`, then `npm run dev`, then open `http://localhost:5173`.
- Windows launcher: double-click `start-rss-yo.bat`; keep the terminal open while using the app.
- Persistence: browser `localStorage` under `rss-yo-state-v1`.
- No login and no database in v1.

## Core Behavior

- User can add a website URL or direct RSS/Atom feed.
- Server first tries the input URL as a direct feed.
- If that fails, server fetches the homepage and checks:
  - `<link rel="alternate">` RSS/Atom/XML feed links.
  - Common feed paths: `/feed`, `/rss`, `/rss.xml`, `/atom.xml`, `/feed.xml`.
- If no feed works, server scrapes likely article links from article/main/content areas.
- Posts are deduplicated by canonical URL.
- Feed view shows title, source, date, excerpt, original link, and read/unread state.
- Clicking a post opens the original URL in a new tab and marks it read.
- Hovering over a post marks it read.
- Scrolling past unread posts marks them read when they are sufficiently visible.
- Right-clicking a post opens actions for mark read/unread and favorite/unfavorite.
- Filters: All, Unread, Read, Favorites.
- `Refresh all` checks every saved source again and adds new posts.

## Groups

- Feedly/Inoreader OPML imports preserve folders as groups.
- User can create custom groups.
- User selects a group when adding a source.
- Existing sources can be moved to another group from the sidebar.
- Main toolbar can filter by all groups or one group.
- OPML export preserves groups.
- Groups can be reordered via drag and drop in the sidebar.
- Groups can be deleted from the sidebar; sources inside a deleted group move to another available group.
- Groups and individual sources both show unread counts in the sidebar.
- Each source shows a visible unread badge beside its title/URL.
- Clicking a group name/count filters the feed to unread posts from that group.
- The `Show`/`Hide` control is the only group expand/collapse trigger.
- `General` can be reordered and deleted like any other group; if the last group is deleted, `Ungrouped` is created as a fallback.

## Source Actions

- Each source has:
  - `Mark read`: marks all posts from that source read.
  - `Copy RSS`: copies generated RSS XML for that source.
  - `Edit`: opens a compact panel for changing group or deleting the source.

## Theme

- Light and dark themes are supported.
- Dark theme should be true black/white with a clean cyan accent, not muddy green/gray.
- Theme preference is stored in localStorage.
- App logo is `public/assets/rss-yo-logo.svg`; it is used both as the header logo and browser favicon.
- Sidebar add-source and create-group controls stay collapsed until opened to save vertical space.
- OPML import/export controls should remain compact to preserve sidebar space.

## Deployment Notes

- Double-clicking `public/index.html` alone is not enough for full functionality because `/api/discover` requires the Node server.
- Netlify static hosting can show the UI but cannot run the Express API as-is.
- Netlify support would require converting the API into Netlify Functions.
- Render/Railway/Fly/VPS can run the app as a normal Node service.

## Desktop Packaging Decision

- If the user asks to "make an exe" or "vgale mou exe", use Electron for the v1 desktop build.
- Reason: Electron best matches the current HTML/CSS/JS + Node/Express architecture and can bundle/run the local backend with fewer surprises.
- Expected v1 behavior: launching the `.exe` starts the local server automatically and opens RSS Yo in a desktop app window or local browser.
- Tauri remains a possible later optimization for a smaller/lighter app, but not the preferred first executable path.
- Desktop sync across multiple PCs is not automatic; it will require a backend account/database, shared cloud JSON file, or manual import/export.

## Known Limitations

- Scraping is best-effort.
- Sites with heavy JavaScript rendering, bot protection, paywalls, or unusual markup may not work.
- Dates and excerpts depend on feed/page markup.
- Generated RSS is copied in-browser and is not hosted as a public URL in v1.
- Data is local to the browser profile.

## Test Policy

- `npm test` is the full local test suite.
- Regression tests cover server URL/feed/article extraction helpers.
- Smoke tests cover presence of required UI controls and scripts.
- Tests should avoid live external websites so they remain deterministic.

## Change Log

- 2026-06-05: Added this project memory file and made it the source of truth for app behavior and workflow.
- 2026-06-05: Added `npm test` using Node's built-in test runner.
- 2026-06-05: Added regression tests for URL normalization, canonical URL dedupe, feed link discovery, article extraction, article heuristics, and date extraction.
- 2026-06-05: Added smoke tests for required UI controls, client behavior hooks, dark theme styles, and group styles.
- 2026-06-05: Refactored `server.js` so tests can import helpers without starting the Express server.
- 2026-06-05: Fixed URL normalization to reject non-HTTP schemes such as `ftp://`.
- 2026-06-05: Relaxed article URL skip rules so article slugs containing `rss` are not wrongly rejected.
- 2026-06-05: Made empty groups visible in the sidebar immediately after creation.
- 2026-06-05: Made sidebar group headings clickable filters with unread counts.
- 2026-06-05: Made sidebar source names clickable filters so a single source such as `in.gr` or `Unboxholics` can be viewed alone.
- 2026-06-05: Increased dark theme readability with clearer text, stronger borders, and less muddy read-state colors.
- 2026-06-05: Recorded desktop packaging decision: use Electron for first Windows `.exe` build.
- 2026-06-05: Hardened OPML import group detection for Feedly-style nested folders and `category` attributes such as `Tech` or `/Tech`.
- 2026-06-05: Changed dark theme direction to true black/white with cyan accents.
- 2026-06-05: Added localStorage group cleanup migration so blank/slash-only imported groups are removed and merged into `General`.
- 2026-06-05: Changed sidebar sources list into an expandable group tree; all groups remain visible, and sources show inside expanded groups.
- 2026-06-05: Improved OPML re-import matching so existing feeds can be moved into groups even when Feedly `xmlUrl`, saved `feedUrl`, redirects, or `www` variants differ.
- 2026-06-05: Changed OPML import flow to create/open groups and move existing sources before network refreshes, so the sidebar tree appears immediately after import.
- 2026-06-05: Indented source rows under group headings with a guide line to make the sidebar visibly tree-like.
- 2026-06-05: Fixed group names not appearing in the sidebar tree by changing HTML escaping from a `template` element to a normal `div`.
- 2026-06-05: Added sidebar drag-and-drop group reordering and group deletion, with deleted group sources moved to `General`.
- 2026-06-05: Added unread count badges beside each individual source in the sidebar tree.
- 2026-06-05: Replaced cryptic group expand/collapse arrows with explicit `Show`/`Hide` action pills.
- 2026-06-05: Split group row interactions so group name/count shows unread posts from that group, while `Show`/`Hide` only expands or collapses the group.
- 2026-06-05: Moved the group `Show`/`Hide` control to the left of the group name for clearer sidebar scanning.
- 2026-06-05: Added orange RSS-style logo asset and used it as the browser favicon and app header mark.
- 2026-06-05: Collapsed the sidebar add-source and create-group forms behind compact panel toggles; successful submit closes each panel.
- 2026-06-05: Removed special protection from `General`; it can now be reordered or deleted, with sources moved to another group or `Ungrouped` fallback.
- 2026-06-05: Made source unread counts more visible as badges and reduced OPML import/export button height.
- 2026-06-05: Rewrote README as a full GitHub project README and added `docs/screenshots/rss-yo-preview.svg` as a repository screenshot preview.
- 2026-06-05: Moved per-source group selection and delete into an `Edit` panel; source action buttons were made smaller.
- 2026-06-05: Added post right-click context menu for mark read/unread and favorite/unfavorite, plus a Favorites feed filter.
