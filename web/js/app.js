import { analyze, noteName, noteWithOctave, pc } from './chords.js';
import { PRESETS, MIN_NOTE, MAX_NOTE } from './tunings.js';
import { Fretboard } from './fretboard.js';

const FRETS = 15;
const STORE = 'gsa:v1';
const $ = (id) => document.getElementById(id);

// ---- state ------------------------------------------------------------------------------

const state = load();
function load() {
  const base = { tuningId: 'standard', frets: [null, null, null, null, null, null], display: 'notes', root: null, pinned: false, custom: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && typeof saved === 'object') return { ...base, ...saved };
  } catch { /* storage unavailable or corrupt: start fresh */ }
  return base;
}
function persist() {
  try {
    const { tuningId, frets, display, root, pinned, custom } = state;
    localStorage.setItem(STORE, JSON.stringify({ tuningId, frets, display, root, pinned, custom }));
  } catch { /* private mode etc. */ }
}
const allTunings = () => [...PRESETS, ...state.custom];
const tuning = () => allTunings().find((t) => t.id === state.tuningId) || PRESETS[0];
function fitFrets() {
  const n = tuning().notes.length;
  state.frets = Array.from({ length: n }, (_, i) => {
    const f = state.frets[i];
    return Number.isInteger(f) && f >= 0 && f <= FRETS ? f : null;
  });
}

// ---- chord symbols ------------------------------------------------------------------------

function chordHTML(parts) {
  const span = document.createElement('span');
  span.className = 'ch';
  for (const p of parts) {
    const s = document.createElement('span');
    s.className = p.k;
    s.textContent = p.t;
    span.appendChild(s);
  }
  return span;
}

// ---- rendering ----------------------------------------------------------------------------

const board = new Fretboard($('board'), { frets: FRETS, onTap: tap });
let current = [];

function render() {
  fitFrets();
  const t = tuning();
  const notes = state.frets.map((f, i) => (f == null ? null : t.notes[i] + f));
  current = analyze(notes);
  let sel = state.pinned ? current.find((c) => c.root === state.root) : null;
  if (!sel) { sel = current[0] || null; state.pinned = false; }
  state.root = sel ? sel.root : null;

  // header
  const head = $('current');
  head.classList.toggle('long', !!sel && sel.text.length > 11 && sel.text.length <= 15);
  head.classList.toggle('longer', !!sel && sel.text.length > 15);
  head.replaceChildren(sel ? chordHTML(sel.parts) : Object.assign(document.createElement('span'), { className: 'hint', textContent: 'Tap the fretboard' }));
  document.title = sel ? `${sel.text} · Chords` : 'Chords';

  // fretboard
  const iv = (n) => sel.labels[(pc(n) - sel.root + 12) % 12] || '';
  const showNotes = state.display === 'notes';
  board.update({
    frets: state.frets,
    main: notes.map((n) => (n == null ? '' : showNotes ? noteName(n) : iv(n))),
    secondary: notes.map((n) => (n == null ? '' : showNotes ? iv(n) : noteName(n))),
    root: notes.map((n) => n != null && pc(n) === sel.root),
    secondaryRoot: notes.map((n) => n != null && pc(n) === sel.root),
  });

  // alternatives, keyed by name so unchanged entries stay put
  const list = $('cands');
  const old = new Map([...list.children].map((li) => [li.dataset.key, li]));
  const items = current.map((c, i) => {
    let li = old.get(c.text);
    if (!li) {
      li = document.createElement('li');
      li.dataset.key = c.text;
      li.className = 'enter';
      const b = document.createElement('button');
      b.type = 'button';
      if (c.text.length > 17) b.className = 'longer';
      else if (c.text.length > 13) b.className = 'long';
      b.appendChild(chordHTML(c.parts));
      li.appendChild(b);
      requestAnimationFrame(() => requestAnimationFrame(() => li.classList.remove('enter')));
    }
    li.dataset.root = c.root;
    li.firstChild.setAttribute('aria-pressed', String(c.root === state.root));
    li.firstChild.title = `${c.text}${i < 9 ? `  (${i + 1})` : ''}`;
    return li;
  });
  list.replaceChildren(...items);
  list.classList.toggle('empty', !items.length);

  // controls
  const used = state.frets.filter((f) => f != null);
  $('lower').disabled = !used.length || Math.min(...used) <= 0;
  $('higher').disabled = !used.length || Math.max(...used) >= FRETS;
  $('clear').disabled = !used.length;
  for (const b of document.querySelectorAll('[data-display]')) b.setAttribute('aria-pressed', String(b.dataset.display === state.display));
  $('tuningNotes').textContent = t.notes.map(noteName).join(' ');
  $('tuningName').textContent = t.name;
  persist();
}

// ---- actions ------------------------------------------------------------------------------

function tap(s, f) {
  state.frets[s] = state.frets[s] === f ? null : f;
  render();
}
function shift(d) {
  const used = state.frets.filter((f) => f != null);
  if (!used.length || Math.min(...used) + d < 0 || Math.max(...used) + d > FRETS) return;
  state.frets = state.frets.map((f) => (f == null ? null : f + d));
  if (state.root != null) state.root = (state.root + d + 12) % 12;
  render();
}
function clearBoard() {
  state.frets = state.frets.map(() => null);
  state.pinned = false;
  render();
}
function pick(root) {
  state.root = root;
  state.pinned = true;
  render();
}
function setDisplay(d) {
  state.display = d;
  render();
}

$('cands').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (li) pick(Number(li.dataset.root));
});
for (const b of document.querySelectorAll('[data-display]')) b.addEventListener('click', () => setDisplay(b.dataset.display));
$('lower').addEventListener('click', () => shift(-1));
$('higher').addEventListener('click', () => shift(1));
$('clear').addEventListener('click', clearBoard);
$('tuningBtn').addEventListener('click', () => openSheet());

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (sheetOpen()) { if (e.key === 'Escape') closeSheet(); return; }
  if (e.target.closest('input, textarea')) return;
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); shift(-1); }
  else if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); shift(1); }
  else if (k === 'i' || k === 'n') setDisplay(state.display === 'notes' ? 'intervals' : 'notes');
  else if (k === 'Backspace' || k === 'Delete') clearBoard();
  else if (k === 't') openSheet();
  else if (/^[1-9]$/.test(k) && current[Number(k) - 1]) pick(current[Number(k) - 1].root);
});

// ---- layout -------------------------------------------------------------------------------

function layout() {
  const w = window.innerWidth, h = window.innerHeight;
  const o = w >= 700 && w >= h * 0.9 ? 'h' : 'v';
  document.body.classList.toggle('h', o === 'h');
  document.body.classList.toggle('v', o === 'v');
  board.configure({ orientation: o, strings: tuning().notes.length });
}
window.addEventListener('resize', layout);

// ---- tunings sheet ------------------------------------------------------------------------

const sheet = $('sheet');
const sheetOpen = () => sheet.classList.contains('open');
function openSheet() {
  showList();
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
}
function closeSheet() {
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  $('tuningBtn').focus({ preventScroll: true });
}
sheet.querySelector('.scrim').addEventListener('click', closeSheet);
$('sheetClose').addEventListener('click', closeSheet);
$('sheetBack').addEventListener('click', showList);

function h(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k != null) n.append(k);
  return n;
}

function showList() {
  $('sheetTitle').textContent = 'Tunings';
  $('sheetBack').hidden = true;
  $('sheetClose').textContent = 'Done';
  const body = $('sheetBody');
  const rows = allTunings().map((t) => {
    const custom = !PRESETS.includes(t);
    const pickBtn = h('button', { type: 'button', className: 'tuning-pick', ariaPressed: String(t.id === tuning().id) },
      h('span', { className: 'tn', textContent: t.notes.map(noteName).join(' ') }),
      h('span', { className: 'tname', textContent: t.name }));
    pickBtn.addEventListener('click', () => {
      state.tuningId = t.id;
      layout();
      render();
      closeSheet();
    });
    const edit = h('button', { type: 'button', className: 'ghost-btn', textContent: custom ? 'Edit' : 'Copy', title: custom ? 'Edit this tuning' : 'Make your own tuning from this one' });
    edit.addEventListener('click', () => showEditor(t, custom));
    return h('li', {}, pickBtn, edit);
  });
  const add = h('button', { type: 'button', className: 'add-btn', textContent: 'New tuning' });
  add.addEventListener('click', () => showEditor({ name: '', notes: [...tuning().notes] }, false));
  body.replaceChildren(h('ul', { className: 'tunings' }, ...rows), add);
}

function showEditor(src, isCustom) {
  $('sheetTitle').textContent = isCustom ? 'Edit tuning' : 'New tuning';
  $('sheetBack').hidden = false;
  $('sheetClose').textContent = 'Cancel';
  const notes = [...src.notes];
  const name = h('input', { type: 'text', className: 'name-input', value: isCustom ? src.name : src.name ? `${src.name} (own)` : '', placeholder: 'Name', maxLength: 40 });
  const strings = h('ol', { className: 'string-edit' });
  const draw = () => {
    strings.replaceChildren(...notes.map((n, i) => {
      const down = h('button', { type: 'button', className: 'step', textContent: '−', ariaLabel: 'Lower a semitone', disabled: n <= MIN_NOTE });
      const up = h('button', { type: 'button', className: 'step', textContent: '+', ariaLabel: 'Raise a semitone', disabled: n >= MAX_NOTE });
      down.addEventListener('click', () => { notes[i]--; draw(); });
      up.addEventListener('click', () => { notes[i]++; draw(); });
      return h('li', {}, h('span', { className: 'sn', textContent: `String ${notes.length - i}` }), down, h('span', { className: 'nv', textContent: noteWithOctave(n) }), up);
    }));
  };
  draw();
  const save = h('button', { type: 'button', className: 'primary', textContent: 'Save and use' });
  save.addEventListener('click', () => {
    const label = name.value.trim() || notes.map(noteName).join(' ');
    if (isCustom) Object.assign(state.custom.find((t) => t.id === src.id), { name: label, notes: [...notes] });
    else {
      const id = 'custom-' + Date.now().toString(36);
      state.custom.push({ id, name: label, notes: [...notes] });
      state.tuningId = id;
    }
    if (isCustom) state.tuningId = src.id;
    layout();
    render();
    closeSheet();
  });
  const actions = h('div', { className: 'actions' }, save);
  if (isCustom) {
    const del = h('button', { type: 'button', className: 'danger', textContent: 'Delete' });
    del.addEventListener('click', () => {
      state.custom = state.custom.filter((t) => t.id !== src.id);
      if (state.tuningId === src.id) state.tuningId = 'standard';
      layout();
      render();
      showList();
    });
    actions.prepend(del);
  }
  $('sheetBody').replaceChildren(name, strings, actions);
}

// ---- go -----------------------------------------------------------------------------------

layout();
render();
