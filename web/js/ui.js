// Small DOM helpers shared by the views.

export const $ = (id) => document.getElementById(id);

export function h(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
  return n;
}

export const svgIcon = (d, cls = '') => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = `<path d="${d}"/>`;
  return s;
};
export const ICON = {
  back: 'M15 6l-6 6 6 6',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  plus: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
};

export function chordHTML(parts) {
  const span = h('span', { className: 'ch' });
  for (const p of parts) span.append(h('span', { className: p.k, textContent: p.t }));
  return span;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const formatDate = (ms) => dateFmt.format(new Date(ms));

// ---- toast --------------------------------------------------------------------------------

let toastTimer;
export function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}

// ---- dialog -------------------------------------------------------------------------------
// ask({ title, text, buttons: [{ label, value, kind }] }) → value of the button, or null

export function ask({ title, text = '', buttons }) {
  const wrap = $('dialog');
  const box = wrap.querySelector('.dialog');
  return new Promise((resolve) => {
    const done = (v) => {
      wrap.classList.remove('open');
      wrap.setAttribute('aria-hidden', 'true');
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
    };
    const row = h('div', { className: 'dialog-buttons' }, buttons.map((b) => {
      const el = h('button', { type: 'button', className: b.kind || 'plain', textContent: b.label });
      el.addEventListener('click', () => done(b.value));
      return el;
    }));
    box.replaceChildren(...[h('h3', { textContent: title }), text ? h('p', { textContent: text }) : null, row].filter(Boolean));
    const opened = performance.now();
    wrap.querySelector('.scrim').onclick = () => { if (performance.now() - opened > 400) done(null); };
    document.addEventListener('keydown', onKey, true);
    wrap.classList.add('open');
    wrap.setAttribute('aria-hidden', 'false');
    row.lastChild?.focus({ preventScroll: true });
  });
}

// ---- menus -------------------------------------------------------------------------------
// A frosted panel at the finger (or at the button that opened it), as in the reader.
// menu({ title, items: [{ label, hint, value, kind }], at: { x, y, el, held } }) → Promise of the picked
// value or null, with .close(). When the finger that opened it is still down (at.held), nothing in it
// counts until a moment after that finger is lifted (the window event 'gsa:lp-up').

export const atEl = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top, el }; };

export function menu({ title, items, at }) {
  at = at || { x: window.innerWidth / 2, y: window.innerHeight * 0.55 };
  const scrim = h('div', { className: 'menu-scrim' });
  const panel = h('div', { className: 'pop-menu', role: 'menu' });
  let armedAt = at.held ? Infinity : performance.now() + 250;
  const lifted = () => { if (armedAt === Infinity) armedAt = performance.now() + 120; };
  const armed = () => performance.now() >= armedAt;
  let resolve, done = false;
  const p = new Promise((r) => { resolve = r; });
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } };
  function close(v) {
    if (done) return;
    done = true;
    window.removeEventListener('gsa:lp-up', lifted);
    document.removeEventListener('keydown', onKey, true);
    scrim.classList.remove('on');
    panel.classList.remove('on');
    at.el?.classList.remove('lp-on');
    setTimeout(() => { scrim.remove(); panel.remove(); }, 180);
    resolve(v);
  }
  window.addEventListener('gsa:lp-up', lifted);
  document.addEventListener('keydown', onKey, true);
  scrim.addEventListener('click', () => { if (armed()) close(null); });
  if (title) panel.append(h('div', { className: 'menu-head' }, h('span', { textContent: title })));
  for (const it of items) {
    const b = h('button', { type: 'button', role: 'menuitem', className: 'menu-item' + (it.kind ? ' ' + it.kind : '') },
      h('span', { className: 'menu-label', textContent: it.label }),
      it.hint ? h('small', { className: 'menu-hint', textContent: it.hint }) : null);
    b.addEventListener('click', () => { if (armed()) close(it.value); });
    panel.append(b);
  }
  document.body.append(scrim, panel);
  // under the finger if there is room, else above it; never off the screen
  const vw = window.innerWidth, vh = window.innerHeight;
  const lo = 12, hi = vh - 12;
  panel.style.maxHeight = `${hi - lo}px`;
  const w = panel.offsetWidth, ht = panel.offsetHeight;
  const left = Math.max(12, Math.min(vw - w - 12, at.x - w / 2));
  const below = at.y + 14 + ht <= hi, above = at.y - 14 - ht >= lo;
  const top = below ? at.y + 14 : above ? at.y - 14 - ht : Math.max(lo, Math.min(hi - ht, at.y + 14));
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.transformOrigin = `${Math.round(at.x - left)}px ${below || !above ? '0px' : '100%'}`;
  at.el?.classList.add('lp-on');
  requestAnimationFrame(() => { scrim.classList.add('on'); panel.classList.add('on'); });
  p.close = () => close(null);
  return p;
}

// ---- inline rename ------------------------------------------------------------------------
// Replaces `el`'s text with an input; Enter or leaving the field saves, Escape cancels.

export function inlineEdit(el, value, onSave, { placeholder = '', onCancel } = {}) {
  if (el.querySelector('input')) return;
  const input = h('input', { type: 'text', className: 'inline-input', value, placeholder, maxLength: 120, enterKeyHint: 'done' });
  const old = [...el.childNodes];
  el.replaceChildren(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    const v = input.value.trim();
    el.replaceChildren(...old);
    if (save && v && v !== value) await onSave(v);
    else onCancel?.(save);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}
