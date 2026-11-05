// Static mode: fetch once, then write a self-contained site to dist/ (used by GitHub Actions -> Pages).
//   dist/index.html  the dashboard (plus sw.js, manifest and icons for the installable app)
//   dist/data.json   ranked items the page reads
//   dist/store.json  raw cache; the next run downloads it so RSS history carries over
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, createRadar } from './lib/core.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const config = await loadConfig(ROOT);
const radar = await createRadar({ config, dataFile: path.join(ROOT, 'data', 'items.json') });

console.log(`[build] starting with ${radar.store.items.length} cached items`);
await radar.refresh();

const okSources = Object.values(radar.store.status).filter((s) => s.ok).length;
if (okSources === 0) {
  console.error('[build] every source failed - not publishing an empty site');
  process.exit(1);
}

await mkdir(DIST, { recursive: true });
for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png']) {
  await copyFile(path.join(ROOT, 'public', f), path.join(DIST, f));
}
await writeFile(path.join(DIST, 'data.json'), JSON.stringify(radar.payload('static')));
await writeFile(path.join(DIST, 'store.json'), JSON.stringify(radar.store));
console.log(`[build] wrote ${DIST}`);
