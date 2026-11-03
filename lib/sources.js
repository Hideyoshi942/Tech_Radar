// Source fetchers. Each returns an array of normalized items:
// { id, title, url, discussUrl, source, sourceLabel, author, time, points, comments, summary }

const UA = 'Mozilla/5.0 (tech-radar; +local)';
const DAY = 24 * 60 * 60 * 1000;

async function get(url, { json = false, timeoutMs = 25000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return json ? res.json() : res.text();
}

// ---------- Hacker News (Algolia) ----------
export async function fetchHackerNews(cfg, keepDays) {
  const since = Math.floor((Date.now() - keepDays * DAY) / 1000);
  const minPoints = cfg.minPoints ?? 60;
  const urls = [
    `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=1000&numericFilters=created_at_i>${since},points>=${minPoints}`,
    'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=60',
  ];
  const results = await Promise.all(urls.map((u) => get(u, { json: true })));
  const items = [];
  for (const r of results) {
    for (const h of r.hits) {
      if (!h.title) continue;
      const discussUrl = `https://news.ycombinator.com/item?id=${h.objectID}`;
      items.push({
        id: `hn:${h.objectID}`,
        title: h.title,
        url: h.url || discussUrl,
        discussUrl,
        source: 'hackernews',
        sourceLabel: 'Hacker News',
        author: h.author,
        time: h.created_at_i * 1000,
        points: h.points ?? 0,
        comments: h.num_comments ?? 0,
        summary: '',
      });
    }
  }
  return items;
}

// ---------- GitHub: fast-rising new repos ----------
export async function fetchGitHub(cfg) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const perPage = cfg.perPage ?? 40;
  const items = [];
  for (const days of [7, 30]) {
    const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
    const url = `https://api.github.com/search/repositories?q=created:>${since}&sort=stars&order=desc&per_page=${perPage}`;
    const r = await get(url, { json: true, headers });
    for (const repo of r.items) {
      items.push({
        id: `gh:${repo.full_name}`,
        title: `${repo.full_name}${repo.description ? ': ' + repo.description : ''}`,
        url: repo.html_url,
        discussUrl: repo.html_url,
        source: 'github',
        sourceLabel: 'GitHub',
        author: repo.owner?.login,
        time: new Date(repo.created_at).getTime(),
        points: repo.stargazers_count ?? 0,
        comments: 0,
        summary: [repo.language, repo.topics?.slice(0, 5).join(', ')].filter(Boolean).join(' · '),
      });
    }
  }
  return items;
}

// ---------- Lobsters ----------
export async function fetchLobsters() {
  const r = await get('https://lobste.rs/hottest.json', { json: true, timeoutMs: 40000 });
  return r.map((s) => ({
    id: `lob:${s.short_id}`,
    title: s.title,
    url: s.url || s.comments_url,
    discussUrl: s.comments_url,
    source: 'lobsters',
    sourceLabel: 'Lobsters',
    author: s.submitter_user?.username ?? s.submitter_user,
    time: new Date(s.created_at).getTime(),
    points: s.score ?? 0,
    comments: s.comment_count ?? 0,
    summary: (s.tags || []).join(', '),
  }));
}

// ---------- RSS / Atom ----------
function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function stripHtml(s) {
  return decodeEntities(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

export function parseFeed(xml) {
  const out = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const title = stripHtml(tag(b, 'title'));
    let link = stripHtml(tag(b, 'link'));
    if (!link) {
      const alt = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = alt ? decodeEntities(alt[1]) : '';
    }
    const date = stripHtml(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const desc = stripHtml(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'));
    const author = stripHtml(tag(b, 'dc:creator') || tag(tag(b, 'author'), 'name') || tag(b, 'author'));
    if (!title || !link) continue;
    out.push({ title, link, time: Date.parse(date) || Date.now(), summary: desc.slice(0, 300), author });
  }
  return out;
}

export async function fetchRss(feed) {
  const xml = await get(feed.url);
  return parseFeed(xml).map((e) => ({
    id: `rss:${feed.id}:${e.link}`,
    title: e.title,
    url: e.link,
    discussUrl: '',
    source: 'rss',
    sourceLabel: feed.label,
    author: e.author,
    time: e.time,
    points: 0,
    comments: 0,
    summary: e.summary,
  }));
}
