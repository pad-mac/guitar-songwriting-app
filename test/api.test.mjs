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

test('songs and chords: create, insert in order, edit, delete', async () => {
  const created = await call('POST', '/api/songs', { name: 'First song', tuning: STANDARD });
  assert.equal(created.status, 201);
  const id = created.body.song.id;
  assert.equal(created.body.song.name, 'First song');
  assert.ok(created.body.song.created_at > 0);

  const add = (frets, index) => call('POST', `/api/songs/${id}/chords`, { frets, root: null, index });
  await add([null, 3, 2, 0, 1, 0]);               // C
  await add([3, 2, 0, 0, 0, 3]);                  // G   → C G
  await add([null, 0, 2, 2, 1, 0], 1);            // Am at 1 → C Am G
  const r = await add([null, null, 0, 2, 3, 2], 0); // D at 0 → D C Am G
  assert.deepEqual(r.body.chords.map((c) => c.frets[5]), [2, 0, 0, 3]);
  assert.deepEqual(r.body.chords.map((c) => c.pos), [0, 1, 2, 3]);
  assert.equal(r.body.chords[0].id, r.body.chordId);

  const am = r.body.chords[2];
  const edited = await call('PATCH', `/api/chords/${am.id}`, { frets: [null, 0, 2, 2, 1, 3], root: 0 });
  assert.equal(edited.body.chords[2].root, 0);
  assert.equal(edited.body.chords[2].frets[5], 3);

  const del = await call('DELETE', `/api/chords/${r.body.chords[1].id}`);
  assert.deepEqual(del.body.chords.map((c) => c.pos), [0, 1, 2]);
  assert.equal(del.body.chords.length, 3);

  const renamed = await call('PATCH', `/api/songs/${id}`, { name: 'Renamed', tuning: { name: 'Drop D', notes: [38, 45, 50, 55, 59, 64] } });
  assert.equal(renamed.body.song.name, 'Renamed');
  assert.equal(renamed.body.song.tuning.notes[0], 38);

  const list = await call('GET', '/api/songs');
  assert.equal(list.body[0].chord_count, 3);
  assert.equal(list.body[0].preview.length, 3);

  assert.equal((await call('POST', `/api/songs/${id}/chords`, { frets: [null, null, null, null, null, null] })).status, 400);
  assert.equal((await call('POST', `/api/songs/${id}/chords`, { frets: [99, 0, 0, 0, 0, 0] })).status, 400);
  assert.equal((await call('DELETE', `/api/songs/${id}`)).status, 200);
  assert.equal((await call('GET', `/api/songs/${id}`)).status, 404);
});

test('own tunings are stored for all devices', async () => {
  const put = await call('PUT', '/api/tunings', [{ id: 'custom-a', name: 'Mine', notes: [38, 43, 50, 55, 59, 62] }]);
  assert.equal(put.status, 200);
  assert.deepEqual((await call('GET', '/api/tunings')).body, [{ id: 'custom-a', name: 'Mine', notes: [38, 43, 50, 55, 59, 62] }]);
});
