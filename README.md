# Tech Radar

A local dashboard that collects software/tech news on its own and ranks it by topic.

- **Sources:** Hacker News (Algolia API), GitHub (fast-rising new repos), Lobsters, and RSS feeds (The New Stack, InfoQ, DEV, AWS What's New, AWS News Blog, GitHub Changelog, Spring, Martin Fowler).
- **Refresh:** on start (if the cache is older than `refreshMinutes`), then every 2 hours, or with the **Refresh now** button.
- **Storage:** `data/items.json`, rolling 30-day window. RSS history builds up over time.
- **No dependencies:** Node 24+ only, nothing to `npm install`.

## Run

```bash
npm start            # http://localhost:4321
npm run fetch        # fetch once and exit (for a scheduled task)
```

`--use-env-proxy` (set in the npm scripts) makes `fetch` honour `HTTPS_PROXY`, which this office network needs.
Optional: set `GITHUB_TOKEN` for a higher GitHub API rate limit.

## Deploy: GitHub Actions + Pages (auto-updating, free)

`.github/workflows/deploy.yml` runs `build.js` every 2 hours (and on every push to `main`, or manually via **Actions → Run workflow**). It:

1. downloads `store.json` from the live site, so the 30-day history carries over between runs,
2. fetches every source and writes `dist/` (`index.html`, `data.json`, `store.json`),
3. publishes `dist/` to GitHub Pages.

There are no data commits. The repo only holds code. The same `index.html` detects static mode, hides the Refresh button, and reads `data.json`.

One-time setup:

1. Create a **public** GitHub repo (Pages on a free plan needs public) and push this folder to `main`.
2. In the repo, go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Open **Actions → Build and deploy Tech Radar → Run workflow** for the first deploy. The site URL appears in the run summary (`https://<user>.github.io/<repo>/`).

Notes:

- GitHub pauses scheduled workflows after 60 days with no repo activity. Re-enable them in the Actions tab, or push any commit.
- Cron runs can start a few minutes late when GitHub is busy.
- Build locally with `npm run build`, which writes `dist/`.

## Customize (`config.json`)

- `topics[].keywords`: a matching keyword tags the item. `foo*` = prefix match. Short or ALL-CAPS keywords (`AWS`, `MCP`, `Bun`) are case-sensitive.
- `sources.rss.feeds`: add or remove feeds (`id`, `label`, `url`).
- `sources.hackernews.minPoints`: the threshold for HN stories in the 30-day window.
- Restart the server after editing. Cached items are re-tagged on the next refresh.

## Ranking

- One engagement number per item: HN = points + comments/2. Lobsters = the same × 4 (smaller community). GitHub = stars × 0.3. RSS = flat 15.
- **Hot** = (engagement + 5) / (age in hours + 2)^1.2. **Top** = raw engagement. **New** = time.
- Items with the same URL across sources are merged and shown as "also on …".
- "All topics" hides untagged items. They stay under **Other**.

## Not included (yet)

- Reddit: blocked on this network (403).
- X/YouTube: they need credentials or yt-dlp.
- LLM summaries/digests: no API key on this machine. A daily digest with the Claude API is the natural next step.
