# RSS Yo

RSS Yo is a small self-hosted web app for following RSS feeds and regular websites from one clean local reader. It tries RSS/Atom first, falls back to simple article-link extraction, stores your data in `localStorage`, and can generate RSS XML from discovered posts.

## Features

- Add website or feed URLs.
- Detect RSS/Atom through common feed paths and homepage `<link rel="alternate">` tags.
- Scrape likely article links when a site has no feed.
- Feed view with title, source, date, excerpt, original link, and read/unread state.
- Filters for All, Unread, and Read.
- Refresh all sources and deduplicate newly discovered posts by canonical URL.
- Automatically mark unread posts as read when they pass through the reading view.
- Mark posts as read on mouse hover.
- Mark all posts from a single source as read.
- Toggle between light and dark theme.
- Import OPML from readers such as Feedly or Inoreader.
- Preserve OPML folders as groups, create your own groups, and filter the feed by group.
- Export current sources as grouped OPML.
- Copy generated RSS XML for any followed source.

## Setup

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:5173
```

On Windows, you can also double-click `start-rss-yo.bat`. It installs dependencies if needed, starts the server, and opens the app in your browser. Keep that terminal window open while using RSS Yo.

You can change the port with:

```bash
PORT=3000 npm run dev
```

On PowerShell:

```powershell
$env:PORT=3000; npm run dev
```

## How It Works

The frontend is plain HTML, CSS, and JavaScript in `public/`. The Node/Express server in `server.js` acts as a local fetcher and parser so the browser does not need to fetch third-party sites directly.

When you add or refresh a source, the server:

1. Fetches the homepage.
2. Looks for RSS/Atom alternate links.
3. Tries common feed locations: `/feed`, `/rss`, `/rss.xml`, `/atom.xml`, `/feed.xml`.
4. Parses a discovered feed with `rss-parser`.
5. If no feed works, extracts likely article links from article/main/content areas with `cheerio`.

The browser stores sources, posts, and read/unread state in `localStorage` under `rss-yo-state-v1`.

## Limitations

- Scraping is best-effort. Sites with heavy JavaScript rendering, unusual markup, paywalls, or bot protection may return few or no posts.
- Dates and excerpts are only shown when feeds or page markup provide enough information.
- The local server avoids browser CORS problems, but remote sites can still block server-side requests.
- Generated RSS is copied as XML in the browser. It is not hosted at a public URL in this first version.
- Data is local to the browser profile. Clearing site data will remove saved sources and read state.
