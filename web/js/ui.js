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
    wrap.querySelector('.scrim').onclick = () => done(null);
    document.addEventListener('keydown', onKey, true);
    wrap.classList.add('open');
    wrap.setAttribute('aria-hidden', 'false');
    row.lastChild?.focus({ preventScroll: true });
  });
}

// ---- inline rename ------------------------------------------------------------------------
// Replaces `el`'s text with an input; Enter or leaving the field saves, Escape cancels.

export function inlineEdit(el, value, onSave) {
  if (el.querySelector('input')) return;
  const input = h('input', { type: 'text', className: 'inline-input', value, maxLength: 120 });
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
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}
