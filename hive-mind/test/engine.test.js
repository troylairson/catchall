import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, replay, solve } from '../src/engine.js';

// 3x3 picture: a 1-colored center sealed in by color 0.
const ring = () => ({
  w: 3, h: 3, colorCount: 2,
  cells: [0, 0, 0, 0, 1, 0, 0, 0, 0],
  columns: [[{ c: 1, n: 1 }], [{ c: 0, n: 8 }]],
});

test('only blocks touching open air are reachable', () => {
  const g = new Game(ring());
  assert.equal(g.reachable(0), 8);
  assert.equal(g.reachable(1), 0);
});

test('a sealed color waits in its slot until it is uncovered', () => {
  const g = new Game(ring());
  g.tap(0);
  assert.equal(g.settle(), 0);
  assert.equal(g.slots[0].n, 1);
  g.tap(1);
  g.settle();
  assert.ok(g.won());
  assert.equal(g.freeSlots(), 5);
});

test('five waiting swarms jam the hive', () => {
  const lvl = {
    w: 3, h: 3, colorCount: 2,
    cells: [0, 0, 0, 0, 1, 0, 0, 0, 0],
    columns: [[1, 1, 1, 1, 1].map(() => ({ c: 1, n: 1 })), [{ c: 0, n: 8 }]],
  };
  lvl.cells = [0, 0, 0, 0, 1, 0, 0, 0, 0];
  const g = new Game(lvl);
  for (let i = 0; i < 5; i++) { g.tap(0); g.settle(); }
  assert.ok(g.stuck());
});

test('linked swarms need two free slots and come out together', () => {
  const lvl = ring();
  lvl.columns = [[{ c: 0, n: 4, link: true }, { c: 0, n: 4 }, { c: 1, n: 1 }]];
  const g = new Game(lvl);
  const placed = g.tap(0);
  assert.equal(placed.length, 2);
  g.settle();
  assert.equal(g.left, 1);
  assert.ok(replay(lvl, [0, 0]));
});

test('solver finds an order', () => {
  const lvl = ring();
  const { solution } = solve(lvl);
  assert.ok(solution && replay(lvl, solution));
});
