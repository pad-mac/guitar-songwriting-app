import { api, whenSignedOut } from './api.js';
import { createAnalyzer } from './analyzer.js';
import { PRESETS } from './tunings.js';
import { noteName } from './chords.js';
import { chordDiagram, chosenName } from './chordcard.js';
import { openTuningSheet, sheetOpen, closeSheet } from './tuningsheet.js';
import { $, h, svgIcon, ICON, chordHTML, formatDate, toast, ask, inlineEdit } from './ui.js';

const STANDARD = { name: PRESETS[0].name, notes: [...PRESETS[0].notes] };
const SCRATCH_KEY = 'gsa:scratch';

const S = {
  authed: false,
  setup: false,
  custom: [],          // own tunings (server)
  song: null,          // { song, chords } of the open song
  ctx: null,           // analyzer: { mode: 'scratch' } | { mode: 'song', songId, chordId|null, index, base }
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

// ---- views and routes ---------------------------------------------------------------------
// #/                       songs
// #/analyzer               free analyzer (not tied to a song)
// #/song/ID                one song
// #/song/ID/chord/CID      a saved chord in the analyzer
// #/song/ID/new/INDEX      a new chord that will go in at INDEX

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

// ---- songs --------------------------------------------------------------------------------

const countText = (n) => `${n} chord${n === 1 ? '' : 's'}`;

async function showSongs() {
  const songs = await api('GET', '/songs');
  const list = $('songList');
  list.replaceChildren(...songs.map((s) => {
    const name = h('span', { className: 'song-name', textContent: s.name });
    const preview = s.preview.map((c) => chosenName(c.frets, s.tuning.notes, c.root)?.text).filter(Boolean);
    const main = h('div', { className: 'song-main', tabIndex: 0, role: 'link' },
      name,
      h('span', { className: 'song-meta', textContent: `${formatDate(s.created_at)} · ${countText(s.chord_count)}` }),
      preview.length ? h('span', { className: 'song-preview', textContent: preview.join('  ·  ') + (s.chord_count > preview.length ? '  ·  …' : '') }) : null);
    const openIt = (e) => { if (!e.target.closest('input')) navigate(`#/song/${s.id}`); };
    main.addEventListener('click', openIt);
    main.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === main) openIt(e); });
    const rename = h('button', { type: 'button', className: 'icon-only', ariaLabel: 'Rename', title: 'Rename' }, svgIcon(ICON.pencil));
    rename.addEventListener('click', () => inlineEdit(name, s.name, async (v) => {
      try { await api('PATCH', `/songs/${s.id}`, { name: v }); s.name = v; name.textContent = v; } catch (e) { toast(e.message); }
    }));
    return h('li', { className: 'song-row' }, main, rename);
  }));
  $('songsEmpty').hidden = songs.length > 0;
  show('songs');
}

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

async function showSong(id) {
  await loadSong(id, { fresh: true });
  renderSong();
  show('song');
  if (S.renameNext) { S.renameNext = false; renameSong(); }
}

function renderSong() {
  const { song, chords } = S.song;
  $('songTitle').textContent = song.name;
  $('songMeta').textContent = `Created ${formatDate(song.created_at)} · ${countText(chords.length)}`;
  const tb = $('songTuning');
  tb.querySelector('.tn').textContent = song.tuning.notes.map(noteName).join(' ');
  tb.querySelector('.tname').textContent = song.tuning.name || 'Own tuning';
  $('chordGrid').replaceChildren(...chords.map((c, i) => {
    const sel = chosenName(c.frets, song.tuning.notes, c.root);
    const name = h('span', { className: 'card-name' }, sel ? chordHTML(sel.parts) : '–');
    if (sel && sel.text.length > 15) name.classList.add('longer');
    else if (sel && sel.text.length > 11) name.classList.add('long');
    const card = h('button', { type: 'button', className: 'chord-card', title: sel?.text || '' },
      h('span', { className: 'card-num', textContent: i + 1 }), name, chordDiagram(c.frets, song.tuning.notes, sel?.root));
    card.addEventListener('click', () => navigate(`#/song/${song.id}/chord/${c.id}`));
    return card;
  }));
  $('chordsEmpty').hidden = chords.length > 0;
  document.title = `${song.name} · Chords`;
}

function renameSong() {
  const { song } = S.song;
  inlineEdit($('songTitle'), song.name, async (v) => {
    try { S.song = await api('PATCH', `/songs/${song.id}`, { name: v }); renderSong(); } catch (e) { toast(e.message); }
  });
}
$('songTitle').addEventListener('click', renameSong);
$('songBack').addEventListener('click', () => up('#/'));
$('addChord').addEventListener('click', () => navigate(`#/song/${S.song.song.id}/new/${S.song.chords.length}`));

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

$('deleteSong').addEventListener('click', async () => {
  const { song, chords } = S.song;
  const ok = await ask({
    title: `Delete “${song.name}”?`,
    text: chords.length ? `Its ${countText(chords.length)} go with it. This can't be undone.` : "This can't be undone.",
    buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, kind: 'danger-fill' }],
  });
  if (!ok) return;
  try { await api('DELETE', `/songs/${song.id}`); S.song = null; navigate('#/', { replace: true }); } catch (e) { toast(e.message); }
});

// ---- analyzer: free, or on a song's chords ------------------------------------------------

function openScratch() {
  S.ctx = { mode: 'scratch', loading: true };
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SCRATCH_KEY) || 'null'); } catch { /* none */ }
  A.load({ frets: saved?.frets || null, root: saved?.root ?? null, tuning: saved?.tuning || STANDARD });
  S.ctx.loading = false;
  document.title = 'Analyzer · Chords';
  show('analyzer');
  updateSongbar();
}

async function openChord(songId, chordId) {
  await loadSong(songId);
  const index = S.song.chords.findIndex((c) => c.id === chordId);
  if (index < 0) { toast('That chord is gone'); return navigate(`#/song/${songId}`, { replace: true }); }
  const c = S.song.chords[index];
  S.ctx = { mode: 'song', songId, chordId, index, base: null, loading: true };
  A.load({ frets: c.frets, root: c.root, tuning: S.song.song.tuning });
  S.ctx.base = A.value();
  S.ctx.loading = false;
  document.title = `${S.song.song.name} · Chords`;
  show('analyzer');
  updateSongbar();
}

async function openDraft(songId, index) {
  await loadSong(songId);
  const n = S.song.chords.length;
  const at = Number.isInteger(index) ? Math.max(0, Math.min(n, index)) : n;
  S.ctx = { mode: 'song', songId, chordId: null, index: at, base: null, loading: true };
  A.load({ frets: null, root: null, tuning: S.song.song.tuning });
  S.ctx.loading = false;
  document.title = `${S.song.song.name} · Chords`;
  show('analyzer');
  updateSongbar();
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
  updateSongbar();
}

const PREV_PATH = 'M15 6l-6 6 6 6', NEXT_PATH = 'M9 6l6 6-6 6';

function updateSongbar() {
  const c = S.ctx;
  const bar = $('songbar');
  bar.hidden = c?.mode !== 'song';
  document.body.classList.toggle('song-mode', !bar.hidden);
  if (bar.hidden) return;
  const n = S.song.chords.length;
  const draft = c.chordId == null;
  $('chordPos').textContent = draft ? `New · ${c.index + 1} of ${n + 1}` : `${c.index + 1} of ${n}`;
  $('prevChord').classList.toggle('dim', c.index === 0);
  $('prevChord').classList.toggle('no-hold', draft);
  const atEnd = draft ? c.index >= n : c.index === n - 1;
  const next = $('nextChord');
  next.classList.toggle('dim', draft && atEnd);
  next.classList.toggle('no-hold', draft);
  next.classList.toggle('add', !draft && atEnd);
  next.querySelector('path').setAttribute('d', !draft && atEnd ? ICON.plus : NEXT_PATH);
  next.title = !draft && atEnd ? 'Add a chord at the end' : 'Next chord (]) · hold to add a chord after this one';
  const save = $('saveChord');
  if (!save.classList.contains('saved')) save.disabled = !(isDirty() && A.hasNotes());
  $('deleteChord').hidden = draft;
  $('aBack').title = 'Back to the song';
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
  navigate(target.chordId != null ? `#/song/${id}/chord/${target.chordId}` : `#/song/${id}/new/${target.draft}`, { replace: true });
}

async function step(dir) {
  const c = S.ctx;
  if (c?.mode !== 'song') return;
  const chords = S.song.chords, n = chords.length;
  let target = null;
  if (dir < 0) { if (c.index > 0) target = { chordId: chords[c.index - 1].id }; }
  else if (c.chordId != null) target = c.index + 1 < n ? { chordId: chords[c.index + 1].id } : { draft: n };
  else if (c.index < n) target = { chordId: chords[c.index].id };
  if (!target) return;
  if (!(await guard())) return;
  goTo(target);
}

async function insert(dir) {
  const c = S.ctx;
  if (c?.mode !== 'song' || c.chordId == null) return;
  if (!(await guard())) return;
  goTo({ draft: dir < 0 ? S.ctx.index : S.ctx.index + 1 });
}

async function saveChord() {
  const c = S.ctx;
  if (!A.hasNotes()) { toast('Place at least one note first'); return false; }
  const v = A.value();
  const btn = $('saveChord');
  btn.disabled = true;
  try {
    const res = c.chordId == null
      ? await api('POST', `/songs/${c.songId}/chords`, { ...v, index: c.index })
      : await api('PATCH', `/chords/${c.chordId}`, v);
    S.song = { song: res.song, chords: res.chords };
    S.ctx = { ...c, chordId: res.chordId, index: res.chords.findIndex((x) => x.id === res.chordId), base: v };
    history.replaceState(history.state, '', `#/song/${c.songId}/chord/${res.chordId}`);
    S.hash = location.hash;
    btn.textContent = 'Saved';
    btn.classList.add('saved');
    setTimeout(() => { btn.textContent = 'Save'; btn.classList.remove('saved'); updateSongbar(); }, 1100);
    updateSongbar();
    return true;
  } catch (e) {
    toast(e.message);
    updateSongbar();
    return false;
  }
}

async function deleteChord() {
  const c = S.ctx;
  if (c?.mode !== 'song' || c.chordId == null) return;
  const ok = await ask({ title: 'Delete this chord?', buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, kind: 'danger-fill' }] });
  if (!ok) return;
  try {
    const res = await api('DELETE', `/chords/${c.chordId}`);
    S.song = res;
    S.ctx.loading = true;   // nothing left to save
    const n = res.chords.length;
    if (!n) return navigate(`#/song/${c.songId}`, { replace: true });
    goTo({ chordId: res.chords[Math.min(c.index, n - 1)].id });
  } catch (e) { toast(e.message); }
}

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
  if (S.ctx?.mode === 'song') return toast('The tuning is set for the whole song, on the song page');
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
