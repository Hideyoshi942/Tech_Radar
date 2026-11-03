// Shared fetch/store logic used by both the local server and the static build.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fetchHackerNews, fetchGitHub, fetchLobsters, fetchRss } from './sources.js';
import { buildTagger, dedupe } from './rank.js';

const DAY = 24 * 60 * 60 * 1000;

export async function loadConfig(root) {
  return JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));
}

export async function createRadar({ config, dataFile }) {
  let store = { updatedAt: null, items: [], status: {} };
  if (existsSync(dataFile)) {
    try {
      const saved = JSON.parse(await readFile(dataFile, 'utf8'));
      if (Array.isArray(saved.items)) store = saved;
    } catch (e) {
      console.warn('Could not read cache, starting fresh:', e.message);
    }
  }

  function jobs() {
    const s = config.sources;
    const list = [];
    if (s.hackernews?.enabled) list.push(['Hacker News', () => fetchHackerNews(s.hackernews, config.keepDays)]);
    if (s.github?.enabled) list.push(['GitHub', () => fetchGitHub(s.github)]);
    if (s.lobsters?.enabled) list.push(['Lobsters', () => fetchLobsters()]);
    if (s.rss?.enabled) for (const f of s.rss.feeds) list.push([f.label, () => fetchRss(f)]);
    return list;
  }

  let refreshing = null;

  function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const started = Date.now();
      const tagger = buildTagger(config.topics);
      const byId = new Map(store.items.map((it) => [it.id, it]));
      const status = {};
      const list = jobs();
      const results = await Promise.allSettled(list.map(([, fn]) => fn()));
      results.forEach((r, i) => {
        const label = list[i][0];
        if (r.status === 'fulfilled') {
          for (const it of r.value) byId.set(it.id, it);
          status[label] = { ok: true, count: r.value.length };
        } else {
          status[label] = { ok: false, error: String(r.reason?.message || r.reason) };
        }
      });
      const cutoff = Date.now() - config.keepDays * DAY;
      // Re-tag everything, so keyword edits in config.json apply to cached items too.
      const items = [...byId.values()].filter((it) => it.time >= cutoff).map((it) => ({ ...it, tags: tagger(it) }));
      store = { updatedAt: new Date().toISOString(), items, status };
      await mkdir(path.dirname(dataFile), { recursive: true });
      await writeFile(dataFile, JSON.stringify(store));
      const ok = Object.values(status).filter((s) => s.ok).length;
      console.log(`[refresh] ${items.length} items, ${ok}/${list.length} sources ok, ${((Date.now() - started) / 1000).toFixed(1)}s`);
      for (const [label, s] of Object.entries(status)) if (!s.ok) console.log(`  ! ${label}: ${s.error}`);
      return store;
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  function payload(mode) {
    return {
      mode,
      updatedAt: store.updatedAt,
      refreshing: Boolean(refreshing),
      status: store.status,
      topics: [...config.topics.map((t) => ({ id: t.id, label: t.label })), { id: 'other', label: 'Other' }],
      items: dedupe(store.items),
    };
  }

  return {
    refresh,
    payload,
    get store() {
      return store;
    },
    isStale: () => !store.updatedAt || Date.now() - Date.parse(store.updatedAt) > config.refreshMinutes * 60 * 1000,
  };
}
