const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/fraction.js');
const C = require('../src/calc.js');

// Press a space-separated sequence of keys; "/" is the frac key shorthand "|".
function run(keys, s = C.initial()) {
  for (const k of keys.split(' ')) {
    if (k.length > 1 && /^\d+$/.test(k)) for (const d of k) s = C.press(s, d);
    else s = C.press(s, k === '|' ? 'frac' : k);
  }
  return s;
}
const ans = (s) => (s.result ? F.toText(s.result, s.improper) : null);

test('mixed number plus fraction', () => {
  const s = run('1 | 3 | 4 + 2 | 3 =');
  assert.equal(ans(s), '2 5/12');
  assert.equal(s.expr, '1 3/4 + 2/3 =');
  assert.equal(s.history.length, 1);
});

test('all four operations', () => {
  assert.equal(ans(run('1 | 2 - 3 | 4 =')), '−1/4');
  assert.equal(ans(run('5 | 6 * 3 | 10 =')), '1/4');
  assert.equal(ans(run('2 | 1 | 2 / 3 | 4 =')), '3 1/3');
});

test('chaining works left to right and from an answer', () => {
  assert.equal(ans(run('1 | 2 + 1 | 3 * 6 =')), '5');
  assert.equal(ans(run('1 | 2 + 1 | 2 = * 3 =')), '3');
});

test('= on a lone entry simplifies it', () => {
  assert.equal(ans(run('6 | 8 =')), '3/4');
  assert.equal(ans(run('14 | 4 =')), '3 1/2');
});

test('changing the operation before the second number', () => {
  const s = run('3 | 4 + - 1 | 4 =');
  assert.equal(ans(s), '1/2');
});

test('sign, backspace and improper display', () => {
  assert.equal(ans(run('neg 1 | 2 + 1 =')), '1/2');
  assert.equal(ans(run('1 | 34 back + 0 =')), '1/3');
  const s = run('1 | 3 | 4 = dc');
  assert.equal(ans(s), '7/4');
});

test('hints keep the entry instead of wiping it', () => {
  let s = run('3 | +');
  assert.equal(s.flash, 'Enter the bottom number');
  assert.deepEqual(s.segs, ['3', '']);
  s = run('3 | 0 =');
  assert.match(s.flash, /can.t be 0/);
  s = run('|');
  assert.equal(s.flash, 'Type a number first');
});

test('dividing by zero shows an error, and the next key starts fresh', () => {
  let s = run('1 | 2 / 0 =');
  assert.equal(s.error, 'Can’t divide by 0');
  s = run('5 =', s);
  assert.equal(ans(s), '5');
});

test('recall loads an earlier answer into the entry', () => {
  let s = run('1 | 3 | 4 + 2 | 3 = C');
  s = run('recall:0 * 12 =', s);
  assert.equal(ans(s), '29');
});

test('entries cap at six digits per part', () => {
  const s = run('1234567');
  assert.deepEqual(s.segs, ['123456']);
});
