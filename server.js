// Local mode: serves the dashboard and refreshes on a timer.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, createRadar } from './lib/core.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const config = await loadConfig(ROOT);
const radar = await createRadar({ config, dataFile: path.join(ROOT, 'data', 'items.json') });

if (process.argv.includes('--fetch-only')) {
  await radar.refresh();
  process.exit(0);
}

// PWA files served as-is from public/ (icons are binary, so no utf8 decoding).
const PWA_FILES = {
  '/sw.js': 'text/javascript; charset=utf-8',
  '/manifest.webmanifest': 'application/manifest+json',
  '/icon.svg': 'image/svg+xml',
  '/icon-192.png': 'image/png',
  '/icon-512.png': 'image/png',
};

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, await readFile(path.join(ROOT, 'public', 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && PWA_FILES[url.pathname]) {
      return send(res, 200, await readFile(path.join(ROOT, 'public', url.pathname.slice(1))), PWA_FILES[url.pathname]);
    }
    if (req.method === 'GET' && (url.pathname === '/data.json' || url.pathname === '/api/items')) {
      return send(res, 200, radar.payload('server'));
    }
    if (req.method === 'POST' && url.pathname === '/api/refresh') {
      await radar.refresh();
      return send(res, 200, radar.payload('server'));
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

const port = Number(process.env.PORT) || config.port;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use - Tech Radar (or another app) is probably already running.`);
    console.error(`Open http://localhost:${port}, stop the other process, or start on another port: $env:PORT=4322; npm start`);
    process.exit(1);
  }
  throw e;
});
server.listen(port, () => console.log(`Tech Radar running at http://localhost:${port}`));

if (radar.isStale()) radar.refresh();
setInterval(radar.refresh, config.refreshMinutes * 60 * 1000);
