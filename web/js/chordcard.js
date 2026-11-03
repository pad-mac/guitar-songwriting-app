// A saved chord as a small diagram: only the frets around the shape, numbered on the left.
// Open strings and muted strings sit on a line above the window, wherever on the neck it is.
import { analyze, noteName, pc } from './chords.js';

const SVG = 'http://www.w3.org/2000/svg';
const el = (name, attrs, parent) => {
  const n = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.appendChild(n);
  return n;
};

/** The name shown for a saved chord: its chosen root, or the bass name. */
export function chosenName(frets, tuningNotes, root) {
  const notes = tuningNotes.map((t, i) => (frets[i] == null ? null : t + frets[i]));
  const cands = analyze(notes);
  if (!cands.length) return null;
  return (root != null && cands.find((c) => c.root === root)) || cands[0];
}

/** The fret window for a shape: frets start…start+span-1. */
export function windowOf(frets) {
  const fretted = frets.filter((f) => f != null && f > 0);
  if (!fretted.length) return { start: 1, span: 4 };
  const lo = Math.min(...fretted), hi = Math.max(...fretted);
  if (hi <= 4) return { start: 1, span: 4 };
  return { start: lo, span: Math.max(4, hi - lo + 1) };
}

export function chordDiagram(frets, tuningNotes, rootPc, { mirror = false } = {}) {
  const n = tuningNotes.length;
  const { start, span } = windowOf(frets);
  const W = 150, padL = 29, padR = 12, top = 26, BH = 124;
  const gx = (W - padL - padR) / (n - 1);
  const ch = BH / span;
  const H = top + BH + 6;
  const r = Math.min(gx, ch) * 0.43;
  // left-hand mode: strings mirrored, fret numbers on the right
  const left = mirror ? padR : padL, right = mirror ? W - padL : W - padR;
  const xs = (s) => (mirror ? right - s * gx : left + s * gx);
  const y0 = top;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'diagram', 'aria-hidden': 'true' });
  for (let k = 1; k <= span; k++) el('line', { x1: left, x2: right, y1: y0 + k * ch, y2: y0 + k * ch, class: 'd-fret' }, svg);
  el('line', { x1: left - (start === 1 ? 1.5 : 0), x2: right + (start === 1 ? 1.5 : 0), y1: y0, y2: y0, class: start === 1 ? 'd-nut' : 'd-fret d-top' }, svg);
  for (let s = 0; s < n; s++) el('line', { x1: xs(s), x2: xs(s), y1: y0, y2: y0 + span * ch, class: 'd-string', 'stroke-width': 0.8 + (n - 1 - s) * 0.26 }, svg);
  for (let k = 0; k < span; k++) {
    el('text', { x: mirror ? W - 8 : 8, y: y0 + (k + 0.5) * ch, class: 'd-num' }, svg).textContent = start + k;
  }

  for (let s = 0; s < n; s++) {
    const f = frets[s];
    const x = xs(s);
    if (f == null) {
      const m = 4;
      el('path', { d: `M${x - m},${top / 2 - m}L${x + m},${top / 2 + m}M${x + m},${top / 2 - m}L${x - m},${top / 2 + m}`, class: 'd-x' }, svg);
      continue;
    }
    const midi = tuningNotes[s] + f;
    const isRoot = pc(midi) === rootPc;
    const label = noteName(midi);
    if (f === 0) {
      el('text', { x, y: top / 2, class: 'd-open' + (isRoot ? ' root' : '') }, svg).textContent = label;
      continue;
    }
    const y = y0 + (f - start + 0.5) * ch;
    if (isRoot) el('rect', { x: x - r, y: y - r, width: 2 * r, height: 2 * r, rx: r * 0.32, class: 'd-root' }, svg);
    else el('circle', { cx: x, cy: y, r, class: 'd-dot' }, svg);
    el('text', { x, y, class: 'd-label', 'font-size': (label.length > 1 ? 0.88 : 1.02) * r }, svg).textContent = label;
  }
  return svg;
}
