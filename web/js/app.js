import { api, whenSignedOut } from './api.js';
import { createAnalyzer } from './analyzer.js';
import { PRESETS } from './tunings.js';
import { noteName } from './chords.js';
import { chordDiagram, chosenName } from './chordcard.js';
import { openTuningSheet, sheetOpen, closeSheet } from './tuningsheet.js';
import { sortable } from './sortable.js';
import { $, h, svgIcon, ICON, chordHTML, formatDate, toast, ask, menu, atEl, inlineEdit } from './ui.js';

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
  pendingDraft: null,  // frets/root for the next new chord (duplicate)
  creating: null,      // promise of a song being created
};

const A = createAnalyzer({ onChange: analyzerChanged });

$('songBack').append(svgIcon(ICON.back));
$('aBack').append(svgIcon(ICON.back));
$('newSong').append(svgIcon(ICON.plus));
$('addChord').append(svgIcon(ICON.plus));
$('deleteChord').append(svgIcon(ICON.trash));
$('openScratch').append(svgIcon('M6 3.5h12v17H6zM10 3.5v17M14 3.5v17M6 8.5h12M6 13.5h12M12 11a1.4 1.4 0 1 0 0 0.01'), h('span', { textContent: 'Analyzer' }));

// ---- this device's settings: light/dark, right/left hand --------------------------------
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
const MOON = 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z';
const SUN = 'M12 7.5a4.5 4.5 0 1 1 0 9a4.5 4.5 0 1 1 0-9zM12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8';
const HAND = 'M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v7.5a6.5 6.5 0 0 1-6.5 6.5h-.5a6 6 0 0 1-5-2.7L3.6 14a1.5 1.5 0 0 1 2.4-1.8L8 14.5';
function applySettings() {
  const dark = store.get('gsa:theme') === 'dark';
  const left = store.get('gsa:hand') === 'left';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('themeColor').setAttribute('content', dark ? '#55575b' : '#e7e7e5');
  document.body.classList.toggle('lefty', left);
  document.documentElement.classList.remove('lefty-pending');
  $('themeToggle').replaceChildren(svgIcon(dark ? MOON : SUN), h('span', { textContent: dark ? 'Dark' : 'Light' }));
  $('themeToggle').title = dark ? 'Dark mode · tap for light' : 'Light mode · tap for dark';
  const hand = svgIcon(HAND);
  if (!left) hand.style.transform = 'scaleX(-1)';
  $('handToggle').replaceChildren(hand, h('span', { textContent: left ? 'Left hand' : 'Right hand' }));
  $('handToggle').title = left ? 'Fretboard mirrored for left-handed players · tap for right-handed' : 'Right-handed fretboard · tap for left-handed';
  A.layout();
}
$('themeToggle').addEventListener('click', () => { store.set('gsa:theme', store.get('gsa:theme') === 'dark' ? 'light' : 'dark'); applySettings(); });
$('handToggle').addEventListener('click', () => {
  store.set('gsa:hand', store.get('gsa:hand') === 'left' ? 'right' : 'left');
  applySettings();
  if (S.view === 'songs') return;
  if (S.view === 'song') renderSong();
});
const lefty = () => document.body.classList.contains('lefty');

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
  onMenu(row, at) {
    const s = row._song;
    const m = menu({ title: s.name, at, items: [{ label: 'Rename', value: 'rename' }, { label: 'Delete song', value: 'delete', kind: 'danger' }] });
    m.then(async (v) => {
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
    });
    return m;
  },
});

$('newSong').addEventListener('click', () => {
  // show the page and focus the title right inside the tap (iOS opens the keyboard only
  // then); the song is created on the server meanwhile
  S.song = { song: { id: null, kind: 'song', name: 'New song', tuning: STANDARD, created_at: Date.now() }, items: [] };
  renderSong();
  show('song');
  S.creating = api('POST', '/songs', { name: 'New song', tuning: STANDARD }).then((res) => {
    if (S.song?.song.id === null) {
      S.song.song.id = res.song.id;
      S.song.song.created_at = res.song.created_at;
    }
    history.pushState({ prev: '#/' }, '', `#/song/${res.song.id}`);
    S.hash = location.hash;
    return res.song.id;
  }).catch((e) => { toast(e.message); navigate('#/', { replace: true }); throw e; });
  renameSong();
});
const songId = async () => S.song.song.id ?? await S.creating;
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
    h('span', { className: 'card-num', textContent: number }), name, chordDiagram(c.frets, t.notes, sel?.root, { mirror: lefty() }),
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
    S.song.song.name = v;
    $('songTitle').textContent = v;
    try { S.song = await api('PATCH', `/songs/${await songId()}`, { name: v }); renderSong(); } catch (e) { toast(e.message); }
  });
}
$('songTitle').addEventListener('click', renameSong);
$('songBack').addEventListener('click', () => up('#/'));
$('addChord').addEventListener('click', async () => navigate(`#/song/${await songId()}/new/${S.song.items.length}`));

$('addSection').addEventListener('click', () => {
  // the name field opens inside the tap (so the phone keyboard comes up); saved when done
  const name = h('span', { className: 'section-name' });
  const el = h('div', { className: 'section-item pending' }, name, h('span', { className: 'section-line' }));
  $('chordGrid').append(el);
  $('chordsEmpty').hidden = true;
  inlineEdit(name, '', async (v) => {
    try {
      const res = await api('POST', `/songs/${await songId()}/items`, { kind: 'section', label: v });
      S.song = { song: res.song, items: res.items };
    } catch (e) { toast(e.message); }
    renderSong();
  }, { placeholder: 'Section name', onCancel: () => { el.remove(); $('chordsEmpty').hidden = S.song.items.length > 0; } });
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
});

sortable($('chordGrid'), {
  items: '[data-id]',
  async onOrder(ids) {
    try { S.song = await api('PUT', `/songs/${S.song.song.id}/order`, { ids }); } catch (e) { toast(e.message); }
    renderSong();
  },
  onMenu(el, at) {
    const it = el._item;
    if (it.kind === 'section') {
      const m = menu({ title: it.label || 'Section', at, items: [{ label: 'Rename', value: 'rename' }, { label: 'Delete section', value: 'delete', kind: 'danger' }] });
      m.then((v) => {
        if (v === 'rename') renameSection(it, el.querySelector('.section-name'));
        if (v === 'delete') deleteItem(it);
      });
      return m;
    }
    const name = chosenName(it.frets, tuningOf(it).notes, it.root)?.text || 'Chord';
    const m = menu({ title: name, at, items: [{ label: 'Duplicate', value: 'dup' }, { label: isInbox(S.song.song) ? 'Move to a song…' : 'Move to…', value: 'move' }, { label: 'Delete chord', value: 'delete', kind: 'danger' }] });
    m.then((v) => {
      if (v === 'dup') duplicateChord(it);
      if (v === 'move') moveChord(it, name, { ...at, held: false });
      if (v === 'delete') deleteItem(it);
    });
    return m;
  },
});

/** Copy a chord in place: the copy lands right after it. */
async function duplicateChord(it) {
  try {
    const index = S.song.items.findIndex((x) => x.id === it.id) + 1;
    const res = await api('POST', `/songs/${S.song.song.id}/items`, { kind: 'chord', frets: it.frets, root: it.root, index, tuning: isInbox(S.song.song) ? tuningOf(it) : undefined });
    S.song = { song: res.song, items: res.items };
    renderSong();
    [...$('chordGrid').children].find((el) => el._item?.id === res.itemId)?.classList.add('just-added');
  } catch (e) { toast(e.message); }
}

async function deleteItem(it) {
  try { S.song = await api('DELETE', `/items/${it.id}`); renderSong(); } catch (e) { toast(e.message); }
}

/** Ask where a chord should go: Unsorted or one of the songs (without `exceptId`). */
async function pickDestination(title, exceptId, at) {
  const songs = (await api('GET', '/songs')).filter((s) => s.id !== exceptId);
  const id = await menu({
    title,
    at,
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

async function moveChord(it, name, at) {
  try {
    const target = await pickDestination(`Move ${name} to`, S.song.song.id, at);
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
      try { S.song = await api('PATCH', `/songs/${await songId()}`, { tuning: t }); renderSong(); } catch (e) { toast(e.message); }
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
  const copy = S.pendingDraft;
  S.pendingDraft = null;
  A.load({ frets: copy?.frets || null, root: copy?.root ?? null, tuning });
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
  if (c?.mode === 'scratch') { $('saveScratch').disabled = $('saveToSong').disabled = !A.hasNotes(); return; }
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
  next.title = addAtEnd ? 'Add a chord at the end · hold for new or duplicate' : 'Next chord (]) · hold for a new chord or a duplicate after this one';
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

async function step(dir, { create = true, onGo } = {}) {
  if (S.ctx?.mode !== 'song') return;
  const nav = chordNav();
  let target = null;
  if (dir < 0) { if (nav.prev) target = { chordId: nav.prev.id }; }
  else if (nav.next) target = { chordId: nav.next.id };
  else if (!nav.draft && create) target = { at: S.song.items.length };
  if (!target) return;
  if (!(await guard())) return;
  onGo?.();
  goTo(target);
}

async function insert(dir, { copy = false } = {}) {
  if (S.ctx?.mode !== 'song' || S.ctx.chordId == null) return;
  if (!(await guard())) return;
  const nav = chordNav();
  // a duplicate starts from the chord as saved (after the guard: including what was just saved)
  if (copy) S.pendingDraft = { frets: [...S.ctx.base.frets], root: S.ctx.base.root };
  goTo({ at: dir < 0 ? nav.p : nav.p + 1 });
}

// holding ‹ or › (or + on the last chord): a new, empty chord or a copy of this one
async function holdAction(dir, at) {
  if (S.ctx?.mode !== 'song' || S.ctx.chordId == null) return;
  const v = await menu({
    title: dir < 0 ? 'Before this chord' : 'After this chord',
    at,
    items: [{ label: 'New chord', value: 'new' }, { label: 'Duplicate this chord', value: 'copy' }],
  });
  if (v) insert(dir, { copy: v === 'copy' });
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

// the free analyzer: one tap saves to Unsorted; "To a song…" picks a song (chord goes at the end)
async function saveScratchTo(target) {
  await api('POST', `/songs/${target.id}/items`, { kind: 'chord', ...A.value(), tuning: isInbox(target) ? A.tuning : undefined });
  const btn = $('saveScratch');
  btn.textContent = 'Saved';
  btn.classList.add('saved');
  setTimeout(() => { btn.textContent = 'Save'; btn.classList.remove('saved'); }, 1100);
  toast(`Saved to “${isInbox(target) ? 'Unsorted' : target.name}”`);
}
$('saveScratch').addEventListener('click', async () => {
  if (!A.hasNotes()) return;
  try {
    const inbox = (await api('GET', '/songs')).find(isInbox);
    await saveScratchTo(inbox);
  } catch (e) { toast(e.message); }
});
$('saveToSong').addEventListener('click', async () => {
  if (!A.hasNotes()) return;
  try {
    const songs = (await api('GET', '/songs')).filter((x) => !isInbox(x));
    if (!songs.length) return toast('No songs yet — create one on the songs screen');
    const id = await menu({ title: 'Add this chord to', at: atEl($('saveToSong')), items: songs.map((x) => ({ label: x.name, hint: tuningLabel(x.tuning), value: x.id })) });
    const target = songs.find((x) => x.id === id);
    if (!target || !(await tuningOk(target, A.tuning))) return;
    await saveScratchTo(target);
  } catch (e) { toast(e.message); }
});

// ---- swipe on a chord: left = next, right = previous; from the left edge = back ----------
// Only a quick, clearly horizontal stroke counts, so tapping and small slips never trigger it.
{
  const view = $('v-analyzer');
  let sw = null;
  view.addEventListener('touchstart', (e) => {
    sw = null;
    if (e.touches.length !== 1 || S.view !== 'analyzer' || sheetOpen() || $('dialog').classList.contains('open')) return;
    if (e.target.closest('.songbar, .scratchbar, .side .bar, .a-bar, input')) return;
    const t = e.touches[0];
    sw = { x: t.clientX, y: t.clientY, t: performance.now(), edge: t.clientX < 28, dx: 0, dy: 0 };
  }, { passive: true });
  view.addEventListener('touchmove', (e) => {
    if (!sw) return;
    const t = e.touches[0];
    sw.dx = t.clientX - sw.x;
    sw.dy = t.clientY - sw.y;
    if (Math.abs(sw.dy) > 36 && Math.abs(sw.dy) > Math.abs(sw.dx)) sw = null;   // vertical: not a swipe
  }, { passive: true });
  view.addEventListener('touchcancel', () => { sw = null; });
  view.addEventListener('touchend', () => {
    const s = sw;
    sw = null;
    if (!s) return;
    const { dx, dy } = s;
    if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.45 || performance.now() - s.t > 650) return;
    blockClicksUntil = performance.now() + 450;    // the stroke must not also tap a fret
    if (s.edge && dx > 0) return leaveAnalyzer();
    if (S.ctx?.mode !== 'song') return;
    const dir = dx < 0 ? 1 : -1;
    step(dir, { create: false, onGo: () => slideIn(dir) });
  });
  let blockClicksUntil = 0;
  view.addEventListener('click', (e) => {
    if (performance.now() < blockClicksUntil) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}
// a short glide of the board and names in the direction of travel
function slideIn(dir) {
  for (const el of [$('board'), document.querySelector('#v-analyzer .side')]) {
    el?.animate([{ transform: `translateX(${dir * 26}px)`, opacity: 0.35 }, { transform: 'none', opacity: 1 }], { duration: 190, easing: 'cubic-bezier(.25,.8,.3,1)', delay: 40 });
  }
}

// press = step; hold = new chord or duplicate on that side. The menu opens as soon as the hold
// counts, with the finger still down; it takes taps only once the finger is lifted.
function holdable(btn, dir) {
  let timer = null, held = false;
  const reset = () => { clearTimeout(timer); timer = null; btn.classList.remove('holding'); };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    held = false;
    if (btn.classList.contains('no-hold')) return;
    btn.classList.add('holding');
    timer = setTimeout(() => {
      held = true;
      btn.classList.remove('holding');
      navigator.vibrate?.(8);
      holdAction(dir, { ...atEl(btn), held: true });
    }, 480);
  });
  const lift = () => { reset(); if (held) window.dispatchEvent(new Event('gsa:lp-up')); };
  btn.addEventListener('pointerup', lift);
  btn.addEventListener('pointercancel', lift);
  btn.addEventListener('pointerleave', () => { if (!held) reset(); });
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

async function leaveAnalyzer() {
  if (S.ctx?.mode !== 'song') return up('#/');
  if (!(await guard())) return;
  up(`#/song/${S.ctx.songId}`);
}
$('aBack').addEventListener('click', leaveAnalyzer);

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
  const flip = lefty() && document.body.classList.contains('h');
  const k = flip && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') ? (e.key === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft') : e.key;
  if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); A.shift(-1); }
  else if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); A.shift(1); }
  else if (k === 'i' || k === 'n') A.toggleDisplay();
  else if (k === 'Backspace' || k === 'Delete') A.clear();
  else if (k === 't') $('tuningBtn').click();
  else if (k === 'a') A.toggleAllNotes();
  else if (k === '[') step(-1);
  else if (k === ']') step(1);
  else if (k === '{') insert(-1);
  else if (k === '}') insert(1);
  else if (/^[1-9]$/.test(k) && A.candidates[Number(k) - 1]) A.pick(A.candidates[Number(k) - 1].root);
});

// ---- start --------------------------------------------------------------------------------

(async function boot() {
  applySettings();
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
