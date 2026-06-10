# Signalboard

A static, modern Hacker News reader for the public HN Firebase API.

## Features

- Top, new, best, Ask HN, and Show HN feeds
- First 30 stories loaded from the official API
- Top five story cards enriched with article images when metadata is available
- Comment-focused drawer with nested threads and load-more behavior
- Filtering and sorting by HN rank, score, comments, or time
- No build step and no backend required

## Run Locally

Open `index.html` directly, or serve the folder with any static file server:

```sh
python3 -m http.server 8000
```

Then visit `http://127.0.0.1:8000`.

## Free Hosting

This is a static site, so it can be hosted for free on:

- GitHub Pages
- Netlify
- Cloudflare Pages
- Vercel

For GitHub Pages, push this folder to a GitHub repository, then enable Pages from the repository settings and select the branch root as the source.

## Data

Stories and comments come from the official Hacker News API:

`https://hacker-news.firebaseio.com/v0/`

Article images are detected from the first five article URLs using direct image URL checks first, then public page metadata via Microlink. Some publishers block metadata extraction, so those cards fall back to generated initials.
