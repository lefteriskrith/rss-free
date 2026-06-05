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
- Filters: All, Unread, Read.
- `Refresh all` checks every saved source again and adds new posts.

## Groups

- Feedly/Inoreader OPML imports preserve folders as groups.
- User can create custom groups.
- User selects a group when adding a source.
- Existing sources can be moved to another group from the sidebar.
- Main toolbar can filter by all groups or one group.
- OPML export preserves groups.

## Source Actions

- Each source has:
  - `Mark read`: marks all posts from that source read.
  - `Copy RSS`: copies generated RSS XML for that source.
  - Group selector: moves the source to another group.
  - `Remove`: removes the source and its posts.

## Theme

- Light and dark themes are supported.
- Dark theme should stay soft and readable, not high-contrast black/white.
- Theme preference is stored in localStorage.

## Deployment Notes

- Double-clicking `public/index.html` alone is not enough for full functionality because `/api/discover` requires the Node server.
- Netlify static hosting can show the UI but cannot run the Express API as-is.
- Netlify support would require converting the API into Netlify Functions.
- Render/Railway/Fly/VPS can run the app as a normal Node service.

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
