const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/fraction.js');

const t = (f, improper) => F.toText(f, improper);

test('make reduces and normalises the sign', () => {
  assert.deepEqual(F.make(6, 8), { n: 3n, d: 4n });
  assert.deepEqual(F.make(3, -9), { n: -1n, d: 3n });
  assert.deepEqual(F.make(0, 5), { n: 0n, d: 1n });
  assert.throws(() => F.make(1, 0), RangeError);
});

test('arithmetic', () => {
  assert.equal(t(F.add(F.make(7, 4), F.make(2, 3))), '2 5/12');
  assert.equal(t(F.sub(F.make(1, 2), F.make(3, 4))), '−1/4');
  assert.equal(t(F.mul(F.make(5, 6), F.make(3, 10))), '1/4');
  assert.equal(t(F.div(F.make(5, 2), F.make(3, 4))), '3 1/3');
  assert.throws(() => F.div(F.make(1, 2), F.make(0)), RangeError);
});

test('text forms', () => {
  assert.equal(t(F.make(7, 4)), '1 3/4');
  assert.equal(t(F.make(7, 4), true), '7/4');
  assert.equal(t(F.make(-7, 4)), '−1 3/4');
  assert.equal(t(F.make(8, 4)), '2');
});

test('decimals mark repeating digits', () => {
  assert.equal(F.decimalText(F.make(3, 4)), '0.75');
  assert.equal(F.decimalText(F.make(2, 3)), '0.(6)');
  assert.equal(F.decimalText(F.make(1, 6)), '0.1(6)');
  assert.equal(F.decimalText(F.make(-22, 7)), '−3.(142857)');
  assert.equal(F.decimalText(F.make(5)), '5');
  assert.equal(F.decimalText(F.make(1, 97), 12), '0.010309278350…');
});

test('no precision loss on big chains', () => {
  let f = F.make(1, 3);
  for (let i = 0; i < 40; i++) f = F.mul(f, F.make(999983, 999979));
  f = F.div(f, f);
  assert.equal(t(f), '1');
});
