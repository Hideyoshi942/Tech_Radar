// Adds a short description to items that have none, using the article's own
// <meta> description (og:description / description / twitter:description).
// Results are cached on the item (descTried), so each URL is fetched at most once.

const UA = 'Mozilla/5.0 (compatible; tech-radar/1.0; +https://github.com/Hideyoshi942/Tech_Radar)';
const MAX_BYTES = 768 * 1024;

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// Reads until <head> is closed and holds a description, or until the body has
// a usable first paragraph, capped at MAX_BYTES.
async function readPage(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  let headClosed = false;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (!headClosed && Buffer.from(value).includes('</head>')) {
      headClosed = true;
      if (extractDescription(Buffer.concat(chunks).toString('utf8'))) break;
    } else if (headClosed && firstParagraph(Buffer.concat(chunks).toString('utf8'))) {
      break;
    }
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString('utf8');
}

// Fallback for pages without a meta description: the first real paragraph of text.
export function firstParagraph(html) {
  const body = html.replace(/<(script|style|noscript|svg|nav|header|footer)[\s\S]*?<\/\1>/gi, ' ');
  for (const m of body.matchAll(/<p[\s>][\s\S]*?<\/p>/gi)) {
    const text = decode(m[0].replace(/<[^>]+>/g, ' '));
    if (text.length >= 80 && !/cookie|javascript|subscribe|sign in|log in/i.test(text)) return text;
  }
  return '';
}

export function extractDescription(html) {
  const metas = html.match(/<meta\s[^>]*>/gi) || [];
  const found = {};
  for (const m of metas) {
    const key = (m.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1]?.toLowerCase();
    const content = (m.match(/content\s*=\s*"([^"]*)"/i) || m.match(/content\s*=\s*'([^']*)'/i) || [])[1];
    if (key && content && !found[key]) found[key] = content;
  }
  const raw = found['og:description'] || found['description'] || found['twitter:description'] || '';
  return decode(raw);
}

async function describe(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok || !(res.headers.get('content-type') || '').includes('html')) {
    res.body?.cancel().catch(() => {});
    return '';
  }
  const html = await readPage(res);
  return extractDescription(html) || firstParagraph(html);
}

export function needsDescription(it) {
  return !it.descTried && !it.summary && it.source !== 'github' && /^https?:/.test(it.url) && !it.url.includes('news.ycombinator.com');
}

// Mutates items in place. Picks the most-engaged items first, at most `limit` per run.
export async function enrich(items, { limit = 300, concurrency = 8, score = () => 0 } = {}) {
  const queue = items.filter(needsDescription).sort((a, b) => score(b) - score(a)).slice(0, limit);
  let done = 0;
  let found = 0;
  async function worker() {
    while (queue.length) {
      const it = queue.shift();
      try {
        const d = await describe(it.url);
        if (d && d.toLowerCase() !== it.title.toLowerCase()) {
          it.desc = d.length > 400 ? d.slice(0, 400).replace(/\s+\S*$/, '') + '…' : d;
          found++;
        }
      } catch {
        // Unreachable, blocked or slow sites simply get no description.
      }
      it.descTried = true;
      done++;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { tried: done, found };
}
