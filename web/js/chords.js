// Chord naming. No lookup table: every note that sounds is tried as the root, and a name is
// built from the intervals the other notes make with it. Names follow Oolimo's convention:
// quality + 6/7 + sus, then the tensions in brackets — Cmaj7(9), D7sus2(13), Bm(addb9,add11).
// Spelling uses sharps only.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const pc = (midi) => ((midi % 12) + 12) % 12;
export const noteName = (midi) => NOTE_NAMES[pc(midi)];
export const noteWithOctave = (midi) => NOTE_NAMES[pc(midi)] + (Math.floor(midi / 12) - 1);

// order of the tensions inside the brackets
const ORDER = { b5: 1, '#5': 2, b9: 3, 9: 4, '#9': 5, 11: 6, '#11': 7, b6: 8, b13: 8, 13: 9, maj7: 10, no3: 99 };
const ALTERED = new Set(['b5', '#5', 'b9', '#9', '#11', 'b13', 'b6']);
const NO_ADD = new Set(['no3', 'b5', '#5', 'b6']);   // written as they are even without a 7th

/**
 * Name the chord built on `root` (pitch class 0–11) from the set of interval classes
 * present (`ivs`, a Set of 1–11; the root itself is implied).
 * Returns { parts, text, labels, score }:
 *   parts  — [{ t: text, k: 'root'|'sub'|'sup' }] for typesetting
 *   text   — the plain name, e.g. "D7sus2(13)"
 *   labels — interval class → its role in this chord ("1", "m3", "b13", …)
 *   score  — lower is simpler (used to order the alternatives)
 */
export function nameChord(root, ivs) {
  const has = (i) => ivs.has(i);
  const rootName = NOTE_NAMES[root];
  const labels = { 0: '1' };
  const tensions = [];               // without the "add" prefix; added below for chords without a 7th
  let quality = '';                  // '', 'm', 'dim', 'aug'
  let ext = '';                      // '6', '6/9', '7', 'maj7', 'dim7', '5'
  let sus = '';
  let lateSup = '';                  // 'b6' after sus (Gsus4b6)
  let score = 0;

  if (ivs.size === 0) return finish();
  if (ivs.size === 1 && has(7)) { labels[7] = '5'; ext = '5'; return finish(); }

  // third
  let third = 0;
  if (has(4)) { third = 4; labels[4] = '3'; if (has(3)) { labels[3] = '#9'; tensions.push('#9'); } }
  else if (has(3)) { third = 3; quality = 'm'; labels[3] = 'm3'; }

  let usedSus = 0;
  if (!third) {
    if (has(5)) { sus = 'sus4'; usedSus = 5; labels[5] = '4'; }
    else if (has(2)) { sus = 'sus2'; usedSus = 2; labels[2] = '2'; }
  }

  // fifth
  const p5 = has(7);
  if (p5) labels[7] = '5';
  let six = null;                    // role of interval 6: 'b5' as the chord's fifth | 'b5' tension | '#11'
  let dimFifth = false;
  if (has(6)) {
    if (p5) six = '#11';
    else if (third === 3) { dimFifth = true; six = 'b5'; }
    else if (third === 4) six = has(2) ? '#11' : 'b5';
    else six = 'b5';
  }
  const sharp5 = has(8) && third === 4 && !p5 && six !== 'b5';

  // seventh
  const b7 = has(10), M7 = has(11);
  let seventh = b7 || M7;
  let used9 = false;
  if (dimFifth) {
    labels[6] = 'b5';
    if (b7) { ext = '7'; labels[10] = 'b7'; tensions.push('b5'); if (M7) { labels[11] = '7'; tensions.push('maj7'); } }
    else if (M7) { ext = 'maj7'; labels[11] = '7'; tensions.push('b5'); }
    else if (has(9)) { quality = 'dim'; ext = '7'; labels[9] = 'bb7'; used9 = true; seventh = true; }
    else quality = 'dim';
  } else {
    if (b7) { ext = '7'; labels[10] = 'b7'; if (M7) { labels[11] = '7'; tensions.push('maj7'); } }
    else if (M7) { ext = 'maj7'; labels[11] = '7'; }
    if (six) { labels[6] = six; tensions.push(six); }
  }

  // #5 / b6 / b13
  if (has(8)) {
    if (sharp5) {
      labels[8] = '#5';
      if (seventh) tensions.push('#5'); else quality = 'aug';
    } else if (seventh) { labels[8] = 'b13'; tensions.push('b13'); }
    else { labels[8] = 'b6'; if (!has(9)) { if (quality || sus) lateSup = 'b6'; else tensions.push('b6'); } else tensions.push('b13'); }
  }

  // 6 / 13
  let used2 = usedSus === 2;
  if (has(9) && !used9) {
    if (seventh) { labels[9] = '13'; tensions.push('13'); }
    else if (has(2) && !used2) { ext = '6/9'; labels[9] = '6'; labels[2] = '9'; used2 = true; }
    else { ext = '6'; labels[9] = '6'; }
  }

  // b9, 9, 11
  if (has(1)) { labels[1] = 'b9'; tensions.push('b9'); }
  if (has(2) && !used2) { labels[2] = '9'; tensions.push('9'); }
  if (has(5) && usedSus !== 5) { labels[5] = '11'; tensions.push('11'); }

  if (!third && !sus) tensions.push('no3');

  // simplicity score
  for (const t of tensions) score += t === 'no3' ? 4 : 1 + (ALTERED.has(t) ? 1 : 0) + (t === 'b9' && !seventh ? 1 : 0);
  if (sus) score += 1.5;
  if (lateSup) score += 2;
  if (quality === 'dim' || quality === 'aug') score += 0.5;
  if (!p5 && !six && !sharp5) score += 0.5;
  if (ext === '6' || ext === '6/9') score += 0.3;

  return finish();

  function finish() {
    tensions.sort((a, b) => ORDER[a] - ORDER[b]);
    const inBrackets = tensions.map((t) => (seventh || NO_ADD.has(t) ? t : 'add' + t));
    const parts = [{ t: rootName, k: 'root' }];
    if (quality) parts.push({ t: quality, k: 'sub' });
    if (ext) parts.push({ t: ext, k: 'sup' });
    if (sus) parts.push({ t: sus, k: 'sub' });
    if (lateSup) parts.push({ t: lateSup, k: 'sup' });
    if (inBrackets.length) parts.push({ t: '(' + inBrackets.join(',') + ')', k: 'sup' });
    return { parts, text: parts.map((p) => p.t).join(''), labels, score };
  }
}

/**
 * All names for a set of sounding notes (MIDI numbers, any order, nulls ignored):
 * one per distinct pitch class taken as the root. The name on the bass note comes first,
 * the others follow from simplest to most involved (ties: lowest note first).
 */
export function analyze(midiNotes) {
  const notes = midiNotes.filter((n) => n != null).sort((a, b) => a - b);
  if (!notes.length) return [];
  const order = [];
  for (const n of notes) if (!order.includes(pc(n))) order.push(pc(n));
  const out = order.map((root, i) => {
    const ivs = new Set(order.filter((p) => p !== root).map((p) => (p - root + 12) % 12));
    return { root, bass: i === 0, rank: i, ...nameChord(root, ivs) };
  });
  const [bass, ...rest] = out;
  rest.sort((a, b) => a.score - b.score || a.rank - b.rank);
  return [bass, ...rest];
}
