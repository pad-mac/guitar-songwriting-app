import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, getSetting, setSetting, tx } from './db.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(root, '..', 'web');
const { version } = JSON.parse(fs.readFileSync(path.join(root, '..', 'package.json'), 'utf8'));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const APP_PASSWORD = process.env.APP_PASSWORD || '';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '256kb' }));

app.get('/healthz', (req, res) => res.json({ ok: true, version, commit: process.env.COMMIT || null }));

// ---- errors and checks --------------------------------------------------------------------

const fail = (status, message) => Object.assign(new Error(message), { status });
const bad = (what) => fail(400, `Invalid ${what}`);

function vName(v) {
  const s = String(v ?? '').trim().slice(0, 120);
  if (!s) throw bad('name');
  return s;
}
function vTuning(t) {
  if (!t || typeof t !== 'object' || !Array.isArray(t.notes)) throw bad('tuning');
  const notes = t.notes;
  if (notes.length < 4 || notes.length > 10 || !notes.every((n) => Number.isInteger(n) && n >= 12 && n <= 100)) throw bad('tuning');
  return { name: String(t.name ?? '').trim().slice(0, 60), notes };
}
function vFrets(f) {
  if (!Array.isArray(f) || f.length < 1 || f.length > 10) throw bad('frets');
  if (!f.every((x) => x === null || (Number.isInteger(x) && x >= 0 && x <= 24))) throw bad('frets');
  if (!f.some((x) => x !== null)) throw bad('frets (no notes)');
  return f;
}
function vRoot(r) {
  if (r === null || r === undefined) return null;
  if (Number.isInteger(r) && r >= 0 && r < 12) return r;
  throw bad('root');
}
const idOf = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw fail(404, 'Not found');
  return n;
};

// ---- access -------------------------------------------------------------------------------
// One password. APP_PASSWORD wins if set; otherwise the first visitor chooses it.

const COOKIE = 'chords_session';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const passwordIsSet = () => !!APP_PASSWORD || !!getSetting('passwordHash');

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function checkPassword(pw) {
  if (typeof pw !== 'string' || !pw) return false;
  if (APP_PASSWORD) return crypto.timingSafeEqual(Buffer.from(sha(pw), 'hex'), Buffer.from(sha(APP_PASSWORD), 'hex'));
  const stored = getSetting('passwordHash');
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), crypto.scryptSync(pw, salt, 32));
}
function tokenOf(req) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}
function authed(req) {
  const t = tokenOf(req);
  return !!t && !!db.prepare('SELECT 1 FROM sessions WHERE token = ?').get(sha(t));
}
function startSession(req, res) {
  const t = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token, created_at) VALUES (?, ?)').run(sha(t), Date.now());
  res.setHeader('Set-Cookie', `${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${req.secure ? '; Secure' : ''}`);
}

// failed sign-ins per address: at most 10 per 15 minutes
const failures = new Map();
function tooMany(req) {
  const f = failures.get(req.ip);
  if (f && Date.now() - f.since > 15 * 60e3) failures.delete(req.ip);
  return (failures.get(req.ip)?.count || 0) >= 10;
}
function failed(req) {
  const f = failures.get(req.ip) || { count: 0, since: Date.now() };
  f.count++;
  failures.set(req.ip, f);
}

app.get('/api/session', (req, res) => res.json({ authed: authed(req), setup: !passwordIsSet() }));

app.post('/api/setup', (req, res) => {
  if (passwordIsSet()) throw fail(409, 'The password is already set');
  const pw = req.body?.password;
  if (typeof pw !== 'string' || pw.length < 6) throw fail(400, 'Use at least 6 characters');
  setSetting('passwordHash', hashPassword(pw));
  startSession(req, res);
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  if (tooMany(req)) throw fail(429, 'Too many attempts. Try again in a few minutes.');
  if (!checkPassword(req.body?.password)) {
    failed(req);
    throw fail(401, 'Wrong password');
  }
  failures.delete(req.ip);
  startSession(req, res);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const t = tokenOf(req);
  if (t) db.prepare('DELETE FROM sessions WHERE token = ?').run(sha(t));
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: 'Not signed in' })));

// ---- songs and chords ---------------------------------------------------------------------

const now = () => Date.now();
const songOut = (s) => ({ id: s.id, name: s.name, tuning: JSON.parse(s.tuning), created_at: s.created_at, updated_at: s.updated_at });
const chordOut = (c) => ({ id: c.id, pos: c.pos, frets: JSON.parse(c.frets), root: c.root });
const chordsOf = (songId) => db.prepare('SELECT * FROM chords WHERE song_id = ? ORDER BY pos').all(songId).map(chordOut);
function songFull(id) {
  const s = db.prepare('SELECT * FROM songs WHERE id = ?').get(id);
  if (!s) throw fail(404, 'Song not found');
  return { song: songOut(s), chords: chordsOf(id) };
}
const touch = (id) => db.prepare('UPDATE songs SET updated_at = ? WHERE id = ?').run(now(), id);
const renumber = (songId) => {
  const ids = db.prepare('SELECT id FROM chords WHERE song_id = ? ORDER BY pos, id').all(songId);
  const set = db.prepare('UPDATE chords SET pos = ? WHERE id = ?');
  ids.forEach((r, i) => set.run(i, r.id));
};

app.get('/api/songs', (req, res) => {
  const songs = db.prepare('SELECT * FROM songs ORDER BY created_at DESC, id DESC').all();
  const count = db.prepare('SELECT COUNT(*) AS n FROM chords WHERE song_id = ?');
  const first = db.prepare('SELECT * FROM chords WHERE song_id = ? ORDER BY pos LIMIT 8');
  res.json(songs.map((s) => ({ ...songOut(s), chord_count: count.get(s.id).n, preview: first.all(s.id).map(chordOut) })));
});

app.post('/api/songs', (req, res) => {
  const name = req.body?.name ? vName(req.body.name) : 'New song';
  const tuning = vTuning(req.body?.tuning);
  const t = now();
  const { lastInsertRowid } = db.prepare('INSERT INTO songs (name, tuning, created_at, updated_at) VALUES (?, ?, ?, ?)').run(name, JSON.stringify(tuning), t, t);
  res.status(201).json(songFull(Number(lastInsertRowid)));
});

app.get('/api/songs/:id', (req, res) => res.json(songFull(idOf(req.params.id))));

app.patch('/api/songs/:id', (req, res) => {
  const id = idOf(req.params.id);
  songFull(id);
  if (req.body?.name !== undefined) db.prepare('UPDATE songs SET name = ? WHERE id = ?').run(vName(req.body.name), id);
  if (req.body?.tuning !== undefined) db.prepare('UPDATE songs SET tuning = ? WHERE id = ?').run(JSON.stringify(vTuning(req.body.tuning)), id);
  touch(id);
  res.json(songFull(id));
});

app.delete('/api/songs/:id', (req, res) => {
  const id = idOf(req.params.id);
  db.prepare('DELETE FROM songs WHERE id = ?').run(id);
  res.json({ ok: true });
});

// new chord at `index` (0 = first); without index, at the end
app.post('/api/songs/:id/chords', (req, res) => {
  const id = idOf(req.params.id);
  songFull(id);
  const frets = vFrets(req.body?.frets);
  const rootPc = vRoot(req.body?.root);
  const out = tx(() => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM chords WHERE song_id = ?').get(id).n;
    const raw = req.body?.index;
    const index = Number.isInteger(raw) ? Math.max(0, Math.min(n, raw)) : n;
    db.prepare('UPDATE chords SET pos = pos + 1 WHERE song_id = ? AND pos >= ?').run(id, index);
    const t = now();
    const { lastInsertRowid } = db.prepare('INSERT INTO chords (song_id, pos, frets, root, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, index, JSON.stringify(frets), rootPc, t, t);
    touch(id);
    return { ...songFull(id), chordId: Number(lastInsertRowid) };
  });
  res.status(201).json(out);
});

app.patch('/api/chords/:id', (req, res) => {
  const id = idOf(req.params.id);
  const c = db.prepare('SELECT * FROM chords WHERE id = ?').get(id);
  if (!c) throw fail(404, 'Chord not found');
  const frets = req.body?.frets !== undefined ? JSON.stringify(vFrets(req.body.frets)) : c.frets;
  const rootPc = req.body?.root !== undefined ? vRoot(req.body.root) : c.root;
  db.prepare('UPDATE chords SET frets = ?, root = ?, updated_at = ? WHERE id = ?').run(frets, rootPc, now(), id);
  touch(c.song_id);
  res.json({ ...songFull(c.song_id), chordId: id });
});

app.delete('/api/chords/:id', (req, res) => {
  const id = idOf(req.params.id);
  const c = db.prepare('SELECT * FROM chords WHERE id = ?').get(id);
  if (!c) throw fail(404, 'Chord not found');
  tx(() => {
    db.prepare('DELETE FROM chords WHERE id = ?').run(id);
    renumber(c.song_id);
    touch(c.song_id);
  });
  res.json(songFull(c.song_id));
});

// own tunings, shared by all devices
app.get('/api/tunings', (req, res) => res.json(JSON.parse(getSetting('tunings') || '[]')));
app.put('/api/tunings', (req, res) => {
  const list = req.body;
  if (!Array.isArray(list) || list.length > 100) throw bad('tunings');
  const clean = list.map((t) => ({ id: String(t?.id || '').slice(0, 40) || 'custom-' + crypto.randomBytes(4).toString('hex'), ...vTuning(t) }));
  setSetting('tunings', JSON.stringify(clean));
  res.json(clean);
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---- the app itself -----------------------------------------------------------------------
// No build step and no hashed file names, so every file is revalidated (ETag) on each load:
// an update reaches the phone on the next open instead of hiding behind a cache.
app.use(express.static(webDir, {
  etag: true,
  lastModified: true,
  setHeaders(res, file) {
    if (/\.(png|woff2)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=604800');
    else res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.use((req, res) => res.status(404).type('text/plain').send('Not found'));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : err.type === 'entity.parse.failed' ? 400 : 500;
  if (status >= 500) console.error('[error]', req.method, req.path, err);
  res.status(status).json({ error: status >= 500 ? 'Server error' : err.message });
});

const server = app.listen(PORT, HOST, () => console.log(`Chords ${version} on http://${HOST}:${PORT}`));
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
