// Topic tagging, engagement scoring, and cross-source dedupe.

function keywordRegex(kw) {
  const prefix = kw.endsWith('*');
  const core = prefix ? kw.slice(0, -1).trim() : kw;
  const escaped = core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Short or all-caps keywords (AWS, MCP, Bun, Git) are matched case-sensitively to avoid noise.
  const caseSensitive = core.length <= 3 || core === core.toUpperCase();
  const body = prefix ? `${escaped}[\\w.-]*` : escaped;
  return new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, caseSensitive ? '' : 'i');
}

export function buildTagger(topics) {
  const compiled = topics.map((t) => ({ id: t.id, res: t.keywords.map(keywordRegex) }));
  return (item) => {
    const text = `${item.title} ${item.summary || ''}`;
    const tags = compiled.filter((t) => t.res.some((re) => re.test(text))).map((t) => t.id);
    return tags.length ? tags : ['other'];
  };
}

// One comparable engagement number per item, regardless of source.
export function engagement(item) {
  switch (item.source) {
    case 'hackernews':
      return item.points + item.comments * 0.5;
    case 'lobsters':
      return (item.points + item.comments * 0.5) * 4;
    case 'github':
      return item.points * 0.3;
    default:
      return 15; // RSS: curated feed, no engagement signal
  }
}

function urlKey(url) {
  try {
    const u = new URL(url);
    for (const p of [...u.searchParams.keys()]) if (p.startsWith('utm_') || p === 'ref') u.searchParams.delete(p);
    return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '') + u.search).toLowerCase();
  } catch {
    return url;
  }
}

// Merge items that point at the same URL; keep the most-engaged one and list the others as "also on".
export function dedupe(items) {
  const groups = new Map();
  for (const it of items) {
    const key = urlKey(it.url);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const out = [];
  for (const group of groups.values()) {
    group.sort((a, b) => engagement(b) - engagement(a));
    const [primary, ...rest] = group;
    const seen = new Set([primary.sourceLabel]);
    const also = [];
    for (const r of rest) {
      if (seen.has(r.sourceLabel)) continue;
      seen.add(r.sourceLabel);
      also.push({ label: r.sourceLabel, url: r.discussUrl || r.url, points: r.points, comments: r.comments });
    }
    const tags = [...new Set(group.flatMap((g) => g.tags || []))];
    const cleanTags = tags.length > 1 ? tags.filter((t) => t !== 'other') : tags;
    out.push({ ...primary, tags: cleanTags, also, engagement: Math.round(engagement(primary)) });
  }
  return out;
}
