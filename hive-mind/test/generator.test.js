import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLevel, tierOf } from '../src/generator.js';
import { replay } from '../src/engine.js';

test('tiers: every 5th level hard, every 10th super hard', () => {
  assert.equal(tierOf(1), 'normal');
  assert.equal(tierOf(5), 'hard');
  assert.equal(tierOf(10), 'super');
  assert.equal(tierOf(15), 'hard');
  assert.equal(tierOf(23), 'normal');
});

test('levels are deterministic', () => {
  const a = generateLevel(17), b = generateLevel(17);
  assert.deepEqual(a.columns, b.columns);
  assert.deepEqual(a.cells, b.cells);
});

test('levels 1-120 are solvable and well formed', () => {
  for (let n = 1; n <= 120; n++) {
    const L = generateLevel(n);
    assert.ok(replay(L, L.solution), `level ${n} solution replays`);
    const counts = new Array(L.colorCount).fill(0);
    for (const c of L.cells) if (c >= 0) counts[c]++;
    const ants = new Array(L.colorCount).fill(0);
    for (const col of L.columns) for (const b of col) {
      ants[b.c] += b.n;
      assert.ok(b.n >= 1 && b.n <= 99, `level ${n} swarm size ${b.n}`);
    }
    assert.deepEqual(ants, counts, `level ${n}: bees match blocks per color`);
    assert.ok(L.cells.filter((c) => c >= 0).length <= 800, `level ${n} size`);
  }
});
