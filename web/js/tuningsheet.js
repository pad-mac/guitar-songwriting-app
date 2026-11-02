// The tunings sheet: presets plus own tunings; pick one, or copy/edit/delete own ones.
import { PRESETS, MIN_NOTE, MAX_NOTE } from './tunings.js';
import { noteName, noteWithOctave } from './chords.js';
import { $, h, ask } from './ui.js';

const sheet = () => $('sheet');
export const sheetOpen = () => sheet().classList.contains('open');
let returnFocus = null;

export function closeSheet() {
  sheet().classList.remove('open');
  sheet().setAttribute('aria-hidden', 'true');
  returnFocus?.focus({ preventScroll: true });
}

/**
 * opts: { current: {name, notes}, custom: [{id, name, notes}],
 *         onPick(tuning), onCustomChange(list) → Promise }
 */
export function openTuningSheet(opts) {
  returnFocus = document.activeElement;
  const s = sheet();
  s.querySelector('.scrim').onclick = closeSheet;
  $('sheetClose').onclick = closeSheet;
  $('sheetBack').onclick = () => showList(opts);
  showList(opts);
  s.classList.add('open');
  s.setAttribute('aria-hidden', 'false');
}

const same = (a, b) => a.notes.length === b.notes.length && a.notes.every((n, i) => n === b.notes[i]);

function showList(opts) {
  $('sheetTitle').textContent = 'Tunings';
  $('sheetBack').hidden = true;
  $('sheetClose').textContent = 'Done';
  const all = [...PRESETS.map((t) => ({ ...t, preset: true })), ...opts.custom];
  const currentIdx = all.findIndex((t) => same(t, opts.current) && t.name === opts.current.name);
  const fallbackIdx = currentIdx >= 0 ? currentIdx : all.findIndex((t) => same(t, opts.current));
  const rows = all.map((t, i) => {
    const pick = h('button', { type: 'button', className: 'tuning-pick' },
      h('span', { className: 'tn', textContent: t.notes.map(noteName).join(' ') }),
      h('span', { className: 'tname', textContent: t.name }));
    pick.setAttribute('aria-pressed', String(i === fallbackIdx));
    pick.addEventListener('click', () => { closeSheet(); opts.onPick({ name: t.name, notes: [...t.notes] }); });
    const edit = h('button', { type: 'button', className: 'ghost-btn', textContent: t.preset ? 'Copy' : 'Edit', title: t.preset ? 'Make your own tuning from this one' : 'Edit this tuning' });
    edit.addEventListener('click', () => showEditor(opts, t));
    return h('li', {}, pick, edit);
  });
  const add = h('button', { type: 'button', className: 'add-btn', textContent: 'New tuning' });
  add.addEventListener('click', () => showEditor(opts, { name: '', notes: [...opts.current.notes], preset: true }));
  $('sheetBody').replaceChildren(h('ul', { className: 'tunings' }, rows), add);
}

function showEditor(opts, src) {
  const own = !src.preset;
  $('sheetTitle').textContent = own ? 'Edit tuning' : 'New tuning';
  $('sheetBack').hidden = false;
  $('sheetClose').textContent = 'Cancel';
  const notes = [...src.notes];
  const name = h('input', { type: 'text', className: 'name-input', value: own ? src.name : src.name ? `${src.name} (own)` : '', placeholder: 'Name', maxLength: 40 });
  const strings = h('ol', { className: 'string-edit' });
  const draw = () => strings.replaceChildren(...notes.map((n, i) => {
    const down = h('button', { type: 'button', className: 'step', textContent: '−', ariaLabel: 'Lower a semitone', disabled: n <= MIN_NOTE });
    const up = h('button', { type: 'button', className: 'step', textContent: '+', ariaLabel: 'Raise a semitone', disabled: n >= MAX_NOTE });
    down.addEventListener('click', () => { notes[i]--; draw(); });
    up.addEventListener('click', () => { notes[i]++; draw(); });
    return h('li', {}, h('span', { className: 'sn', textContent: `String ${notes.length - i}` }), down, h('span', { className: 'nv', textContent: noteWithOctave(n) }), up);
  }));
  draw();
  const save = h('button', { type: 'button', className: 'primary', textContent: 'Save and use' });
  save.addEventListener('click', async () => {
    const label = name.value.trim() || notes.map(noteName).join(' ');
    const list = own
      ? opts.custom.map((t) => (t.id === src.id ? { ...t, name: label, notes: [...notes] } : t))
      : [...opts.custom, { id: 'custom-' + Date.now().toString(36), name: label, notes: [...notes] }];
    opts.custom = list;
    await opts.onCustomChange(list);
    closeSheet();
    opts.onPick({ name: label, notes: [...notes] });
  });
  const actions = h('div', { className: 'actions' }, save);
  if (own) {
    const del = h('button', { type: 'button', className: 'danger', textContent: 'Delete' });
    del.addEventListener('click', async () => {
      const ok = await ask({ title: `Delete “${src.name}”?`, text: 'Songs that use it keep their tuning.', buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, kind: 'danger-fill' }] });
      if (!ok) return;
      opts.custom = opts.custom.filter((t) => t.id !== src.id);
      await opts.onCustomChange(opts.custom);
      showList(opts);
    });
    actions.prepend(del);
  }
  $('sheetBody').replaceChildren(name, strings, actions);
}
