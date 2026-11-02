import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../web/js/chords.js';

const STANDARD = [40, 45, 50, 55, 59, 64];
// frets low E → high e; 'x' = muted
const play = (shape, tuning = STANDARD) =>
  analyze(shape.split(' ').map((f, i) => (f === 'x' ? null : tuning[i] + Number(f))));
const names = (shape) => play(shape).map((c) => c.text);
const first = (shape) => play(shape)[0].text;

// The five shapes from the Oolimo screenshots (Oolimo's flats respelled as sharps).
// Oolimo lists the alternatives from low to high string; we order them by simplicity,
// so these compare the set of names, plus the bass name first.
const OOLIMO = [
  ['0 3 0 4 x x', ['E7(b13,no3)', 'Cmaj7(9)', 'D7sus2(13)', 'Bm(addb9,add11)']],
  ['x 0 4 0 x x', ['A7(13,no3)', 'F#m(addb9)', 'Gmaj7sus2']],
  ['x 1 0 0 1 x', ['A#6/9', 'D7sus4(b13)', 'Gm(add11)', 'C7sus2']],
  ['x 3 1 0 3 x', ['Cm(add9)', 'D#maj7(13)', 'Gsus4b6', 'D7sus4(b9)']],
  ['0 3 0 3 x x', ['E7(b5,b13,no3)', 'C7(9)', 'D7sus2(b13)', 'A#(add9,add#11)']],
];

for (const [shape, expected] of OOLIMO) {
  test(`Oolimo case ${shape}`, () => {
    const got = names(shape);
    assert.equal(got[0], expected[0]);
    assert.deepEqual([...got].sort(), [...expected].sort());
  });
}

test('everyday chords', () => {
  assert.equal(first('x 3 2 0 1 0'), 'C');
  assert.equal(first('x 0 2 2 1 0'), 'Am');
  assert.equal(first('3 2 0 0 0 1'), 'G7');
  assert.equal(first('x 0 2 0 2 0'), 'A7');
  assert.equal(first('x x 0 2 1 1'), 'Dm7');
  assert.equal(first('x x 0 2 3 2'), 'D');
  assert.equal(first('x x 0 2 3 0'), 'Dsus2');
  assert.equal(first('x x 0 2 3 3'), 'Dsus4');
  assert.equal(first('x 3 2 0 0 0'), 'Cmaj7');
  assert.equal(first('x 0 2 0 1 0'), 'Am7');
  assert.equal(first('x 3 2 2 1 0'), 'C6');
  assert.equal(first('0 2 2 x x x'), 'E5');
  assert.equal(first('x 3 2 3 4 x'), 'C7(#9)');
  assert.equal(first('x 2 3 2 3 x'), 'Bm7(b5)');
  assert.equal(first('x 2 3 1 3 1'), 'Bdim7');
  assert.equal(first('x 2 3 4 3 x'), 'Bdim');
  assert.equal(first('x x 2 1 1 0'), 'Eaug');
  assert.equal(first('3 x 3 4 5 x'), 'G7(13)');
  assert.equal(first('x 3 2 0 3 0'), 'C(add9)');
  assert.equal(first('x 0 2 2 0 0'), 'Asus2');
});

test('alternatives come after the bass name, simplest first', () => {
  const got = names('x 3 2 2 1 0'); // C E A C E
  assert.deepEqual(got.slice(0, 2), ['C6', 'Am']);
});

test('a single note and an empty board', () => {
  assert.deepEqual(names('x x x 2 x x'), ['A']);
  assert.deepEqual(play('x x x x x x'), []);
});

test('interval labels follow the name', () => {
  const [e] = play('0 3 0 4 x x');
  assert.equal(e.labels[0], '1');
  assert.equal(e.labels[8], 'b13');
  assert.equal(e.labels[10], 'b7');
  assert.equal(e.labels[7], '5');
  const [cm] = play('x 3 1 0 3 x');
  assert.deepEqual([cm.labels[0], cm.labels[3], cm.labels[7], cm.labels[2]], ['1', 'm3', '5', '9']);
});

test('every set of 1–6 pitch classes gets a name on every root without throwing', () => {
  for (let mask = 1; mask < 4096; mask++) {
    const pcs = [...Array(12).keys()].filter((i) => mask & (1 << i));
    if (pcs.length > 6) continue;
    const res = analyze(pcs.map((p) => 48 + p));
    assert.equal(res.length, pcs.length);
    for (const c of res) {
      assert.ok(c.text.length > 0);
      for (const p of pcs) assert.ok(c.labels[(p - c.root + 12) % 12], `${c.text}: no label for ${p}`);
    }
  }
});
