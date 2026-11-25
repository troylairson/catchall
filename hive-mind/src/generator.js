// Level generator. Every level number always produces the same puzzle.
//
// How a level is built:
// 1. Draw a picture (pictures.js).
// 2. Play it forward: repeatedly pick a color and a swarm size, put that
//    swarm in a hive slot and let the bees fly. Most picks are colors the
//    bees can reach right now; harder levels also pick colors that are still
//    walled in, so they sit in a slot and eat space. The picks, in order,
//    are a known winning sequence.
// 3. Deal that sequence out into columns. Any dealing keeps the sequence
//    playable, so the level is always solvable.
// 4. Rate it by letting a "casual player" bot play it many times, and keep
//    the candidate whose win rate best fits the level's tier.

import { Game, replay, rollout, playPolicy, NAIVE } from './engine.js';
import { makePicture, enrich, speckle, EASY, NESTED, ALL } from './pictures.js';
import { COLORS } from './palette.js';
import { mulberry32, hashInts } from './rng.js';

export const TIERS = {
  normal: { label: 'Normal', win: [0.5, 1] },
  hard: { label: 'Hard', win: [0.05, 0.45] },
  super: { label: 'Super Hard', win: [0, 0.15] },
};

const NAMES = {
  heart: 'Heart', star: 'Star', apple: 'Apple', cherries: 'Cherries', balloons: 'Balloons',
  flower: 'Flower', tulips: 'Tulips', mushroom: 'Mushroom', ladybug: 'Ladybug', tree: 'Fruit Tree',
  house: 'Cottage', fish: 'Fish', sun: 'Sunshine', rainbow: 'Rainbow', honeyjar: 'Honey Jar',
  bee: 'Bumblebee', butterfly: 'Butterfly', cactus: 'Cactus', rocket: 'Rocket', sailboat: 'Sailboat',
  icecream: 'Ice Cream', watermelon: 'Watermelon', snowman: 'Snowman', cat: 'Cat',
  target: 'Bullseye', mandala: 'Mandala', quilt: 'Quilt',
};

export function tierOf(n) {
  if (n >= 10 && n % 10 === 0) return 'super';
  if (n >= 5 && n % 5 === 0) return 'hard';
  return 'normal';
}

function params(n, tier, rng) {
  // Level 1 starts where level 9 used to be, so ordering matters from the start.
  const m = n + 8;
  const ramp = Math.min(1, (m - 1) / 40); // 0 at m=1, 1 by m=41
  let size = Math.round(14 + ramp * 8 + rng.int(-1, 2));
  if (tier === 'hard') size += 2;
  if (tier === 'super') size += 3;
  const base = {
    size,
    columns: n <= 2 ? 3 : 4,
    boxes: Math.round(6 + ramp * 7 + rng.int(0, 2)),
    premature: 0.3 + ramp * 0.15,
    pressure: 2, // swarms the solution keeps waiting in slots
    slots: 4,
    stack: 0.3 + ramp * 0.15,
    colors: Math.round(5 + ramp * 2),
    speckle: 0.03 + ramp * 0.06,
    links: 0,
    joins: n >= 2 && rng.chance(0.5) ? 1 : 0, // side-by-side joined pairs
    mystery: 0,
    outline: m > 8 && rng.chance(0.25) ? 1 : 0, // rings of border colors
  };
  if (tier === 'hard') Object.assign(base, { columns: 4, boxes: base.boxes + 4, premature: 0.55, pressure: 2, stack: 0.6, outline: rng.int(0, 1), speckle: 0.18, colors: 7 + Math.round(ramp), links: rng.int(0, 2), joins: rng.int(1, 2) });
  if (tier === 'super') Object.assign(base, { columns: rng.pick([4, 5]), boxes: base.boxes + 7, premature: 0.8, pressure: 3, stack: 0.75, outline: rng.int(1, 2), speckle: 0.25, colors: 8 + Math.round(ramp), links: rng.int(1, 3), joins: rng.int(2, 3), mystery: 0.35 });
  return base;
}

function pickMotif(n, tier, rng) {
  if (n <= 3 && tier === 'normal') return rng.pick(EASY);
  if (tier !== 'normal') {
    if (rng.chance(tier === 'super' ? 0.7 : 0.6)) return rng.pick(NESTED);
    return rng.pick(ALL.filter((m) => !EASY.includes(m)));
  }
  // Lean away from the heavy nested motifs on normal levels.
  const pool = ALL.filter((m) => !NESTED.includes(m) || rng.chance(0.3));
  return rng.pick(pool);
}

// How many layers must be peeled off before each color first becomes reachable.
function peelDepth(pic) {
  const g = new Game({ w: pic.w, h: pic.h, cells: pic.cells, colorCount: pic.keys.length, columns: [] });
  const depth = new Array(pic.keys.length).fill(-1);
  for (let layer = 0; g.left > 0; layer++) {
    const batch = [];
    g.frontier.forEach((f, c) => { if (f.length && depth[c] < 0) depth[c] = layer; batch.push(...f); });
    g.frontier.forEach((f) => { f.length = 0; });
    for (const i of batch) { g.cells[i] = -1; g.left--; }
    for (const i of batch) g._flood(i);
  }
  return depth;
}

// Steps 2-3: returns columns plus the winning tap order, or null.
function buildColumns(pic, p, rng) {
  const level = { w: pic.w, h: pic.h, cells: pic.cells, colorCount: pic.keys.length, columns: [], slots: p.slots };
  const g = new Game(level);
  const remaining = new Array(pic.keys.length).fill(0);
  for (const c of pic.cells) if (c >= 0) remaining[c]++;
  const total = remaining.reduce((a, b) => a + b, 0);
  const avg = Math.max(2, total / p.boxes);
  const depth = peelDepth(pic);
  const seq = [];
  let peak = 0;
  let guard = 0;
  while (remaining.some((r) => r > 0)) {
    if (++guard > 400) return null;
    g.settle();
    const free = g.freeSlots();
    if (free === 0) return null;
    const open = [], closed = [];
    remaining.forEach((r, c) => { if (r > 0) (g.reachable(c) > 0 ? open : closed).push(c); });
    let c;
    const waiting = g.slots.filter((s) => s && g.reachable(s.c) === 0).length;
    peak = Math.max(peak, waiting);
    if (closed.length && free >= 2 && (!open.length || (waiting < p.pressure && rng.chance(p.premature)))) {
      // Prefer colors buried deep, so the swarm has to wait a long time.
      closed.sort((a, b) => depth[b] - depth[a]);
      c = closed[Math.min(closed.length - 1, Math.floor(rng() * rng() * closed.length))];
    }
    else if (open.length) c = rng.pick(open);
    else return null; // nothing reachable and no room to wait
    let n = Math.max(1, Math.round(avg * (0.45 + rng() * 1.1)));
    n = Math.min(n, 99, remaining[c]);
    if (remaining[c] - n > 0 && remaining[c] - n < Math.max(2, avg * 0.35)) n = remaining[c];
    if (n > 99) n = 99;
    remaining[c] -= n;
    const slot = g.slots.indexOf(null);
    g.slots[slot] = { c, n, id: g.nextId++ };
    seq.push({ c, n });
  }
  g.settle();
  if (!g.won()) return null;

  // Deal into columns, keeping them roughly even.
  const K = p.columns;
  const cols = Array.from({ length: K }, () => []);
  const order = [];
  let prev = -1;
  for (const box of seq) {
    const min = Math.min(...cols.map((c) => c.length));
    let k;
    // Stacking a swarm right behind the previous one hides it until that
    // one is taken, which is what makes harder levels harder.
    if (prev >= 0 && cols[prev].length <= min + 2 && rng.chance(p.stack)) k = prev;
    else k = rng.pick(cols.map((c, i) => i).filter((i) => cols[i].length <= min + 1));
    cols[k].push({ ...box });
    order.push(k);
    prev = k;
  }
  return { cols, order, peak };
}

// Link a few vertically adjacent swarms (tapping one brings both), keeping
// only links that still leave the known solution playable.
function addLinks(level, order, count, rng) {
  for (let tries = 0; count > 0 && tries < count * 8; tries++) {
    const col = level.columns[rng.int(0, level.columns.length - 1)];
    if (col.length < 2) continue;
    const i = rng.int(0, col.length - 2);
    if (col[i].link || col[i].pair || col[i + 1].pair || (i > 0 && col[i - 1].link) || col[i + 1].link) continue;
    col[i].link = true;
    if (replay(level, compressTaps(level, order))) count--;
    else col[i].link = false;
  }
}

// Join a few swarms in neighboring columns: they only leave together, once
// both are at the front. Two swarms that come one after the other in the
// winning order are both at the front at that moment, so they can be joined.
function addJoins(level, order, count, rng) {
  const idx = [];
  const seen = level.columns.map(() => 0);
  for (const k of order) idx.push(seen[k]++);
  const spots = rng.shuffle(order.map((_, i) => i).slice(0, -1));
  for (const i of spots) {
    if (count <= 0) break;
    const k1 = order[i], k2 = order[i + 1];
    if (Math.abs(k1 - k2) !== 1) continue;
    const a = level.columns[k1][idx[i]], b = level.columns[k2][idx[i + 1]];
    const busy = (k, j) => {
      const col = level.columns[k];
      return col[j].pair || col[j].link || (j > 0 && col[j - 1].link);
    };
    if (busy(k1, idx[i]) || busy(k2, idx[i + 1])) continue;
    a.pair = [k2, idx[i + 1]];
    b.pair = [k1, idx[i]];
    if (replay(level, compressTaps(level, order))) count--;
    else { delete a.pair; delete b.pair; }
  }
}

// Turn the per-swarm order into taps: a linked or joined pair is one tap.
function compressTaps(level, order) {
  const ptr = level.columns.map(() => 0);
  const taken = new Set();
  const taps = [];
  for (const k of order) {
    const box = level.columns[k][ptr[k]++];
    if (taken.has(box)) continue;
    taps.push(k);
    if (box.link) taken.add(level.columns[k][ptr[k]]);
    if (box.pair) taken.add(level.columns[box.pair[0]][box.pair[1]]);
  }
  return taps;
}

function rate(level, rng, tries) {
  const start = new Game(level);
  start.settle();
  let wins = 0;
  for (let i = 0; i < tries; i++) if (rollout(start, rng)) wins++;
  return wins / tries;
}

export function generateLevel(n) {
  const tier = tierOf(n);
  const rng = mulberry32(hashInts(n, 0xbee));
  let [lo, hi] = TIERS[tier].win;
  if (tier === 'normal') hi = 0.9;
  let best = null;
  for (let attempt = 0; attempt < (tier === 'normal' ? 30 : 40) || (!best && attempt < 80); attempt++) {
    const p = params(n, tier, rng);
    const motif = pickMotif(n, tier, rng);
    const rings = rng.shuffle(['D', 'W', 'N', 'B', 'F', 'M']).slice(0, p.outline);
    const pic = speckle(enrich(makePicture(motif, p.size, rng, { outline: rings }), p.colors, rng), p.speckle, rng);
    if (pic.keys.length < 2) continue;
    let built = null;
    for (let k = 0; k < 8 && !built; k++) built = buildColumns(pic, p, rng);
    if (!built) continue;
    const level = {
      n, tier, motif, name: NAMES[motif] || motif,
      w: pic.w, h: pic.h, cells: pic.cells,
      colorCount: pic.keys.length,
      colors: pic.keys.map((k) => COLORS[k].hex),
      columns: built.cols,
      slots: p.slots,
    };
    addJoins(level, built.order, p.joins, rng);
    addLinks(level, built.order, p.links, rng);
    level.solution = compressTaps(level, built.order);
    if (!replay(level, level.solution)) continue; // should not happen
    if (p.mystery) for (const col of level.columns) col.forEach((b, i) => { if (i > 0 && rng.chance(p.mystery)) b.hidden = true; });
    const win = rate(level, mulberry32(hashInts(n, attempt)), 60);
    const start = new Game(level);
    start.settle();
    const naive = Object.values(NAIVE).filter((pick) => playPolicy(start, pick)).length;
    level.winRate = win;
    level.naiveWins = naive;
    level.peak = built.peak;
    let miss = win < lo ? lo - win : win > hi ? win - hi : 0;
    if (tier !== 'normal') miss += naive; // simple strategies must all lose
    else if (naive === Object.keys(NAIVE).length) miss += 1; // at least one must lose
    if (!best || miss < best.miss) best = { level, miss };
    if (miss === 0) break;
  }
  return best.level;
}
