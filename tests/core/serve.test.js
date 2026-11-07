// Entwicklungsserver: Weiterleitung auf die App, kaputte URLs, Pfad-Ausbruch, nur localhost.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { start } from '../../scripts/serve.js';

let server;
before(async () => { server = await start(0); });
after(() => server.close());

// roher Pfad: fetch/URL würden '..' schon im Client wegnormalisieren
const get = (path) => new Promise((resolve, reject) => {
  const { address, port } = server.address();
  request({ host: address, port, path }, (res) => {
    res.resume();
    res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location }));
  }).on('error', reject).end();
});

test('lauscht nur auf der Loopback-Adresse', () => {
  assert.ok(['127.0.0.1', '::1'].includes(server.address().address), server.address().address);
});

test('/, /ui und /ui/ leiten auf /ui/index.html weiter', async () => {
  for (const path of ['/', '/ui', '/ui/']) assert.deepEqual(await get(path), { status: 302, location: '/ui/index.html' }, path);
});

test('App-Seite und Module werden ausgeliefert', async () => {
  assert.equal((await get('/ui/index.html')).status, 200);
  assert.equal((await get('/index.js')).status, 200);
});

test('kaputte Prozent-Kodierung ergibt 400, der Server läuft weiter', async () => {
  assert.equal((await get('/%E0%A4%A')).status, 400);
  assert.equal((await get('/ui/index.html')).status, 200);
});

test('Pfad-Ausbruch aus src/ wird abgelehnt', async () => {
  for (const path of ['/../package.json', '/..%2fpackage.json', '/..%5cpackage.json', '/%2e%2e/package.json']) {
    assert.ok([403, 404].includes((await get(path)).status), path);
  }
  assert.equal((await get('/..%2fpackage.json')).status, 403);
});
