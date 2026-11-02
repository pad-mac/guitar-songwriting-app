// The fretboard as one SVG, sized in real pixels (viewBox = element size) so dots stay round.
// 'v' (phone): strings run top→bottom, low string on the left, nut at the top.
// 'h' (wide screens): strings run left→right, high string on top, nut on the left.
// Each string has one persistent dot, so moving it (another fret, Lower/Higher) slides.

const SVG = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, parent) => {
  const n = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];

export class Fretboard {
  constructor(container, { frets = 15, onTap } = {}) {
    this.container = container;
    this.frets = frets;
    this.onTap = onTap;
    this.orientation = 'v';
    this.strings = 6;
    this.data = null;
    this.size = [0, 0];
    this.svg = el('svg', { class: 'fb', role: 'application', 'aria-label': 'Fretboard' }, container);
    new ResizeObserver(() => this.#maybeBuild()).observe(container);
    this.svg.addEventListener('click', (e) => {
      const hit = this.#hit(e);
      if (hit) this.onTap?.(hit.s, hit.f);
    });
    this.svg.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') this.#hover(this.#hit(e)); });
    this.svg.addEventListener('pointerleave', () => this.#hover(null));
  }

  configure({ orientation, strings }) {
    const changed = (orientation && orientation !== this.orientation) || (strings && strings !== this.strings);
    if (orientation) this.orientation = orientation;
    if (strings) this.strings = strings;
    if (changed) this.#build();
  }

  /** data: { frets: [fret|null], main: [text], secondary: [text], root: [bool], secondaryRoot: [bool] } */
  update(data) {
    this.data = data;
    if (!this.g) return;
    const { r } = this.g;
    for (let s = 0; s < this.strings; s++) {
      const f = data.frets[s];
      const dot = this.dots[s];
      const on = f != null;
      if (on) {
        const [x, y] = this.g.xy(this.g.along(f), this.g.across(s));
        const wasOn = dot.node.classList.contains('on');
        if (!wasOn) dot.node.classList.add('jump');
        dot.node.style.transform = `translate(${x}px, ${y}px)`;
        if (!wasOn) { dot.node.getBoundingClientRect(); dot.node.classList.remove('jump'); }
        const label = data.main[s] || '';
        dot.text.textContent = label;
        dot.text.setAttribute('font-size', (label.length > 2 ? 0.74 : 0.92) * r);
      }
      dot.node.classList.toggle('on', on);
      dot.node.classList.toggle('root', on && !!data.root[s]);
      this.marks[s].classList.toggle('on', !on);
      const sec = this.secondary[s];
      sec.textContent = on ? data.secondary[s] || '' : '';
      sec.classList.toggle('root', on && !!data.secondaryRoot?.[s]);
    }
  }

  #maybeBuild() {
    const { width, height } = this.container.getBoundingClientRect();
    const w = Math.round(width), h = Math.round(height);
    if (w === this.size[0] && h === this.size[1]) return;
    this.size = [w, h];
    this.#build();
  }

  #geometry(W, H) {
    const v = this.orientation === 'v';
    const n = this.strings, N = this.frets;
    const L = v ? H : W, A = v ? W : H;
    const numLane = v ? 24 : 22;
    const cell = L / (N + 1.9);
    const open = cell * 0.95, lab = cell * 0.95;
    const nut = v ? open : lab + open;
    const gap = (A - numLane) / n;
    const along = (f) => (f === 0 ? nut - open / 2 : nut + (f - 0.5) * cell);
    const wire = (f) => nut + f * cell;
    const across = (s) => (v ? numLane + gap * (s + 0.5) : gap * (n - 1 - s + 0.5));
    const xy = (a, c) => (v ? [c, a] : [a, c]);
    const r = Math.max(9, Math.min(22, Math.min(cell, gap) * 0.42));
    return {
      v, n, N, cell, open, lab, nut, gap, numLane, r, along, wire, across, xy,
      labA: v ? nut + N * cell + lab / 2 : lab / 2,
      numC: v ? numLane / 2 - 2 : A - numLane / 2 + 2,
    };
  }

  #build() {
    const [W, H] = this.size;
    if (!W || !H) return;
    const g = (this.g = this.#geometry(W, H));
    const svg = this.svg;
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    const line = (a1, c1, a2, c2, attrs, parent) => {
      const [x1, y1] = g.xy(a1, c1), [x2, y2] = g.xy(a2, c2);
      return el('line', { x1, y1, x2, y2, ...attrs }, parent);
    };
    const c0 = g.across(0), cN = g.across(g.n - 1);
    const cLo = Math.min(c0, cN), cHi = Math.max(c0, cN);
    const lerpC = (t) => c0 + (cN - c0) * t;

    // inlays
    const inl = el('g', { class: 'inlay' }, svg);
    const ir = Math.max(4, g.r * 0.34);
    for (let f = 1; f <= g.N; f++) {
      const at = f % 12 === 0 ? [0.3, 0.7] : INLAYS.includes(f) ? [0.5] : [];
      for (const t of at) { const [cx, cy] = g.xy(g.along(f), lerpC(t)); el('circle', { cx, cy, r: ir }, inl); }
    }
    // frets and nut
    const wires = el('g', { class: 'wires' }, svg);
    for (let f = 1; f <= g.N; f++) line(g.wire(f), cLo, g.wire(f), cHi, {}, wires);
    line(g.nut, cLo - 1, g.nut, cHi + 1, { class: 'nut' }, svg);
    // strings (heavier for the low ones)
    const strs = el('g', { class: 'strings' }, svg);
    for (let s = 0; s < g.n; s++) line(g.nut, g.across(s), g.wire(g.N), g.across(s), { 'stroke-width': 1 + (g.n - 1 - s) * 0.22 }, strs);
    // fret numbers
    const nums = el('g', { class: 'nums' }, svg);
    for (let f = 0; f <= g.N; f++) {
      const [x, y] = g.xy(g.along(f), g.numC);
      el('text', { x, y }, nums).textContent = f;
    }
    // muted marks in the open lane
    const marks = el('g', { class: 'marks' }, svg);
    const m = g.r * 0.55;
    this.marks = [];
    for (let s = 0; s < g.n; s++) {
      const [x, y] = g.xy(g.along(0), g.across(s));
      const grp = el('g', { class: 'mark' }, marks);
      el('path', { d: `M${x - m},${y - m}L${x + m},${y + m}M${x + m},${y - m}L${x - m},${y + m}` }, grp);
      this.marks.push(grp);
    }
    // secondary labels (intervals under note names, or the other way round)
    const secs = el('g', { class: 'secondary' }, svg);
    this.secondary = [];
    for (let s = 0; s < g.n; s++) {
      const [x, y] = g.xy(g.labA, g.across(s));
      const t = el('text', { x, y, 'font-size': Math.min(17, g.r * 0.95) }, secs);
      this.secondary.push(t);
    }
    // hover ghost
    this.ghost = el('circle', { class: 'ghost', r: g.r, cx: 0, cy: 0 }, svg);
    // dots
    const dots = el('g', { class: 'dots' }, svg);
    this.dots = [];
    for (let s = 0; s < g.n; s++) {
      const node = el('g', { class: 'dot jump' }, dots);
      const body = el('g', { class: 'body' }, node);
      el('circle', { class: 'disc', r: g.r }, body);
      const q = g.r * 0.96;
      el('rect', { class: 'square', x: -q, y: -q, width: 2 * q, height: 2 * q, rx: g.r * 0.32 }, body);
      const text = el('text', { class: 'label' }, body);
      this.dots.push({ node, text });
    }
    if (this.data) this.update(this.data);
    requestAnimationFrame(() => this.dots.forEach((d) => d.node.classList.remove('jump')));
  }

  #hit(e) {
    const g = this.g;
    if (!g) return null;
    const box = this.svg.getBoundingClientRect();
    const x = e.clientX - box.left, y = e.clientY - box.top;
    const a = g.v ? y : x, c = g.v ? x : y;
    let f = null;
    if (a >= g.nut - g.open && a < g.nut) f = 0;
    else if (a >= g.nut && a <= g.wire(g.N)) f = Math.min(g.N, Math.max(1, Math.ceil((a - g.nut) / g.cell)));
    if (f == null) return null;
    const k = g.v ? Math.floor((c - g.numLane) / g.gap) : Math.floor(c / g.gap);
    const s = g.v ? k : g.n - 1 - k;
    if (s < 0 || s >= g.n) return null;
    return { s, f };
  }

  #hover(hit) {
    if (!this.ghost) return;
    const show = hit && this.data && this.data.frets[hit.s] !== hit.f;
    if (show) {
      const [x, y] = this.g.xy(this.g.along(hit.f), this.g.across(hit.s));
      this.ghost.setAttribute('cx', x);
      this.ghost.setAttribute('cy', y);
    }
    this.ghost.classList.toggle('on', !!show);
    this.svg.style.cursor = hit ? 'pointer' : '';
  }
}
