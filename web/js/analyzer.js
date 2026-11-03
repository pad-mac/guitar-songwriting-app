// The analyzer: fretboard, names, notes/intervals, lower/higher. It holds one chord at a time;
// the song view loads chords into it and reads them back out.
import { analyze, noteName, pc } from './chords.js';
import { Fretboard } from './fretboard.js';
import { $, h, chordHTML } from './ui.js';

export const FRETS = 15;
const DISPLAY_KEY = 'gsa:display';
const ALL_KEY = 'gsa:allnotes';

export function createAnalyzer({ onChange } = {}) {
  const st = {
    frets: [null, null, null, null, null, null],
    root: null,
    pinned: false,
    display: (() => { try { return localStorage.getItem(DISPLAY_KEY) || 'notes'; } catch { return 'notes'; } })(),
    allNotes: (() => { try { return localStorage.getItem(ALL_KEY) === '1'; } catch { return false; } })(),
    tuning: { name: 'Standard', notes: [40, 45, 50, 55, 59, 64] },
  };
  let current = [];
  const board = new Fretboard($('board'), {
    frets: FRETS,
    onTap(s, f) { st.frets[s] = st.frets[s] === f ? null : f; render(); },
  });

  function fit() {
    const n = st.tuning.notes.length;
    st.frets = Array.from({ length: n }, (_, i) => {
      const f = st.frets[i];
      return Number.isInteger(f) && f >= 0 && f <= FRETS ? f : null;
    });
  }

  function render() {
    fit();
    const t = st.tuning;
    const notes = st.frets.map((f, i) => (f == null ? null : t.notes[i] + f));
    current = analyze(notes);
    let sel = st.pinned ? current.find((c) => c.root === st.root) : null;
    if (!sel) { sel = current[0] || null; st.pinned = false; }
    st.root = sel ? sel.root : null;


    const iv = (n) => sel.labels[(pc(n) - sel.root + 12) % 12] || '';
    const showNotes = st.display === 'notes';
    const isRoot = notes.map((n) => n != null && pc(n) === sel.root);
    board.update({
      frets: st.frets,
      main: notes.map((n) => (n == null ? '' : showNotes ? noteName(n) : iv(n))),
      secondary: notes.map((n) => (n == null ? '' : showNotes ? iv(n) : noteName(n))),
      root: isRoot,
      secondaryRoot: isRoot,
    });

    // names, keyed so unchanged entries stay put
    const list = $('cands');
    const old = new Map([...list.children].map((li) => [li.dataset.key, li]));
    const items = current.map((c, i) => {
      let li = old.get(c.text);
      if (!li) {
        li = h('li', { className: 'enter' });
        li.dataset.key = c.text;
        const b = h('button', { type: 'button' }, chordHTML(c.parts));
        if (c.text.length > 17) b.className = 'longer';
        else if (c.text.length > 13) b.className = 'long';
        li.append(b);
        requestAnimationFrame(() => requestAnimationFrame(() => li.classList.remove('enter')));
      }
      li.dataset.root = c.root;
      li.firstChild.setAttribute('aria-pressed', String(c.root === st.root));
      li.firstChild.title = `${c.text}${i < 9 ? `  (${i + 1})` : ''}`;
      return li;
    });
    list.replaceChildren(...(items.length ? items : [h('li', { className: 'hint', textContent: 'Tap the fretboard' })]));
    list.classList.toggle('empty', !items.length);

    const used = st.frets.filter((f) => f != null);
    $('lower').disabled = !used.length || Math.min(...used) <= 0;
    $('higher').disabled = !used.length || Math.max(...used) >= FRETS;
    $('clear').disabled = !used.length;
    $('allNotes').setAttribute('aria-pressed', String(st.allNotes));
    board.setAllNotes(st.allNotes ? t.notes : null);
    for (const b of document.querySelectorAll('[data-display]')) b.setAttribute('aria-pressed', String(b.dataset.display === st.display));
    $('tuningNotes').textContent = t.notes.map(noteName).join(' ');
    $('tuningName').textContent = t.name || 'Own tuning';
    onChange?.();
  }

  function layout() {
    const w = window.innerWidth, hgt = window.innerHeight;
    const o = w >= 700 && w >= hgt * 0.9 ? 'h' : 'v';
    document.body.classList.toggle('h', o === 'h');
    document.body.classList.toggle('v', o === 'v');
    board.configure({ orientation: o, strings: st.tuning.notes.length, mirror: document.body.classList.contains('lefty') });
  }
  window.addEventListener('resize', layout);

  const api = {
    /** Show a chord: frets per string (null = muted), root = chosen name's root or null. */
    load({ frets, root = null, tuning }) {
      if (tuning) st.tuning = tuning;
      st.frets = frets ? [...frets] : [];
      st.root = root;
      st.pinned = root != null;
      fit();
      layout();
      render();
    },
    setTuning(tuning) { st.tuning = tuning; layout(); render(); },
    /** The chord as it would be saved; root only when a name other than the bass one is chosen. */
    value() {
      const bass = current[0]?.root ?? null;
      return { frets: [...st.frets], root: st.pinned && st.root !== bass ? st.root : null };
    },
    hasNotes: () => st.frets.some((f) => f != null),
    get tuning() { return st.tuning; },
    get candidates() { return current; },
    shift(d) {
      const used = st.frets.filter((f) => f != null);
      if (!used.length || Math.min(...used) + d < 0 || Math.max(...used) + d > FRETS) return;
      st.frets = st.frets.map((f) => (f == null ? null : f + d));
      if (st.root != null) st.root = (st.root + d + 12) % 12;
      render();
    },
    clear() { st.frets = st.frets.map(() => null); st.pinned = false; render(); },
    pick(root) { st.root = root; st.pinned = true; render(); },
    setDisplay(d) {
      st.display = d;
      try { localStorage.setItem(DISPLAY_KEY, d); } catch { /* ignore */ }
      render();
    },
    toggleAllNotes() {
      st.allNotes = !st.allNotes;
      try { localStorage.setItem(ALL_KEY, st.allNotes ? '1' : '0'); } catch { /* ignore */ }
      render();
    },
    toggleDisplay() { api.setDisplay(st.display === 'notes' ? 'intervals' : 'notes'); },
    layout,
  };

  $('cands').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (li && li.dataset.root != null) api.pick(Number(li.dataset.root));
  });
  for (const b of document.querySelectorAll('[data-display]')) b.addEventListener('click', () => api.setDisplay(b.dataset.display));
  $('lower').addEventListener('click', () => api.shift(-1));
  $('higher').addEventListener('click', () => api.shift(1));
  $('clear').addEventListener('click', () => api.clear());
  $('allNotes').addEventListener('click', () => api.toggleAllNotes());

  return api;
}
