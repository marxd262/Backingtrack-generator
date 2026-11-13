// Winziger statischer Server für src/ (npm start, Playwright webServer). Lauscht nur auf localhost.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('../src', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2' };
const APP = '/ui/index.html';
const REDIRECTS = new Set(['/', '/ui', '/ui/']);

async function handle(req, res) {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (REDIRECTS.has(path)) { res.writeHead(302, { location: APP }).end(); return; }
  const file = join(root, path);
  const rel = relative(root, file);
  // auch dekodierte \ und / zählen: alles, was über src/ hinausführt, ist verboten
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

/** Startet den Server auf localhost; Port 0 wählt einen freien Port. Liefert den laufenden Server. */
export function start(port = 4173) {
  const server = createServer(handle);
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, 'localhost', () => done(server));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await start();
  console.log(`http://localhost:${server.address().port}${APP}`);
}
