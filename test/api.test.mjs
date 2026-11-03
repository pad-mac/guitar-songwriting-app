import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chords-test-'));
let server;
let cookie = '';

async function call(method, url, body, { auth = true } = {}) {
  const r = await fetch(BASE + url, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(auth && cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = r.headers.get('set-cookie');
  if (set && auth) cookie = set.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null) };
}

before(async () => {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, APP_PASSWORD: '' },
    stdio: 'pipe',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/healthz')).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => { server.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const STANDARD = { name: 'Standard', notes: [40, 45, 50, 55, 59, 64] };

test('password: first visit sets it, then sign-in is needed', async () => {
  assert.deepEqual((await call('GET', '/api/session', null, { auth: false })).body, { authed: false, setup: true });
  assert.equal((await call('GET', '/api/songs', null, { auth: false })).status, 401);
  assert.equal((await call('POST', '/api/setup', { password: '123' })).status, 400);
  assert.equal((await call('POST', '/api/setup', { password: 'secret-pw' })).status, 200);
  assert.deepEqual((await call('GET', '/api/session')).body, { authed: true, setup: false });
  assert.equal((await call('POST', '/api/setup', { password: 'another-pw' }, { auth: false })).status, 409);
  assert.equal((await call('POST', '/api/login', { password: 'wrong' }, { auth: false })).status, 401);
  const saved = cookie;
  cookie = '';
  assert.equal((await call('POST', '/api/login', { password: 'secret-pw' })).status, 200);
  assert.notEqual(cookie, saved);
});

test('songs: chords and sections in order, edit, reorder, delete', async () => {
  const created = await call('POST', '/api/songs', { name: 'First song', tuning: STANDARD });
  assert.equal(created.status, 201);
  const id = created.body.song.id;
  assert.equal(created.body.song.kind, 'song');

  const add = (frets, index) => call('POST', `/api/songs/${id}/items`, { frets, root: null, index });
  await add([null, 3, 2, 0, 1, 0]);               // C
  await add([3, 2, 0, 0, 0, 3]);                  // G   → C G
  await add([null, 0, 2, 2, 1, 0], 1);            // Am at 1 → C Am G
  const sec = await call('POST', `/api/songs/${id}/items`, { kind: 'section', label: 'Chorus', index: 0 });
  const items = sec.body.items;
  assert.deepEqual(items.map((c) => c.kind), ['section', 'chord', 'chord', 'chord']);
  assert.equal(items[0].label, 'Chorus');
  assert.deepEqual(items.map((c) => c.pos), [0, 1, 2, 3]);

  const renamed = await call('PATCH', `/api/items/${items[0].id}`, { label: 'Verse' });
  assert.equal(renamed.body.items[0].label, 'Verse');
  const edited = await call('PATCH', `/api/items/${items[2].id}`, { frets: [null, 0, 2, 2, 1, 3], root: 0 });
  assert.equal(edited.body.items[2].root, 0);

  // reorder: G, Verse, C, Am
  const order = [items[3].id, items[0].id, items[1].id, items[2].id];
  const re = await call('PUT', `/api/songs/${id}/order`, { ids: order });
  assert.deepEqual(re.body.items.map((c) => c.id), order);
  assert.equal((await call('PUT', `/api/songs/${id}/order`, { ids: order.slice(1) })).status, 400);

  const del = await call('DELETE', `/api/items/${items[0].id}`);
  assert.deepEqual(del.body.items.map((c) => c.pos), [0, 1, 2]);

  const list = await call('GET', '/api/songs');
  assert.equal(list.body[0].kind, 'inbox');
  const mine = list.body.find((s) => s.id === id);
  assert.equal(mine.chord_count, 3);

  assert.equal((await call('POST', `/api/songs/${id}/items`, { frets: [null, null, null, null, null, null] })).status, 400);
  assert.equal((await call('DELETE', `/api/songs/${id}`)).status, 200);
  assert.equal((await call('GET', `/api/songs/${id}`)).status, 404);
});

test("Unsorted: always first, keeps each chord's tuning, cannot be deleted; moving chords", async () => {
  const inbox = (await call('GET', '/api/songs')).body[0];
  assert.equal(inbox.kind, 'inbox');
  assert.equal(inbox.name, 'Unsorted');
  const dropD = { name: 'Drop D', notes: [38, 45, 50, 55, 59, 64] };
  const r = await call('POST', `/api/songs/${inbox.id}/items`, { frets: [0, 0, 0, 2, 3, 2], root: null, tuning: dropD });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.items.at(-1).tuning, dropD);
  assert.equal((await call('POST', `/api/songs/${inbox.id}/items`, { frets: [0, 0, 0, 2, 3, 2] })).status, 400);
  assert.equal((await call('DELETE', `/api/songs/${inbox.id}`)).status, 400);
  assert.equal((await call('PATCH', `/api/songs/${inbox.id}`, { tuning: STANDARD })).status, 400);

  const song = (await call('POST', '/api/songs', { name: 'Target', tuning: STANDARD })).body.song;
  const chordId = r.body.itemId;
  const moved = await call('POST', `/api/items/${chordId}/move`, { songId: song.id });
  assert.ok(!moved.body.items.some((c) => c.id === chordId));
  const target = (await call('GET', `/api/songs/${song.id}`)).body;
  assert.equal(target.items[0].id, chordId);
  assert.equal(target.items[0].tuning, null);
  // and back: it takes the song's tuning along
  await call('POST', `/api/items/${chordId}/move`, { songId: inbox.id });
  const back = (await call('GET', `/api/songs/${inbox.id}`)).body;
  assert.deepEqual(back.items.find((c) => c.id === chordId).tuning, STANDARD);
});

test('own tunings are stored for all devices', async () => {
  const put = await call('PUT', '/api/tunings', [{ id: 'custom-a', name: 'Mine', notes: [38, 43, 50, 55, 59, 62] }]);
  assert.equal(put.status, 200);
  assert.deepEqual((await call('GET', '/api/tunings')).body, [{ id: 'custom-a', name: 'Mine', notes: [38, 43, 50, 55, 59, 62] }]);
});
