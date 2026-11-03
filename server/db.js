// SQLite through Node's built-in node:sqlite (no native module to build).
// Everything lives in DATA_DIR/chords.db.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const dataDir = process.env.DATA_DIR || path.join(here, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'chords.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    tuning TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chords (
    id INTEGER PRIMARY KEY,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL,
    frets TEXT NOT NULL,
    root INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chords_by_song ON chords (song_id, pos);
`);

// ---- schema upgrades (each runs once; existing rows keep their data) ----------------------
const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
// 0.3: the chords table holds both chords and named sections; chords in the Unsorted
// folder carry their own tuning; one song row is the Unsorted folder itself.
if (!columns('chords').includes('kind')) {
  db.exec(`
    ALTER TABLE chords ADD COLUMN kind TEXT NOT NULL DEFAULT 'chord';
    ALTER TABLE chords ADD COLUMN label TEXT;
    ALTER TABLE chords ADD COLUMN tuning TEXT;
  `);
}
if (!columns('songs').includes('kind')) db.exec(`ALTER TABLE songs ADD COLUMN kind TEXT NOT NULL DEFAULT 'song';`);
if (!db.prepare(`SELECT 1 FROM songs WHERE kind = 'inbox'`).get()) {
  const t = Date.now();
  db.prepare(`INSERT INTO songs (name, tuning, created_at, updated_at, kind) VALUES (?, ?, ?, ?, 'inbox')`)
    .run('Unsorted', JSON.stringify({ name: 'Standard', notes: [40, 45, 50, 55, 59, 64] }), t, t);
}

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
