// Hive Mind game rules, independent of rendering.
//
// The board is a grid of colored blocks (-1 = empty). A bee can only reach a
// block that touches open air connected to the outside of the picture.
// Swarms (numbered boxes) wait in columns; tapping a column's front swarm moves
// it into one of the hive slots (SLOT_COUNT unless the level says otherwise). Every tick, each slot sends one bee to
// the nearest reachable block of its color. A slot empties when all its bees
// are out. You win when the board is clear; you are stuck when no slot can
// send a bee and no swarm can be moved into a slot.

export const SLOT_COUNT = 5;

const zobristCache = new Map();
function zobrist(n) {
  let z = zobristCache.get(n);
  if (!z) {
    z = new Uint32Array(n);
    let s = 0x9e3779b9;
    for (let i = 0; i < n; i++) {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      z[i] = s;
    }
    zobristCache.set(n, z);
  }
  return z;
}

export class Game {
  // level: { w, h, cells: number[] (color index or -1), colorCount, columns: [[{c, n, link?, hidden?}]] }
  constructor(level, _clone) {
    if (_clone) return;
    const { w, h } = level;
    this.level = level;
    this.w = w;
    this.h = h;
    this.cells = Int8Array.from(level.cells);
    this.left = 0;
    for (const v of this.cells) if (v >= 0) this.left++;
    // Bees live in the hive below the bottom-center of the picture.
    const hx = (w - 1) / 2, hy = h + 1.5;
    this.dist = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      this.dist[y * w + x] = Math.hypot(x - hx, y - hy) + x * 1e-4; // tiny tie-break
    }
    this.z = zobrist(w * h);
    this.hash = 0;
    this.outside = new Uint8Array(w * h);
    this.inFrontier = new Uint8Array(w * h);
    this.frontier = Array.from({ length: level.colorCount }, () => []);
    this.cols = level.columns;
    this.ptr = new Array(level.columns.length).fill(0);
    this.slots = new Array(level.slots || SLOT_COUNT).fill(null);
    this.nextId = 1;
    // Seed open air from the border.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        const i = y * w + x;
        if (this.cells[i] < 0) this._flood(i);
        else this._addFrontier(i);
      }
    }
  }

  clone() {
    const g = new Game(null, true);
    g.level = this.level; g.w = this.w; g.h = this.h;
    g.cells = this.cells.slice();
    g.left = this.left;
    g.dist = this.dist; g.z = this.z; g.hash = this.hash;
    g.outside = this.outside.slice();
    g.inFrontier = this.inFrontier.slice();
    g.frontier = this.frontier.map((f) => f.slice());
    g.cols = this.cols;
    g.ptr = this.ptr.slice();
    g.slots = this.slots.map((s) => (s ? { ...s } : null));
    g.nextId = this.nextId;
    return g;
  }

  _addFrontier(i) {
    if (this.inFrontier[i] || this.cells[i] < 0) return;
    this.inFrontier[i] = 1;
    this.frontier[this.cells[i]].push(i);
  }

  // Mark empty cell i and every empty cell connected to it as open air;
  // blocks touching that air become reachable.
  _flood(start) {
    const { w, h, cells, outside } = this;
    const stack = [start];
    outside[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      const nb = [];
      if (x > 0) nb.push(i - 1);
      if (x < w - 1) nb.push(i + 1);
      if (y > 0) nb.push(i - w);
      if (y < h - 1) nb.push(i + w);
      for (const j of nb) {
        if (cells[j] < 0) {
          if (!outside[j]) { outside[j] = 1; stack.push(j); }
        } else this._addFrontier(j);
      }
    }
  }

  // Take the reachable block of color c nearest the hive, or -1.
  take(c) {
    const f = this.frontier[c];
    if (!f.length) return -1;
    let best = 0;
    for (let k = 1; k < f.length; k++) if (this.dist[f[k]] < this.dist[f[best]]) best = k;
    const i = f[best];
    f[best] = f[f.length - 1];
    f.pop();
    this.cells[i] = -1;
    this.left--;
    this.hash ^= this.z[i];
    this._flood(i);
    return i;
  }

  reachable(c) { return this.frontier[c].length; }
  freeSlots() { let n = 0; for (const s of this.slots) if (!s) n++; return n; }
  front(col) { return this.ptr[col] < this.cols[col].length ? this.cols[col][this.ptr[col]] : null; }
  remainingInColumn(col) { return this.cols[col].length - this.ptr[col]; }

  // How many slots tapping this column needs (0 when the column is empty).
  need(col) {
    const b = this.front(col);
    if (!b) return 0;
    return b.link || b.pair ? 2 : 1;
  }

  // A joined swarm can only leave once its partner in the next column is
  // at the front too.
  locked(col) {
    const b = this.front(col);
    return !!(b && b.pair && this.ptr[b.pair[0]] !== b.pair[1]);
  }

  canTap(col) {
    const n = this.need(col);
    return n > 0 && !this.locked(col) && this.freeSlots() >= n;
  }

  legalTaps() {
    const out = [];
    for (let c = 0; c < this.cols.length; c++) if (this.canTap(c)) out.push(c);
    return out;
  }

  // Move the front swarm (and its linked or joined partner) into free slots.
  // Returns [{slot, box, id, col, row}] or null if not allowed. `row` is 0 for
  // a swarm that was at the front of its column, 1 for the one behind it.
  tap(col) {
    if (!this.canTap(col)) return null;
    const b = this.front(col);
    const take = [[col, 0]];
    if (b.link) take.push([col, 1]);
    if (b.pair) take.push([b.pair[0], 0]);
    const placed = [];
    for (const [c, row] of take) {
      const box = this.cols[c][this.ptr[c]++];
      const slot = this.slots.indexOf(null);
      const id = this.nextId++;
      this.slots[slot] = { c: box.c, n: box.n, id };
      placed.push({ slot, box, id, col: c, row });
    }
    return placed;
  }

  // One round: every slot sends one bee if it can.
  // Returns [{slot, id, cell, c, last}].
  tick() {
    const ev = [];
    for (let s = 0; s < this.slots.length; s++) {
      const slot = this.slots[s];
      if (!slot) continue;
      const cell = this.take(slot.c);
      if (cell < 0) continue;
      slot.n--;
      const last = slot.n === 0;
      ev.push({ slot: s, id: slot.id, cell, c: slot.c, last });
      if (last) this.slots[s] = null;
    }
    return ev;
  }

  // Run ticks until nothing moves. Returns the number of bees sent.
  settle() {
    let total = 0;
    for (;;) {
      const n = this.tick().length;
      if (!n) return total;
      total += n;
    }
  }

  canProgress() {
    for (const s of this.slots) if (s && this.frontier[s.c].length) return true;
    return false;
  }

  won() { return this.left === 0; }
  stuck() { return !this.won() && !this.canProgress() && this.legalTaps().length === 0; }

  key() {
    let k = this.ptr.join(',') + '|';
    for (const s of this.slots) k += s ? s.c + ':' + s.n + ',' : '-,';
    return k + '|' + this.hash;
  }
}

// Play a sequence of column taps, settling after each. Returns true on a win.
export function replay(level, taps) {
  const g = new Game(level);
  g.settle();
  for (const c of taps) {
    if (!g.tap(c)) return false;
    g.settle();
  }
  return g.won();
}

// Depth-first search for a winning tap order (settling after each tap).
export function solve(level, budget = 20000) {
  const root = new Game(level);
  root.settle();
  const seen = new Set();
  let nodes = 0;
  const dfs = (g) => {
    if (g.won()) return [];
    if (++nodes > budget) throw new Error('budget');
    const k = g.key();
    if (seen.has(k)) return null;
    seen.add(k);
    const taps = g.legalTaps();
    // Try swarms whose color can fly right now first.
    taps.sort((a, b) => (g.reachable(g.front(b).c) > 0) - (g.reachable(g.front(a).c) > 0));
    for (const c of taps) {
      const h = g.clone();
      h.tap(c);
      h.settle();
      const r = dfs(h);
      if (r) return [c, ...r];
    }
    return null;
  };
  try {
    return { solution: dfs(root), nodes };
  } catch {
    return { solution: undefined, nodes };
  }
}

// A rough "casual player": usually taps a swarm that can fly now, otherwise
// anything. Used to rate difficulty. Returns true on a win.
export function rollout(start, rng, care = 0.75) {
  const g = start.clone();
  for (;;) {
    if (g.won()) return true;
    const taps = g.legalTaps();
    if (!taps.length) return false;
    const good = taps.filter((c) => g.reachable(g.front(c).c) > 0);
    const pool = good.length && rng() < care ? good : taps;
    g.tap(pool[Math.floor(rng() * pool.length)]);
    g.settle();
  }
}

// Simple-minded strategies a player might fall back on. Hard levels must
// beat all of them, so the order of taps really matters.
export const NAIVE = {
  // Empty one column, then move on to the next.
  sweep(g) {
    const taps = g.legalTaps();
    return taps.length ? taps[0] : -1;
  },
  // Tap whatever color has the most blocks within reach.
  greedy(g) {
    let best = -1, bv = -1;
    for (const c of g.legalTaps()) {
      const v = g.reachable(g.front(c).c);
      if (v > bv) { bv = v; best = c; }
    }
    return best;
  },
  // Prefer a swarm that can fly out completely right now.
  fits(g) {
    let best = -1, bv = -Infinity;
    for (const c of g.legalTaps()) {
      const b = g.front(c);
      const r = g.reachable(b.c);
      const v = r >= b.n ? 1000 - b.n : r ? r - b.n : -1000;
      if (v > bv) { bv = v; best = c; }
    }
    return best;
  },
};

export function playPolicy(start, pick) {
  const g = start.clone();
  for (;;) {
    if (g.won()) return true;
    const c = pick(g);
    if (c < 0) return false;
    g.tap(c);
    g.settle();
  }
}
