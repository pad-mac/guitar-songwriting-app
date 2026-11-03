import { api, whenSignedOut } from './api.js';
import { createAnalyzer } from './analyzer.js';
import { PRESETS } from './tunings.js';
import { noteName } from './chords.js';
import { chordDiagram, chosenName } from './chordcard.js';
import { openTuningSheet, sheetOpen, closeSheet } from './tuningsheet.js';
import { sortable } from './sortable.js';
import { $, h, svgIcon, ICON, chordHTML, formatDate, toast, ask, menu, inlineEdit } from './ui.js';

const STANDARD = { name: PRESETS[0].name, notes: [...PRESETS[0].notes] };
const SCRATCH_KEY = 'gsa:scratch';

const S = {
  authed: false,
  setup: false,
  custom: [],          // own tunings (server)
  song: null,          // { song, items } of the open song; items = chords and sections, in order
  ctx: null,           // analyzer: { mode: 'scratch' } | { mode: 'song', songId, chordId|null, at, base }
  view: null,
  hash: '',
  scroll: {},
  skipGuard: false,
  renameNext: false,
};

const A = createAnalyzer({ onChange: analyzerChanged });

$('songBack').append(svgIcon(ICON.back));
$('aBack').append(svgIcon(ICON.back));
$('newSong').append(svgIcon(ICON.plus));
$('addChord').append(svgIcon(ICON.plus));
$('deleteChord').append(svgIcon(ICON.trash));

const sameNotes = (a, b) => !!a && !!b && a.notes.length === b.notes.length && a.notes.every((n, i) => n === b.notes[i]);
const tuningLabel = (t) => t.name || t.notes.map(noteName).join(' ');
const isInbox = (song) => song?.kind === 'inbox';
const countText = (n) => `${n} chord${n === 1 ? '' : 's'}`;

// ---- views and routes ---------------------------------------------------------------------
// #/                       songs
// #/analyzer               free analyzer (not tied to a song)
// #/song/ID                one song (or Unsorted)
// #/song/ID/chord/CID      a saved chord in the analyzer
// #/song/ID/new/AT         a new chord that will go in at position AT of the song's list

function show(name) {
  if (S.view === 'songs' || S.view === 'song') S.scroll[S.view] = window.scrollY;
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== 'v-' + name;
  document.body.dataset.view = name;
  const was = S.view;
  S.view = name;
  if (name !== 'analyzer') S.ctx = null;
  if (name === 'analyzer') A.layout();
  if (name === 'songs' || name === 'song') window.scrollTo(0, was === 'analyzer' && name === 'song' ? S.scroll.song || 0 : 0);
}

function navigate(hash, { replace = false } = {}) {
  if (location.hash !== hash) {
    if (replace) history.replaceState({ prev: history.state?.prev ?? null }, '', hash);
    else history.pushState({ prev: location.hash || '#/' }, '', hash);
  }
  return route();
}
// going up a level: step back in history when that is where we came from
function up(hash) {
  if (history.state?.prev === hash) { S.skipGuard = true; history.back(); }
  else navigate(hash);
}

async function route() {
  const hash = location.hash || '#/';
  S.hash = hash;
  if (!S.authed) return showLogin();
  const p = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (p[0] === 'analyzer') return openScratch();
    if (p[0] === 'song' && p[1]) {
      const id = Number(p[1]);
      if (p[2] === 'chord') return await openChord(id, Number(p[3]));
      if (p[2] === 'new') return await openDraft(id, Number(p[3]));
      return await showSong(id);
    }
    return await showSongs();
  } catch (e) {
    toast(e.message);
    if (p.length && S.authed) navigate('#/', { replace: true });
  }
}

window.addEventListener('popstate', async () => {
  if (!S.skipGuard && S.view === 'analyzer' && isDirty()) {
    const target = location.hash;
    history.pushState({ prev: null }, '', S.hash);
    if (!(await guard())) return;
    history.replaceState({ prev: null }, '', target);
  }
  S.skipGuard = false;
  route();
});
window.addEventListener('beforeunload', (e) => { if (isDirty()) e.preventDefault(); });

// ---- sign in ------------------------------------------------------------------------------

function showLogin(message = '') {
  show('login');
  $('loginText').textContent = S.setup
    ? 'Choose a password for this app. You will use it once on each device.'
    : 'Sign in to see your songs.';
  $('pw2').hidden = !S.setup;
  $('pw2').required = S.setup;
  $('pw').autocomplete = S.setup ? 'new-password' : 'current-password';
  $('loginBtn').textContent = S.setup ? 'Set password' : 'Sign in';
  $('loginErr').textContent = message;
  setTimeout(() => $('pw').focus(), 50);
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('pw').value;
  $('loginErr').textContent = '';
  try {
    if (S.setup) {
      if (pw !== $('pw2').value) throw new Error('The two passwords differ');
      await api('POST', '/setup', { password: pw });
    } else {
      await api('POST', '/login', { password: pw });
    }
    $('pw').value = $('pw2').value = '';
    S.authed = true;
    S.setup = false;
    await afterSignIn();
    route();
  } catch (err) {
    $('loginErr').textContent = err.message;
  }
});

whenSignedOut(() => {
  if (!S.authed) return;
  S.authed = false;
  showLogin('Please sign in again.');
});

async function afterSignIn() {
  S.custom = await api('GET', '/tunings').catch(() => []);
  await migrateLocal();
}

// tunings and the last chord from version 0.1, which kept everything in the browser
async function migrateLocal() {
  try {
    const old = JSON.parse(localStorage.getItem('gsa:v1') || 'null');
    if (!old) return;
    const custom = Array.isArray(old.custom) ? old.custom : [];
    if (custom.length && !S.custom.length) S.custom = await api('PUT', '/tunings', custom.map(({ id, name, notes }) => ({ id, name, notes })));
    if (!localStorage.getItem(SCRATCH_KEY)) {
      const t = [...PRESETS, ...custom].find((x) => x.id === old.tuningId) || PRESETS[0];
      localStorage.setItem(SCRATCH_KEY, JSON.stringify({ tuning: { name: t.name, notes: t.notes }, frets: old.frets, root: old.pinned ? old.root : null }));
    }
    localStorage.removeItem('gsa:v1');
  } catch { /* nothing to carry over */ }
}

const saveCustom = async (list) => {
  try { S.custom = await api('PUT', '/tunings', list); } catch (e) { toast(e.message); }
};

// ---- songs list ---------------------------------------------------------------------------

const TRAY = 'M4 13h4l1.5 2.5h5L16 13h4M4 13l2.2-7h11.6L20 13v5H4v-5z';

async function showSongs() {
  const songs = await api('GET', '/songs');
  const list = $('songList');
  list.replaceChildren(...songs.map((s) => {
    const inbox = isInbox(s);
    const name = h('span', { className: 'song-name', textContent: s.name });
    const preview = s.preview.map((c) => chosenName(c.frets, (inbox ? c.tuning : s.tuning)?.notes || STANDARD.notes, c.root)?.text).filter(Boolean);
    const meta = inbox
      ? `${countText(s.chord_count)} saved without a song`
      : `${formatDate(s.created_at)} · ${countText(s.chord_count)}`;
    const main = h('div', { className: 'song-main', tabIndex: 0, role: 'link' },
      inbox ? h('span', { className: 'song-name-row' }, svgIcon(TRAY, 'tray'), name) : name,
      h('span', { className: 'song-meta', textContent: meta }),
      preview.length ? h('span', { className: 'song-preview', textContent: preview.join('  ·  ') + (s.chord_count > preview.length ? '  ·  …' : '') }) : null);
    const openIt = (e) => { if (!e.target.closest('input')) navigate(`#/song/${s.id}`); };
    main.addEventListener('click', openIt);
    main.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === main) openIt(e); });
    const row = h('li', { className: 'song-row' + (inbox ? ' inbox-row' : '') }, main);
    if (!inbox) {
      row.dataset.id = s.id;
      const rename = h('button', { type: 'button', className: 'icon-only', ariaLabel: 'Rename', title: 'Rename' }, svgIcon(ICON.pencil));
      rename.addEventListener('click', () => renameInList(s, name));
      row.append(rename);
      row._song = s;
      row._name = name;
    }
    return row;
  }));
  $('songsEmpty').hidden = songs.length > 1;
  show('songs');
}

function renameInList(s, nameEl) {
  inlineEdit(nameEl, s.name, async (v) => {
    try { await api('PATCH', `/songs/${s.id}`, { name: v }); s.name = v; nameEl.textContent = v; } catch (e) { toast(e.message); }
  });
}

sortable($('songList'), {
  items: '.song-row[data-id]',
  async onMenu(row) {
    const s = row._song;
    const v = await menu({ title: s.name, items: [{ label: 'Rename', value: 'rename' }, { label: 'Delete song', value: 'delete', kind: 'danger' }] });
    if (v === 'rename') renameInList(s, row._name);
    if (v === 'delete') {
      const ok = await ask({
        title: `Delete “${s.name}”?`,
        text: s.chord_count ? `Its ${countText(s.chord_count)} go with it. This can't be undone.` : "This can't be undone.",
        buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, kind: 'danger-fill' }],
      });
      if (!ok) return;
      try { await api('DELETE', `/songs/${s.id}`); showSongs(); } catch (e) { toast(e.message); }
    }
  },
});

$('newSong').addEventListener('click', async () => {
  try {
    const { song } = await api('POST', '/songs', { name: 'New song', tuning: STANDARD });
    S.renameNext = true;
    navigate(`#/song/${song.id}`);
  } catch (e) { toast(e.message); }
});
$('openScratch').addEventListener('click', () => navigate('#/analyzer'));

// ---- one song -----------------------------------------------------------------------------

async function loadSong(id, { fresh = false } = {}) {
  if (fresh || !S.song || S.song.song.id !== id) S.song = await api('GET', `/songs/${id}`);
  return S.song;
}
const chordsOf = () => S.song.items.filter((i) => i.kind === 'chord');
const tuningOf = (item) => (isInbox(S.song.song) ? item?.tuning : S.song.song.tuning) || STANDARD;

async function showSong(id) {
  await loadSong(id, { fresh: true });
  renderSong();
  show('song');
  if (S.renameNext) { S.renameNext = false; renameSong(); }
}

function renderSong() {
  const { song, items } = S.song;
  const inbox = isInbox(song);
  const n = items.filter((i) => i.kind === 'chord').length;
  $('songTitle').textContent = song.name;
  $('songTitle').classList.toggle('editable', !inbox);
  $('songMeta').textContent = inbox
    ? `${countText(n)} saved from the analyzer · each keeps its own tuning`
    : `Created ${formatDate(song.created_at)} · ${countText(n)}`;
  const tb = $('songTuning');
  tb.hidden = inbox;
  tb.querySelector('.tn').textContent = song.tuning.notes.map(noteName).join(' ');
  tb.querySelector('.tname').textContent = song.tuning.name || 'Own tuning';
  let k = 0;
  $('chordGrid').replaceChildren(...items.map((it) => (it.kind === 'section' ? sectionEl(it) : cardEl(it, ++k))));
  $('chordsEmpty').hidden = items.length > 0;
  $('chordsEmpty').textContent = inbox ? 'Nothing here yet. Chords saved from the analyzer without a song land here.' : 'No chords yet. Tap + to add one.';
  document.title = `${song.name} · Chords`;
}

function cardEl(c, number) {
  const t = tuningOf(c);
  const sel = chosenName(c.frets, t.notes, c.root);
  const name = h('span', { className: 'card-name' }, sel ? chordHTML(sel.parts) : '–');
  if (sel && sel.text.length > 15) name.classList.add('longer');
  else if (sel && sel.text.length > 11) name.classList.add('long');
  const card = h('button', { type: 'button', className: 'chord-card', title: sel?.text || '' },
    h('span', { className: 'card-num', textContent: number }), name, chordDiagram(c.frets, t.notes, sel?.root),
    isInbox(S.song.song) && !sameNotes(t, STANDARD) ? h('span', { className: 'card-tuning', textContent: tuningLabel(t) }) : null);
  card.dataset.id = c.id;
  card._item = c;
  card.addEventListener('click', () => navigate(`#/song/${S.song.song.id}/chord/${c.id}`));
  return card;
}

function sectionEl(sec) {
  const name = h('span', { className: 'section-name', textContent: sec.label || 'Section', title: 'Rename' });
  const el = h('div', { className: 'section-item' }, name, h('span', { className: 'section-line' }));
  el.dataset.id = sec.id;
  el._item = sec;
  name.addEventListener('click', () => renameSection(sec, name));
  return el;
}

function renameSection(sec, nameEl) {
  inlineEdit(nameEl, sec.label || 'Section', async (v) => {
    try { S.song = await api('PATCH', `/items/${sec.id}`, { label: v }); renderSong(); } catch (e) { toast(e.message); }
  });
}

function renameSong() {
  const { song } = S.song;
  if (isInbox(song)) return;
  inlineEdit($('songTitle'), song.name, async (v) => {
    try { S.song = await api('PATCH', `/songs/${song.id}`, { name: v }); renderSong(); } catch (e) { toast(e.message); }
  });
}
$('songTitle').addEventListener('click', renameSong);
$('songBack').addEventListener('click', () => up('#/'));
$('addChord').addEventListener('click', () => navigate(`#/song/${S.song.song.id}/new/${S.song.items.length}`));

$('addSection').addEventListener('click', async () => {
  try {
    const res = await api('POST', `/songs/${S.song.song.id}/items`, { kind: 'section', label: 'Section' });
    S.song = { song: res.song, items: res.items };
    renderSong();
    const el = $('chordGrid').querySelector(`[data-id="${res.itemId}"] .section-name`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (el) renameSection(S.song.items.find((i) => i.id === res.itemId), el);
  } catch (e) { toast(e.message); }
});

sortable($('chordGrid'), {
  items: '[data-id]',
  async onOrder(ids) {
    try { S.song = await api('PUT', `/songs/${S.song.song.id}/order`, { ids }); } catch (e) { toast(e.message); }
    renderSong();
  },
  async onMenu(el) {
    const it = el._item;
    if (it.kind === 'section') {
      const v = await menu({ title: it.label || 'Section', items: [{ label: 'Rename', value: 'rename' }, { label: 'Delete section', value: 'delete', kind: 'danger' }] });
      if (v === 'rename') renameSection(it, el.querySelector('.section-name'));
      if (v === 'delete') await deleteItem(it);
      return;
    }
    const name = chosenName(it.frets, tuningOf(it).notes, it.root)?.text || 'Chord';
    const v = await menu({ title: name, items: [{ label: isInbox(S.song.song) ? 'Move to a song…' : 'Move to…', value: 'move' }, { label: 'Delete chord', value: 'delete', kind: 'danger' }] });
    if (v === 'move') await moveChord(it, name);
    if (v === 'delete') await deleteItem(it);
  },
});

async function deleteItem(it) {
  try { S.song = await api('DELETE', `/items/${it.id}`); renderSong(); } catch (e) { toast(e.message); }
}

/** Ask where a chord should go: Unsorted or one of the songs (without `exceptId`). */
async function pickDestination(title, exceptId) {
  const songs = (await api('GET', '/songs')).filter((s) => s.id !== exceptId);
  const id = await menu({
    title,
    items: songs.map((s) => ({
      label: isInbox(s) ? 'Unsorted' : s.name,
      hint: isInbox(s) ? 'no song' : tuningLabel(s.tuning),
      value: s.id,
    })),
  });
  return id == null ? null : songs.find((s) => s.id === id);
}

/** A shape keeps its frets; in another tuning that means other notes. Ask first. */
async function tuningOk(target, from) {
  if (isInbox(target) || sameNotes(target.tuning, from)) return true;
  return ask({
    title: `“${target.name}” is in ${tuningLabel(target.tuning)}`,
    text: `The shape is saved as it is, so its notes change from ${tuningLabel(from)} to ${tuningLabel(target.tuning)}.`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Save anyway', value: true, kind: 'primary' }],
  });
}

async function moveChord(it, name) {
  try {
    const target = await pickDestination(`Move ${name} to`, S.song.song.id);
    if (!target || !(await tuningOk(target, tuningOf(it)))) return;
    S.song = await api('POST', `/items/${it.id}/move`, { songId: target.id });
    renderSong();
    toast(`Moved to “${isInbox(target) ? 'Unsorted' : target.name}”`);
  } catch (e) { toast(e.message); }
}

$('songTuning').addEventListener('click', () => {
  const { song } = S.song;
  openTuningSheet({
    current: song.tuning,
    custom: S.custom,
    onCustomChange: saveCustom,
    async onPick(t) {
      try { S.song = await api('PATCH', `/songs/${song.id}`, { tuning: t }); renderSong(); } catch (e) { toast(e.message); }
    },
  });
});

// ---- analyzer: free, or on a song's chords ------------------------------------------------

function openScratch() {
  S.ctx = { mode: 'scratch', loading: true };
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SCRATCH_KEY) || 'null'); } catch { /* none */ }
  A.load({ frets: saved?.frets || null, root: saved?.root ?? null, tuning: saved?.tuning || STANDARD });
  S.ctx.loading = false;
  $('aContext').textContent = 'Analyzer';
  document.title = 'Analyzer · Chords';
  show('analyzer');
  updateBars();
}

async function openChord(songId, chordId) {
  await loadSong(songId);
  const c = S.song.items.find((i) => i.id === chordId && i.kind === 'chord');
  if (!c) { toast('That chord is gone'); return navigate(`#/song/${songId}`, { replace: true }); }
  S.ctx = { mode: 'song', songId, chordId, at: S.song.items.indexOf(c), base: null, loading: true };
  A.load({ frets: c.frets, root: c.root, tuning: tuningOf(c) });
  S.ctx.base = A.value();
  S.ctx.loading = false;
  enterSongMode();
}

async function openDraft(songId, at) {
  await loadSong(songId);
  const items = S.song.items;
  const pos = Number.isInteger(at) ? Math.max(0, Math.min(items.length, at)) : items.length;
  // in Unsorted a new chord takes the tuning of its neighbour, or the free analyzer's
  let tuning = S.song.song.tuning;
  if (isInbox(S.song.song)) {
    const near = items.slice(0, pos).reverse().find((i) => i.kind === 'chord') || items.slice(pos).find((i) => i.kind === 'chord');
    let scratch = null;
    try { scratch = JSON.parse(localStorage.getItem(SCRATCH_KEY) || 'null')?.tuning; } catch { /* none */ }
    tuning = near?.tuning || scratch || STANDARD;
  }
  S.ctx = { mode: 'song', songId, chordId: null, at: pos, base: null, loading: true, tuning };
  A.load({ frets: null, root: null, tuning });
  S.ctx.loading = false;
  enterSongMode();
}

function enterSongMode() {
  $('aContext').textContent = S.song.song.name;
  document.title = `${S.song.song.name} · Chords`;
  show('analyzer');
  updateBars();
}

function isDirty() {
  const c = S.ctx;
  if (S.view !== 'analyzer' || !c || c.mode !== 'song' || c.loading) return false;
  if (c.chordId == null) return A.hasNotes();
  const v = A.value();
  return v.root !== c.base.root || v.frets.some((f, i) => f !== c.base.frets[i]);
}

function analyzerChanged() {
  const c = S.ctx;
  if (!c || c.loading) return;
  if (c.mode === 'scratch') {
    try { localStorage.setItem(SCRATCH_KEY, JSON.stringify({ tuning: A.tuning, ...A.value() })); } catch { /* ignore */ }
  }
  updateBars();
}

/** Where the current chord sits among the song's chords (sections don't count). */
function chordNav() {
  const items = S.song.items, c = S.ctx;
  const chordPos = items.map((it, i) => (it.kind === 'chord' ? i : -1)).filter((i) => i >= 0);
  if (c.chordId != null) {
    const p = items.findIndex((it) => it.id === c.chordId);
    const k = chordPos.indexOf(p);
    return { draft: false, p, k, n: chordPos.length, prev: k > 0 ? items[chordPos[k - 1]] : null, next: k < chordPos.length - 1 ? items[chordPos[k + 1]] : null };
  }
  const before = chordPos.filter((i) => i < c.at), after = chordPos.filter((i) => i >= c.at);
  return { draft: true, p: c.at, k: before.length, n: chordPos.length + 1, prev: before.length ? items[before.at(-1)] : null, next: after.length ? items[after[0]] : null };
}

const NEXT_PATH = 'M9 6l6 6-6 6';

function updateBars() {
  const c = S.ctx;
  const song = c?.mode === 'song';
  $('songbar').hidden = !song;
  $('scratchbar').hidden = c?.mode !== 'scratch';
  document.body.classList.toggle('song-mode', song);
  if (c?.mode === 'scratch') { $('saveScratch').disabled = !A.hasNotes(); return; }
  if (!song) return;
  const nav = chordNav();
  $('chordPos').textContent = nav.draft ? `New · ${nav.k + 1} of ${nav.n}` : `${nav.k + 1} of ${nav.n}`;
  $('prevChord').classList.toggle('dim', !nav.prev);
  $('prevChord').classList.toggle('no-hold', nav.draft);
  const next = $('nextChord');
  const addAtEnd = !nav.draft && !nav.next;
  next.classList.toggle('dim', nav.draft && !nav.next);
  next.classList.toggle('no-hold', nav.draft);
  next.classList.toggle('add', addAtEnd);
  next.querySelector('path').setAttribute('d', addAtEnd ? ICON.plus : NEXT_PATH);
  next.title = addAtEnd ? 'Add a chord at the end' : 'Next chord (]) · hold to add a chord after this one';
  const save = $('saveChord');
  if (!save.classList.contains('saved')) save.disabled = !(isDirty() && A.hasNotes());
  $('deleteChord').hidden = nav.draft;
}

async function guard() {
  if (!isDirty()) return true;
  const draft = S.ctx.chordId == null;
  const v = await ask({
    title: draft ? 'Save this new chord?' : 'Save the changes to this chord?',
    buttons: [{ label: 'Cancel', value: null }, { label: 'Discard', value: 'discard' }, { label: 'Save', value: 'save', kind: 'primary' }],
  });
  if (v === 'save') return saveChord();
  return v === 'discard';
}

function goTo(target) {
  const id = S.ctx.songId;
  navigate(target.chordId != null ? `#/song/${id}/chord/${target.chordId}` : `#/song/${id}/new/${target.at}`, { replace: true });
}

async function step(dir) {
  if (S.ctx?.mode !== 'song') return;
  const nav = chordNav();
  let target = null;
  if (dir < 0) { if (nav.prev) target = { chordId: nav.prev.id }; }
  else if (nav.next) target = { chordId: nav.next.id };
  else if (!nav.draft) target = { at: S.song.items.length };
  if (!target) return;
  if (!(await guard())) return;
  goTo(target);
}

async function insert(dir) {
  if (S.ctx?.mode !== 'song' || S.ctx.chordId == null) return;
  if (!(await guard())) return;
  const nav = chordNav();
  goTo({ at: dir < 0 ? nav.p : nav.p + 1 });
}

async function saveChord() {
  const c = S.ctx;
  if (!A.hasNotes()) { toast('Place at least one note first'); return false; }
  const v = A.value();
  const btn = $('saveChord');
  btn.disabled = true;
  try {
    const res = c.chordId == null
      ? await api('POST', `/songs/${c.songId}/items`, { kind: 'chord', ...v, index: c.at, tuning: isInbox(S.song.song) ? c.tuning : undefined })
      : await api('PATCH', `/items/${c.chordId}`, v);
    S.song = { song: res.song, items: res.items };
    S.ctx = { ...c, chordId: res.itemId, at: res.items.findIndex((x) => x.id === res.itemId), base: v };
    history.replaceState(history.state, '', `#/song/${c.songId}/chord/${res.itemId}`);
    S.hash = location.hash;
    btn.textContent = 'Saved';
    btn.classList.add('saved');
    setTimeout(() => { btn.textContent = 'Save'; btn.classList.remove('saved'); updateBars(); }, 1100);
    updateBars();
    return true;
  } catch (e) {
    toast(e.message);
    updateBars();
    return false;
  }
}

async function deleteChord() {
  const c = S.ctx;
  if (c?.mode !== 'song' || c.chordId == null) return;
  const ok = await ask({ title: 'Delete this chord?', buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, kind: 'danger-fill' }] });
  if (!ok) return;
  try {
    const nav = chordNav();
    const res = await api('DELETE', `/items/${c.chordId}`);
    S.song = res;
    S.ctx.loading = true;   // nothing left to save
    const target = nav.next || nav.prev;
    if (!target) return navigate(`#/song/${c.songId}`, { replace: true });
    goTo({ chordId: target.id });
  } catch (e) { toast(e.message); }
}

// the free analyzer: save the chord to Unsorted or the end of a song
$('saveScratch').addEventListener('click', async () => {
  if (!A.hasNotes()) return;
  try {
    const target = await pickDestination('Save this chord to');
    if (!target || !(await tuningOk(target, A.tuning))) return;
    await api('POST', `/songs/${target.id}/items`, { kind: 'chord', ...A.value(), tuning: isInbox(target) ? A.tuning : undefined });
    const btn = $('saveScratch');
    btn.textContent = 'Saved';
    btn.classList.add('saved');
    setTimeout(() => { btn.textContent = 'Save chord…'; btn.classList.remove('saved'); }, 1100);
    toast(`Saved to “${isInbox(target) ? 'Unsorted' : target.name}”`);
  } catch (e) { toast(e.message); }
});

// press = step, hold = new chord on that side
function holdable(btn, dir) {
  let timer = null, held = false;
  const cancel = () => { clearTimeout(timer); timer = null; btn.classList.remove('holding'); };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    held = false;
    if (btn.classList.contains('no-hold') || btn.classList.contains('add')) return;
    btn.classList.add('holding');
    timer = setTimeout(() => {
      held = true;
      btn.classList.remove('holding');
      navigator.vibrate?.(12);
      insert(dir);
    }, 480);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, cancel);
  btn.addEventListener('click', (e) => {
    if (held) { held = false; e.preventDefault(); return; }
    step(dir);
  });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}
holdable($('prevChord'), -1);
holdable($('nextChord'), 1);
$('saveChord').addEventListener('click', () => saveChord());
$('deleteChord').addEventListener('click', deleteChord);

$('aBack').addEventListener('click', async () => {
  if (S.ctx?.mode !== 'song') return up('#/');
  if (!(await guard())) return;
  up(`#/song/${S.ctx.songId}`);
});

$('tuningBtn').addEventListener('click', () => {
  if (S.ctx?.mode === 'song') {
    return toast(isInbox(S.song.song) ? 'Chords in Unsorted keep the tuning they were saved with' : 'The tuning is set for the whole song, on the song page');
  }
  openTuningSheet({
    current: A.tuning,
    custom: S.custom,
    onCustomChange: saveCustom,
    onPick: (t) => A.setTuning(t),
  });
});

// ---- keys ---------------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  if (sheetOpen()) { if (e.key === 'Escape') closeSheet(); return; }
  if ($('dialog').classList.contains('open')) return;
  if (S.view !== 'analyzer') return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (S.ctx?.mode === 'song' && !$('saveChord').disabled) saveChord();
    if (S.ctx?.mode === 'scratch') $('saveScratch').click();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest('input, textarea')) return;
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); A.shift(-1); }
  else if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); A.shift(1); }
  else if (k === 'i' || k === 'n') A.toggleDisplay();
  else if (k === 'Backspace' || k === 'Delete') A.clear();
  else if (k === 't') $('tuningBtn').click();
  else if (k === '[') step(-1);
  else if (k === ']') step(1);
  else if (k === '{') insert(-1);
  else if (k === '}') insert(1);
  else if (/^[1-9]$/.test(k) && A.candidates[Number(k) - 1]) A.pick(A.candidates[Number(k) - 1].root);
});

// ---- start --------------------------------------------------------------------------------

(async function boot() {
  A.layout();
  try {
    const s = await api('GET', '/session');
    S.authed = s.authed;
    S.setup = s.setup;
    if (S.authed) await afterSignIn();
    if (!history.state) history.replaceState({ prev: null }, '', location.hash || '#/');
    route();
  } catch (e) {
    showLogin(e.message);
  }
})();
