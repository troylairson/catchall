import { Game, SLOT_COUNT } from './engine.js';
import { TIERS } from './generator.js';
import { unlockAudio, sfx, setBuzz, setSoundEnabled } from './audio.js';
import { initHaptics, haptic, setHapticsEnabled } from './haptics.js';

// ---------- settings & progress ----------
const STORE = 'hivemind.v1';
const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } })();
const prefs = { level: 1, sound: true, haptics: true, speed: 'normal', ...saved };
// Bee speed, as a multiple of the original pace (which players found too quick).
const SPEEDS = { slow: { label: 'Slow', x: 0.45 }, normal: { label: 'Normal', x: 0.65 }, fast: { label: 'Fast', x: 1 } };
if (saved.fast) prefs.speed = 'fast'; // the old 2× toggle
delete prefs.fast;
if (!SPEEDS[prefs.speed]) prefs.speed = 'normal';
function save() { try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch { /* private mode */ } }
setSoundEnabled(prefs.sound);
setHapticsEnabled(prefs.haptics);

// ---------- level supply (worker, with main-thread fallback) ----------
const cache = new Map();
const waiting = new Map();
let worker = null;
try {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    cache.set(e.data.n, e.data.level);
    const w = waiting.get(e.data.n);
    if (w) { waiting.delete(e.data.n); w.forEach((fn) => fn(e.data.level)); }
  };
  worker.onerror = () => { worker = null; };
} catch { worker = null; }

function getLevel(n) {
  if (cache.has(n)) return Promise.resolve(cache.get(n));
  if (!worker) {
    return import('./generator.js').then(({ generateLevel }) => {
      const L = generateLevel(n);
      cache.set(n, L);
      return L;
    });
  }
  return new Promise((resolve) => {
    if (!waiting.has(n)) { waiting.set(n, []); worker.postMessage({ n }); }
    waiting.get(n).push(resolve);
  });
}
function prefetch(n) { if (worker && !cache.has(n) && !waiting.has(n)) { waiting.set(n, []); worker.postMessage({ n }); } }

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const homeEl = $('home');
const modalEl = $('modal');

// ---------- drawing helpers ----------
const SQ3 = Math.sqrt(3);
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (amt > 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function hexPath(c, x, y, r) {
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
    i ? c.lineTo(px, py) : c.moveTo(px, py);
  }
  c.closePath();
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
const ease = (t) => 1 - (1 - t) ** 3;
const FONT = "'Fredoka', ui-rounded, system-ui, sans-serif";

// ---------- game state ----------
let L = null;           // level data
let game = null;        // engine
let vis = null;         // what the board shows (blocks vanish when a bee grabs them)
let boardDirty = true;
let bees = [];
let vSlots = [];
let popping = [];
let flyers = [];        // swarms flying from the stack into a slot
let colShift = [];      // per-column slide-up animation start
let colShake = [];
let particles = [];
let state = 'idle';     // idle | play | won | lost
let endAt = 0;
let tickAcc = 0;
let hivePulse = 0;
let tapsMade = 0;
const TICK = 80;        // ms between bee launches per slot

// ---------- layout ----------
let W = 0, H = 0, dpr = 1;
const lay = {};
const boardCanvas = document.createElement('canvas');
const bctx = boardCanvas.getContext('2d');
let tileCache = new Map();
let beeCache = new Map();

function resize() {
  const rect = canvas.getBoundingClientRect();
  dpr = Math.min(3, window.devicePixelRatio || 1);
  W = rect.width; H = rect.height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  computeLayout();
}

function computeLayout() {
  if (!L) return;
  const pad = 12;
  const K = L.columns.length;
  const NS = L.slots || SLOT_COUNT;
  const sw = Math.min((W - pad * 2) / Math.max(NS, 5), 78);
  // Flat-top hexes; shrink them on short screens so the board keeps room.
  let r = sw * 0.45;
  const lowerFor = (r) => SQ3 * r * 2.75 + 14 + 26 + 56 + 10;
  const maxLower = H * 0.5;
  if (lowerFor(r) > maxLower) r = Math.max(18, (maxLower - 106) / (SQ3 * 2.75));
  const hh = SQ3 * r;
  lay.r = r; lay.hh = hh; lay.sw = Math.max(sw, 2 * r + 6);
  const stackH = hh + hh * 0.78 + 26;
  const slotsH = hh + 14;
  const hiveH = 56;
  const bottom = H - 8;
  lay.stackTop = bottom - stackH;
  lay.slotY = lay.stackTop - slotsH / 2 - 2;
  lay.hive = { x: W / 2, y: lay.slotY - slotsH / 2 - hiveH / 2 + 4, s: 1 };
  const boardBottom = lay.hive.y - hiveH / 2 + 4;
  lay.panel = { x: pad, y: 4, w: W - pad * 2, h: Math.max(80, boardBottom - 4) };
  const inner = 12;
  const cs = Math.min((lay.panel.w - inner * 2) / L.w, (lay.panel.h - inner * 2) / L.h, 26);
  lay.cs = Math.floor(cs * dpr) / dpr;
  lay.bx = Math.round((W - lay.cs * L.w) / 2 * dpr) / dpr;
  lay.by = Math.round((lay.panel.y + (lay.panel.h - lay.cs * L.h) / 2) * dpr) / dpr;
  lay.slots = Array.from({ length: NS }, (_, i) => ({ x: W / 2 + (i - (NS - 1) / 2) * lay.sw, y: lay.slotY }));
  const cw = Math.min((W - pad * 2) / K, lay.sw * 1.25);
  lay.cols = Array.from({ length: K }, (_, k) => ({
    x: W / 2 + (k - (K - 1) / 2) * cw,
    y: lay.stackTop + 6 + hh / 2,
    y2: lay.stackTop + 6 + hh / 2 + hh * 0.78,
    w: cw,
  }));
  lay.beeSize = Math.max(9, Math.min(16, lay.cs * 1.15));
  boardCanvas.width = Math.round(W * dpr);
  boardCanvas.height = Math.round((lay.panel.y + lay.panel.h + 4) * dpr);
  tileCache = new Map();
  beeCache = new Map();
  boardDirty = true;
  placeHint();
}

function cellXY(i) {
  const x = i % L.w, y = (i / L.w) | 0;
  return { x: lay.bx + (x + 0.5) * lay.cs, y: lay.by + (y + 0.5) * lay.cs };
}

// ---------- cached sprites ----------
function tile(colorIdx, size) {
  const key = colorIdx + ':' + size;
  let t = tileCache.get(key);
  if (t) return t;
  const px = Math.max(2, Math.round(size * dpr));
  t = document.createElement('canvas');
  t.width = t.height = px;
  const c = t.getContext('2d');
  const base = L.colors[colorIdx];
  const g = px * 0.05, rr = px * 0.2;
  c.fillStyle = shade(base, -0.28);
  roundRect(c, g, g, px - 2 * g, px - 2 * g, rr);
  c.fill();
  c.fillStyle = base;
  roundRect(c, g, g, px - 2 * g, px - 2 * g - px * 0.12, rr);
  c.fill();
  c.fillStyle = shade(base, 0.35);
  roundRect(c, g + px * 0.14, g + px * 0.1, px * 0.38, px * 0.14, px * 0.07);
  c.fill();
  // Faint dark outline so pale blocks (cream, white, gray) stand out on the board.
  const lw = Math.max(dpr, px * 0.045);
  c.strokeStyle = 'rgba(70, 45, 15, 0.3)';
  c.lineWidth = lw;
  roundRect(c, g + lw / 2, g + lw / 2, px - 2 * g - lw, px - 2 * g - lw, rr - lw / 2);
  c.stroke();
  tileCache.set(key, t);
  return t;
}

function beeSprite(colorIdx, frame) {
  return makeBee(L.colors[colorIdx], frame, lay.beeSize);
}

function makeBee(body, frame, size) {
  const key = body + ':' + frame + ':' + size;
  let s = beeCache.get(key);
  if (s) return s;
  const px = Math.ceil(size * 2 * dpr);
  s = document.createElement('canvas');
  s.width = s.height = px;
  const c = s.getContext('2d');
  c.scale(dpr, dpr);
  c.translate(size, size);
  // wings
  c.fillStyle = 'rgba(255,255,255,0.88)';
  c.strokeStyle = 'rgba(60,40,20,0.35)';
  c.lineWidth = 0.8;
  const wy = frame ? size * 0.36 : size * 0.22;
  for (const sgn of [-1, 1]) {
    c.beginPath();
    c.ellipse(-size * 0.08, sgn * wy, size * 0.3, size * (frame ? 0.2 : 0.26), sgn * 0.5, 0, Math.PI * 2);
    c.fill(); c.stroke();
  }
  // body
  c.fillStyle = body;
  c.strokeStyle = '#2b2420';
  c.lineWidth = Math.max(1, size * 0.08);
  c.beginPath();
  c.ellipse(-size * 0.05, 0, size * 0.42, size * 0.3, 0, 0, Math.PI * 2);
  c.fill(); c.stroke();
  c.save();
  c.clip();
  c.fillStyle = '#2b2420';
  c.fillRect(-size * 0.28, -size, size * 0.12, size * 2);
  c.fillRect(-size * 0.02, -size, size * 0.12, size * 2);
  c.restore();
  // head
  c.fillStyle = '#2b2420';
  c.beginPath();
  c.arc(size * 0.38, 0, size * 0.17, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#fff';
  c.beginPath();
  c.arc(size * 0.43, -size * 0.06, size * 0.05, 0, Math.PI * 2);
  c.fill();
  beeCache.set(key, s);
  return s;
}

// ---------- board layer ----------
function drawBoardLayer() {
  const c = bctx;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
  const p = lay.panel;
  c.fillStyle = 'rgba(120,72,10,0.18)';
  roundRect(c, p.x, p.y + 4, p.w, p.h, 22);
  c.fill();
  c.fillStyle = '#fff6e1';
  roundRect(c, p.x, p.y, p.w, p.h, 22);
  c.fill();
  // faint honeycomb
  c.save();
  roundRect(c, p.x, p.y, p.w, p.h, 22);
  c.clip();
  c.strokeStyle = 'rgba(214,170,90,0.22)';
  c.lineWidth = 1.2;
  const hr = 16;
  for (let row = 0, y = p.y; y < p.y + p.h + hr; row++, y += SQ3 * hr / 2) {
    for (let x = p.x + (row % 2 ? 1.5 * hr : 0); x < p.x + p.w + hr; x += 3 * hr) { hexPath(c, x, y, hr); c.stroke(); }
  }
  c.restore();
  c.strokeStyle = 'rgba(190,130,40,0.35)';
  c.lineWidth = 2;
  roundRect(c, p.x + 1, p.y + 1, p.w - 2, p.h - 2, 21);
  c.stroke();
  // blocks
  const cs = lay.cs;
  for (let i = 0; i < vis.length; i++) {
    const v = vis[i];
    if (v < 0) continue;
    const x = lay.bx + (i % L.w) * cs, y = lay.by + ((i / L.w) | 0) * cs;
    c.drawImage(tile(v, cs), x, y, cs, cs);
  }
  boardDirty = false;
}

// ---------- hive ----------
function drawHive(c, now) {
  const { x, y } = lay.hive;
  const s = 1 + Math.max(0, hivePulse - now) / 1200;
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  const bands = [[-16, 22], [-6, 28], [4, 30], [14, 27]];
  c.fillStyle = 'rgba(90,50,0,0.2)';
  c.beginPath(); c.ellipse(0, 24, 30, 5, 0, 0, Math.PI * 2); c.fill();
  for (let i = bands.length - 1; i >= 0; i--) {
    const [by, bw] = bands[i];
    c.fillStyle = i % 2 ? '#e9a21f' : '#f5bd3c';
    c.strokeStyle = '#a8670f';
    c.lineWidth = 2;
    roundRect(c, -bw, by - 7, bw * 2, 14, 7);
    c.fill(); c.stroke();
  }
  c.fillStyle = '#f7c843';
  c.strokeStyle = '#a8670f';
  c.beginPath(); c.ellipse(0, -22, 13, 8, 0, Math.PI, 0); c.fill(); c.stroke();
  c.fillStyle = '#3a2410';
  c.beginPath(); c.ellipse(0, 12, 8, 6.5, 0, 0, Math.PI * 2); c.fill();
  c.restore();
}

// ---------- swarm boxes ----------
function drawBox(c, x, y, r, colorIdx, n, { hidden = false, dim = false, scale = 1, alpha = 1 } = {}) {
  c.save();
  c.globalAlpha = alpha;
  c.translate(x, y);
  c.scale(scale, scale);
  const base = hidden ? '#b9ad96' : L.colors[colorIdx];
  const depth = r * 0.16;
  hexPath(c, 0, depth, r);
  c.fillStyle = shade(base, -0.35);
  c.fill();
  hexPath(c, 0, 0, r);
  c.fillStyle = base;
  c.fill();
  c.lineWidth = Math.max(1.5, r * 0.06);
  c.strokeStyle = shade(base, -0.2);
  c.stroke();
  hexPath(c, 0, -r * 0.08, r * 0.72);
  c.fillStyle = shade(base, 0.18);
  c.globalAlpha = alpha * 0.45;
  c.fill();
  c.globalAlpha = alpha;
  const label = hidden ? '?' : String(n);
  c.font = `700 ${Math.round(r * (label.length > 1 ? 0.78 : 0.86))}px ${FONT}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.lineWidth = Math.max(3, r * 0.16);
  c.strokeStyle = 'rgba(40,25,10,0.55)';
  c.strokeText(label, 0, r * 0.04);
  c.fillStyle = '#fff';
  c.fillText(label, 0, r * 0.04);
  if (dim) {
    hexPath(c, 0, 0, r);
    c.fillStyle = 'rgba(255,246,225,0.45)';
    c.fill();
  }
  c.restore();
}

function drawLinkBar(c, x1, y1, x2, y2, r) {
  c.save();
  c.lineCap = 'round';
  c.strokeStyle = '#8a5a1e';
  c.lineWidth = r * 0.42;
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  c.strokeStyle = '#d99a3a';
  c.lineWidth = r * 0.22;
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  c.restore();
}

function drawLock(c, x, y, s) {
  c.save();
  c.translate(x, y);
  c.fillStyle = '#5b3a12';
  c.strokeStyle = '#fff6e1';
  c.lineWidth = 2;
  c.beginPath(); c.arc(0, 0, s, 0, Math.PI * 2); c.fill(); c.stroke();
  c.strokeStyle = '#ffd77a';
  c.lineWidth = s * 0.22;
  c.beginPath(); c.arc(0, -s * 0.18, s * 0.3, Math.PI, 0); c.stroke();
  c.fillStyle = '#ffd77a';
  roundRect(c, -s * 0.45, -s * 0.18, s * 0.9, s * 0.65, s * 0.12);
  c.fill();
  c.restore();
}

function drawSlots(c, now) {
  const r = lay.r;
  for (const s of lay.slots) {
    hexPath(c, s.x, s.y + 2, r * 0.98);
    c.fillStyle = 'rgba(160,100,20,0.22)';
    c.fill();
    hexPath(c, s.x, s.y, r * 0.9);
    c.fillStyle = 'rgba(255,246,225,0.55)';
    c.fill();
  }
  // Bars between joined swarms sitting in the hive.
  for (let i = 0; i < vSlots.length; i++) {
    const v = vSlots[i];
    if (!v || v.mate < i || v.arriveAt > now) continue;
    const m = vSlots[v.mate];
    if (m && m.arriveAt <= now) drawLinkBar(c, lay.slots[i].x, lay.slots[i].y, lay.slots[v.mate].x, lay.slots[v.mate].y, r);
  }
  for (let i = 0; i < vSlots.length; i++) {
    const v = vSlots[i];
    if (!v || v.arriveAt > now) continue;
    const t = Math.min(1, (now - v.arriveAt) / 160);
    drawBox(c, lay.slots[i].x, lay.slots[i].y, r, v.c, v.n, { scale: 1 + 0.12 * Math.sin(t * Math.PI), dim: v.n === 0 });
  }
  popping = popping.filter((p) => now - p.at < 220);
  for (const p of popping) {
    const t = (now - p.at) / 220;
    drawBox(c, lay.slots[p.slot].x, lay.slots[p.slot].y, r, p.c, 0, { scale: 1 + t * 0.3, alpha: 1 - t });
  }
  for (const f of flyers) {
    const t = Math.min(1, (now - f.start) / f.dur);
    const e = ease(t);
    const x = f.x0 + (f.x1 - f.x0) * e, y = f.y0 + (f.y1 - f.y0) * e - Math.sin(t * Math.PI) * 30;
    drawBox(c, x, y, r, f.c, f.n, { scale: 1.05 });
  }
}

function drawStack(c, now) {
  const r = lay.r;
  const room = game.freeSlots();
  const pos = L.columns.map((boxes, k) => {
    const col = lay.cols[k];
    let dx = 0;
    const sh = colShake[k];
    if (sh && now - sh < 350) dx = Math.sin((now - sh) / 25) * 6 * (1 - (now - sh) / 350);
    const slide = colShift[k] ? 1 - ease(Math.min(1, (now - colShift[k]) / 200)) : 0;
    const off = slide * (col.y2 - col.y);
    return { x: col.x + dx, y: col.y + off, y2: col.y2 + off, ptr: game.ptr[k] };
  });
  // Where a swarm is drawn: the front row, the row behind it, or not at all.
  const at = (k, i) => {
    const p = pos[k];
    if (i === p.ptr) return { x: p.x, y: p.y };
    if (i === p.ptr + 1) return { x: p.x, y: p.y2 };
    return null;
  };
  // Bars for joined pairs go behind the swarms.
  L.columns.forEach((boxes, k) => {
    for (const i of [pos[k].ptr, pos[k].ptr + 1]) {
      const b = boxes[i];
      if (!b || !b.pair) continue;
      const a = at(k, i), o = at(b.pair[0], b.pair[1]);
      if (o) { if (b.pair[0] > k) drawLinkBar(c, a.x, a.y, o.x, o.y, r); }
      else {
        // Partner is buried deeper: a short stub that stops halfway into the gap.
        const reach = r + Math.max(4, (lay.cols[k].w - 2 * r) * 0.3);
        drawLinkBar(c, a.x, a.y, a.x + Math.sign(b.pair[0] - k) * reach, a.y, r);
      }
    }
  });
  L.columns.forEach((boxes, k) => {
    const p = pos[k];
    const front = boxes[p.ptr], next = boxes[p.ptr + 1];
    if (next) {
      if (front && front.link) drawLinkBar(c, p.x, p.y, p.x, p.y2, r);
      drawBox(c, p.x, p.y2, r * 0.86, next.c, next.n, { hidden: !!next.hidden, alpha: 0.95, dim: true });
    }
    if (front) {
      const locked = game.locked(k);
      drawBox(c, p.x, p.y, r, front.c, front.n, { dim: locked || game.need(k) > room });
      if (locked) drawLock(c, p.x + r * 0.62, p.y - r * 0.62, r * 0.3);
    }
    const more = boxes.length - p.ptr - 2;
    if (more > 0) {
      c.font = `600 ${Math.round(r * 0.42)}px ${FONT}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = 'rgba(110,70,20,0.75)';
      c.fillText('+' + more, lay.cols[k].x, lay.cols[k].y2 + lay.hh * 0.5 + 10);
    }
  });
}

// ---------- bees ----------
function spawnBee(ev, from) {
  const to = cellXY(ev.cell);
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const side = Math.random() < 0.5 ? -1 : 1;
  bees.push({
    c: ev.c, cell: ev.cell, phase: 0, t: 0,
    x0: from.x, y0: from.y, x1: to.x, y1: to.y,
    k: side * (0.15 + Math.random() * 0.25),
    dur: Math.max(380, dist / 0.55),
    seed: Math.random() * 10,
  });
  setZigzag(bees[bees.length - 1]);
}

function bezier(b, t) {
  const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2;
  const dx = b.x1 - b.x0, dy = b.y1 - b.y0;
  const cx = mx - dy * b.k, cy = my + dx * b.k;
  const u = 1 - t;
  return {
    x: u * u * b.x0 + 2 * u * t * cx + t * t * b.x1,
    y: u * u * b.y0 + 2 * u * t * cy + t * t * b.y1,
  };
}

// Bees zig-zag: a triangle wave across the curved route, fading out at both
// ends so they still take off and land exactly on target.
function zigzag(b, t) {
  const p = bezier(b, t);
  const q = bezier(b, Math.min(1, t + 0.01));
  const r = bezier(b, Math.max(0, t - 0.01));
  const tx = q.x - r.x, ty = q.y - r.y;
  const len = Math.hypot(tx, ty) || 1;
  const tri = (2 / Math.PI) * Math.asin(Math.sin(t * b.waves * Math.PI * 2 + b.seed));
  const w = tri * b.amp * Math.sin(Math.PI * t);
  return { x: p.x - (ty / len) * w, y: p.y + (tx / len) * w };
}

function flightPos(b, t) {
  const p = zigzag(b, t);
  const n = zigzag(b, Math.min(1, t + 0.012));
  const a = n.x === p.x && n.y === p.y ? Math.atan2(b.y1 - b.y0, b.x1 - b.x0) : Math.atan2(n.y - p.y, n.x - p.x);
  return { x: p.x, y: p.y, a };
}

function setZigzag(b) {
  const dist = Math.hypot(b.x1 - b.x0, b.y1 - b.y0);
  b.waves = Math.max(1.5, Math.min(6, dist / 70));
  b.amp = Math.min(12, 4 + dist * 0.03);
}

function updateBees(dt) {
  for (const b of bees) {
    b.t += dt / b.dur;
    if (b.t >= 1) {
      if (b.phase === 0) {
        vis[b.cell] = -1;
        boardDirty = true;
        b.phase = 1; b.t = 0;
        b.x0 = b.x1; b.y0 = b.y1;
        b.x1 = lay.hive.x + (Math.random() - 0.5) * 6; b.y1 = lay.hive.y + 12;
        b.dur = Math.max(380, Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 0.5);
        b.k = -b.k * 0.8;
        setZigzag(b);
      } else {
        b.done = true;
        hivePulse = performance.now() + 90;
        sfx('deliver');
      }
    }
  }
  bees = bees.filter((b) => !b.done);
}

function drawBees(c, now) {
  const size = lay.beeSize;
  const carry = lay.cs * 0.7;
  for (const b of bees) {
    const p = flightPos(b, ease(b.t) * 0.3 + b.t * 0.7);
    const frame = ((now / 45 + b.seed) | 0) % 2;
    c.save();
    c.translate(p.x, p.y);
    if (b.phase === 1) c.drawImage(tile(b.c, carry), -carry / 2, size * 0.25, carry, carry);
    c.rotate(p.a);
    c.drawImage(beeSprite(b.c, frame), -size, -size, size * 2, size * 2);
    c.restore();
  }
}

// ---------- end-of-level card built by a swarm ----------
// Bees pour out of the hive, fill the card's shape, the card appears, and the
// bees settle around its border until the card closes. Drawn on its own
// canvas above the modal overlay.
const fx = $('fx');
const fctx = fx.getContext('2d');
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
// Swarm bees come in a bright mix of colors.
const SWARM_COLORS = ['#e5484d', '#f28a2e', '#f7c843', '#a6d65a', '#3e9e4f', '#2bb5a5', '#62b6f0', '#3d5fd6', '#8f5bd8', '#f38bb8'];
let swarm = null;

function sizeFx() {
  fx.width = Math.round(innerWidth * dpr);
  fx.height = Math.round(innerHeight * dpr);
}

function startSwarm(card) {
  const now = performance.now();
  sizeFx();
  const rect = card.getBoundingClientRect();
  const cr = canvas.getBoundingClientRect();
  const hive = { x: cr.left + lay.hive.x, y: cr.top + lay.hive.y + 10 };
  // Spots spread over the card, about 26px apart, at most ~110 bees.
  let step = 26;
  while ((rect.width / step) * (rect.height / step) > 110) step += 2;
  const spots = [];
  for (let y = rect.top + step / 2; y < rect.bottom; y += step) {
    for (let x = rect.left + step / 2; x < rect.right; x += step) {
      spots.push({ x: x + (Math.random() - 0.5) * step * 0.5, y: y + (Math.random() - 0.5) * step * 0.5 });
    }
  }
  // Border spots, slightly outside the card, where bees wait afterwards.
  const ring = [];
  const per = 2 * (rect.width + rect.height);
  const count = Math.min(spots.length, Math.round(per / 30));
  const pad = 6;
  for (let i = 0; i < count; i++) {
    let d = (i / count) * per;
    let x, y, a;
    if (d < rect.width) { x = rect.left + d; y = rect.top - pad; a = 0; }
    else if ((d -= rect.width) < rect.height) { x = rect.right + pad; y = rect.top + d; a = Math.PI / 2; }
    else if ((d -= rect.height) < rect.width) { x = rect.right - d; y = rect.bottom + pad; a = Math.PI; }
    else { d -= rect.width; x = rect.left - pad; y = rect.bottom - d; a = -Math.PI / 2; }
    ring.push({ x, y, a });
  }
  const sb = spots.map((sp, i) => {
    const b = {
      x0: hive.x + (Math.random() - 0.5) * 10, y0: hive.y, x1: sp.x, y1: sp.y,
      k: (Math.random() - 0.5) * 0.5, seed: Math.random() * 10,
      t: 0, start: now + Math.random() * 550, dur: 650 + Math.random() * 300,
      ring: i < ring.length ? ring[i] : null, phase: 0,
      col: SWARM_COLORS[i % SWARM_COLORS.length],
    };
    setZigzag(b);
    return b;
  });
  swarm = { bees: sb, card, revealed: false, start: now };
}

function stopSwarm() {
  swarm = null;
  fctx.setTransform(1, 0, 0, 1, 0, 0);
  fctx.clearRect(0, 0, fx.width, fx.height);
}

function drawSwarm(now) {
  const c = fctx;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, fx.width, fx.height);
  if (!swarm) return 0;
  const size = 11;
  let flying = 0, arrived = 0;
  for (const b of swarm.bees) {
    if (now < b.start) continue;
    let t = Math.min(1, (now - b.start) / b.dur);
    if (t >= 1 && b.phase === 0) arrived++;
    if (t >= 1 && b.phase === 1) {
      if (!b.ring) { b.gone = true; continue; }
      b.phase = 2; // hover on the border
    }
    let x, y, a;
    if (b.phase === 2) {
      const w = (now / 1000) * 2 + b.seed;
      x = b.ring.x + Math.sin(w * 1.7) * 3;
      y = b.ring.y + Math.cos(w * 2.3) * 3;
      a = b.ring.a + Math.sin(w) * 0.5;
    } else {
      if (t < 1) flying++;
      const p = flightPos(b, ease(t) * 0.4 + t * 0.6);
      x = p.x; y = p.y; a = p.a;
    }
    const frame = ((now / 40 + b.seed) | 0) % 2;
    c.save();
    c.translate(x, y);
    c.rotate(a);
    c.drawImage(makeBee(b.col, frame, size), -size, -size, size * 2, size * 2);
    c.restore();
  }
  // Once most bees have filled the card, show it and send them to the border.
  if (!swarm.revealed && (arrived >= swarm.bees.length * 0.9 || now - swarm.start > 2200)) {
    swarm.revealed = true;
    swarm.card.classList.remove('forming');
    swarm.card.classList.add('formed');
    for (const b of swarm.bees) {
      const p = flightPos(b, Math.min(1, Math.max(0, (now - b.start) / b.dur)));
      b.x0 = p.x; b.y0 = p.y;
      if (b.ring) { b.x1 = b.ring.x; b.y1 = b.ring.y; }
      else {
        // Spare bees fly back toward the hive and off.
        const cr = canvas.getBoundingClientRect();
        b.x1 = cr.left + lay.hive.x; b.y1 = cr.top + lay.hive.y + 10;
      }
      b.phase = 1; b.start = now + Math.random() * 150; b.dur = 450 + Math.random() * 250;
      b.k = (Math.random() - 0.5) * 0.4;
      setZigzag(b);
    }
  }
  swarm.bees = swarm.bees.filter((b) => !b.gone);
  return flying;
}

// ---------- particles ----------
function burst() {
  const p = lay.panel;
  for (let i = 0; i < 90; i++) {
    particles.push({
      x: p.x + p.w / 2 + (Math.random() - 0.5) * p.w * 0.6,
      y: p.y + p.h * 0.55,
      vx: (Math.random() - 0.5) * 0.6,
      vy: -0.4 - Math.random() * 0.55,
      r: 4 + Math.random() * 6,
      c: L.colors[(Math.random() * L.colors.length) | 0],
      rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.01,
      life: 1600 + Math.random() * 900, age: 0,
    });
  }
}
function updateParticles(c, dt) {
  for (const q of particles) {
    q.age += dt;
    q.vy += 0.0011 * dt;
    q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.vr * dt;
    c.save();
    c.globalAlpha = Math.max(0, 1 - q.age / q.life);
    c.translate(q.x, q.y); c.rotate(q.rot);
    hexPath(c, 0, 0, q.r);
    c.fillStyle = q.c; c.fill();
    c.restore();
  }
  particles = particles.filter((q) => q.age < q.life);
}

// ---------- loop ----------
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const raw = Math.min(50, now - lastT);
  lastT = now;
  if (!L || !W) return;
  const speed = SPEEDS[prefs.speed].x;
  const dt = raw * speed;

  if (state === 'play' || state === 'won' || state === 'lost') {
    // Launch bees on a steady beat.
    tickAcc += dt;
    while (tickAcc >= TICK) {
      tickAcc -= TICK;
      launch(now);
    }
    flyers = flyers.filter((f) => now - f.start < f.dur);
    updateBees(dt);
    checkEnd(now);
  }
  const swarmFlying = drawSwarm(now);
  setBuzz(bees.length + swarmFlying);

  const c = ctx;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  if (boardDirty) drawBoardLayer();
  c.drawImage(boardCanvas, 0, 0, boardCanvas.width / dpr, boardCanvas.height / dpr);
  drawHive(c, now);
  drawSlots(c, now);
  drawStack(c, now);
  drawBees(c, now);
  if (particles.length) updateParticles(c, raw);
}

function launch(now) {
  const events = game.tick();
  for (const ev of events) {
    const v = vSlots[ev.slot];
    spawnBee(ev, lay.slots[ev.slot]);
    if (v && v.id === ev.id) v.n--;
    if (ev.last) sfx('done');
    // A joined swarm that runs out waits (showing 0) until its mate is empty.
    for (const s of ev.freed) {
      const f = vSlots[s];
      if (!f) continue;
      popping.push({ slot: s, c: f.c, at: now });
      vSlots[s] = null;
    }
  }
}

function checkEnd(now) {
  if (state !== 'play') return;
  if (game.won()) {
    if (bees.length === 0) {
      state = 'won';
      winLevel();
    }
    return;
  }
  if (game.stuck() && bees.length === 0 && flyers.length === 0) {
    if (!endAt) endAt = now + 700;
    else if (now > endAt && game.stuck()) {
      state = 'lost';
      loseLevel();
    }
  } else endAt = 0;
}

// ---------- input ----------
function hitColumn(x, y) {
  if (!lay.cols) return -1;
  const top = lay.stackTop - 6, bottom = H;
  if (y < top || y > bottom) return -1;
  let best = -1, bd = Infinity;
  lay.cols.forEach((col, k) => {
    const d = Math.abs(x - col.x);
    if (d < col.w / 2 + 4 && d < bd) { bd = d; best = k; }
  });
  return best;
}

canvas.addEventListener('pointerdown', (e) => {
  unlockAudio();
  if (state !== 'play') return;
  const rect = canvas.getBoundingClientRect();
  const k = hitColumn(e.clientX - rect.left, e.clientY - rect.top);
  if (k < 0) return;
  tapColumn(k);
});

function tapColumn(k) {
  const now = performance.now();
  const front = game.front(k);
  if (!front) return;
  if (!game.canTap(k)) {
    colShake[k] = now;
    if (game.locked(k)) {
      colShake[front.pair[0]] = now;
      showHint('Joined swarms leave together, once both are at the front', null, 3500);
    }
    sfx('error');
    haptic('error');
    return;
  }
  const placed = game.tap(k);
  for (const p of placed) {
    const dur = 230;
    const col = lay.cols[p.col];
    const y0 = p.row === 0 ? col.y : col.y2;
    flyers.push({ c: p.box.c, n: p.box.n, x0: col.x, y0, x1: lay.slots[p.slot].x, y1: lay.slots[p.slot].y, start: now, dur });
    vSlots[p.slot] = { id: p.id, c: p.box.c, n: p.box.n, mate: p.mate, arriveAt: now + dur };
    colShift[p.col] = now;
  }
  tapsMade++;
  sfx('tap');
  haptic('tap');
  if (hintMode === 'tap') hideHint();
  maybeLinkHint();
}

function maybeLinkHint() {
  if (!hintEl.hidden) return;
  const fronts = L.columns.map((_, k) => game.front(k));
  if (!prefs.seenJoin && fronts.some((b) => b && b.pair)) {
    prefs.seenJoin = true;
    save();
    showHint('Joined swarms leave together once both are at the front, and hold both spots until both are empty', null, 6000);
  } else if (!prefs.seenLink && fronts.some((b) => b && b.link)) {
    prefs.seenLink = true;
    save();
    showHint('Linked swarms leave together and need 2 free spots', null, 5000);
  }
}

// ---------- hints ----------
const hintEl = $('hint');
let hintMode = null;
let hintTimer = 0;
function showHint(text, mode, ms) {
  hintEl.textContent = text;
  hintEl.hidden = false;
  hintMode = mode;
  clearTimeout(hintTimer);
  if (ms) hintTimer = setTimeout(hideHint, ms);
  placeHint();
}
function hideHint() { hintEl.hidden = true; hintMode = null; }
function placeHint() {
  if (!lay.panel) return;
  hintEl.style.top = lay.panel.y + 10 + 'px';
}

// ---------- level flow ----------
const levelLabel = $('levelLabel');
const tierBadge = $('tierBadge');

async function startLevel(n) {
  state = 'idle';
  closeModal();
  levelLabel.textContent = 'Level ' + n;
  tierBadge.hidden = true;
  const level = await getLevel(n);
  L = level;
  game = new Game(L);
  vis = Int8Array.from(L.cells);
  bees = []; flyers = []; popping = []; particles = [];
  vSlots = new Array(L.slots || SLOT_COUNT).fill(null);
  colShift = []; colShake = [];
  tickAcc = 0; endAt = 0; tapsMade = 0;
  resize();
  if (L.tier !== 'normal') {
    tierBadge.textContent = TIERS[L.tier].label;
    tierBadge.className = 'tier' + (L.tier === 'super' ? ' super' : '');
    tierBadge.hidden = false;
    const b = $('banner');
    b.textContent = L.tier === 'super' ? 'Super Hard Level!' : 'Hard Level!';
    b.className = 'banner' + (L.tier === 'super' ? ' super' : '');
    b.hidden = false;
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    setTimeout(() => { b.hidden = true; }, 1900);
  }
  hideHint();
  if (n === 1) showHint('Tap a swarm to send its bees out', 'tap');
  else if (n === 2) showHint('Bees can only reach blocks on the outside edge', null, 5000);
  else if (n === 3) showHint('Only 5 swarms fit in the hive. Plan your order!', null, 5000);
  state = 'play';
  maybeLinkHint();
  prefetch(n + 1);
}

function winLevel() {
  sfx('win');
  haptic('win');
  burst();
  const n = L.n;
  prefs.level = Math.max(prefs.level, n + 1);
  save();
  prefetch(n + 1);
  const won = L;
  setTimeout(() => {
    if (L !== won || state !== 'won') return; // a different level started meanwhile
    const mini = miniPicture(L, 150);
    openModal(`Level ${n} done!`, [mini, para(`You uncovered: ${L.name}`)], [
      { label: 'Next level', fn: () => startLevel(n + 1) },
      { label: 'Home', secondary: true, fn: goHome },
    ], { swarm: true });
  }, 700);
}

function loseLevel() {
  sfx('lose');
  haptic('lose');
  openModal('Hive jammed!', [para('Every spot in the hive is waiting on blocks the bees can’t reach yet. Try a different order.')], [
    { label: 'Try again', fn: () => startLevel(L.n) },
    { label: 'Home', secondary: true, fn: goHome },
  ], { swarm: true });
}

function para(text) { const p = document.createElement('p'); p.textContent = text; return p; }

function miniPicture(level, max) {
  const cv = document.createElement('canvas');
  cv.className = 'mini';
  const cs = Math.max(2, Math.floor(max / Math.max(level.w, level.h)));
  const pad = 8;
  cv.width = (level.w * cs + pad * 2) * dpr;
  cv.height = (level.h * cs + pad * 2) * dpr;
  cv.style.width = level.w * cs + pad * 2 + 'px';
  cv.style.height = level.h * cs + pad * 2 + 'px';
  const c = cv.getContext('2d');
  c.scale(dpr, dpr);
  level.cells.forEach((v, i) => {
    if (v < 0) return;
    c.fillStyle = level.colors[v];
    c.fillRect(pad + (i % level.w) * cs, pad + ((i / level.w) | 0) * cs, cs, cs);
  });
  return cv;
}

// ---------- modal & menus ----------
function openModal(title, nodes, actions, { swarm: withSwarm = false } = {}) {
  stopSwarm();
  $('modalTitle').textContent = title;
  const body = $('modalBody');
  body.replaceChildren(...nodes);
  const act = $('modalActions');
  act.replaceChildren(...actions.map((a) => {
    const b = document.createElement('button');
    b.textContent = a.label;
    if (a.secondary) b.className = 'secondary';
    b.addEventListener('click', () => { unlockAudio(); sfx('click'); a.fn(); });
    return b;
  }));
  const card = modalEl.querySelector('.card');
  card.classList.remove('forming', 'formed');
  modalEl.hidden = false;
  if (withSwarm && !reduceMotion && lay.hive) {
    card.classList.add('forming');
    startSwarm(card);
  }
}
function closeModal() {
  modalEl.hidden = true;
  stopSwarm();
}

function toggleRow() {
  const wrap = document.createElement('div');
  wrap.className = 'toggles';
  for (const [key, label, apply] of [['sound', 'Sound', setSoundEnabled], ['haptics', 'Haptics', setHapticsEnabled]]) {
    const l = document.createElement('label');
    l.className = 'toggle';
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.checked = prefs[key];
    i.addEventListener('change', () => { prefs[key] = i.checked; apply(i.checked); save(); syncHomeToggles(); });
    const s = document.createElement('span');
    s.textContent = label;
    l.append(i, s);
    wrap.append(l);
  }
  return wrap;
}

let pausedState = null;
$('menuBtn').addEventListener('click', () => {
  unlockAudio();
  if (state !== 'play') return;
  pausedState = state;
  state = 'paused';
  openModal('Paused', [toggleRow(), speedPicker()], [
    { label: 'Resume', fn: () => { closeModal(); state = pausedState; } },
    { label: 'Restart level', secondary: true, fn: () => startLevel(L.n) },
    { label: 'Home', secondary: true, fn: goHome },
  ]);
});

// Bee speed: a Slow / Normal / Fast picker on the home screen and pause
// menu; the button in the top bar cycles through the same setting.
const speedBtn = $('speedBtn');
const speedPickers = new Set();
function setSpeed(key) {
  prefs.speed = key;
  save();
  syncSpeed();
}
function syncSpeed() {
  $('speedLabel').textContent = SPEEDS[prefs.speed].label;
  speedBtn.classList.toggle('fast', prefs.speed === 'fast');
  for (const el of speedPickers) markSpeed(el);
}
function markSpeed(el) {
  for (const b of el.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.speed === prefs.speed));
}
function speedPicker(el = document.createElement('div')) {
  el.className = 'speed-picker';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Bee speed');
  const title = document.createElement('span');
  title.textContent = 'Bee speed';
  const seg = document.createElement('div');
  seg.className = 'seg';
  for (const key of Object.keys(SPEEDS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.speed = key;
    b.textContent = SPEEDS[key].label;
    b.addEventListener('click', () => { unlockAudio(); sfx('click'); setSpeed(key); });
    seg.append(b);
  }
  el.replaceChildren(title, seg);
  markSpeed(el);
  // Keep the home picker, plus whichever one the pause menu shows now.
  for (const old of speedPickers) if (old.id !== 'homeSpeed') speedPickers.delete(old);
  speedPickers.add(el);
  return el;
}
speedBtn.addEventListener('click', () => {
  const keys = Object.keys(SPEEDS);
  setSpeed(keys[(keys.indexOf(prefs.speed) + 1) % keys.length]);
  sfx('click');
});
speedPicker($('homeSpeed'));
syncSpeed();

// ---------- home ----------
const soundToggle = $('soundToggle');
const hapticsToggle = $('hapticsToggle');
function syncHomeToggles() {
  soundToggle.checked = prefs.sound;
  hapticsToggle.checked = prefs.haptics;
}
soundToggle.addEventListener('change', () => { prefs.sound = soundToggle.checked; setSoundEnabled(prefs.sound); save(); });
hapticsToggle.addEventListener('change', () => {
  prefs.haptics = hapticsToggle.checked; setHapticsEnabled(prefs.haptics); save();
  if (prefs.haptics) haptic('tap');
});

function tierText(n) {
  if (n >= 10 && n % 10 === 0) return ' · Super Hard';
  if (n >= 5 && n % 5 === 0) return ' · Hard';
  return '';
}
function goHome() {
  closeModal();
  hideHint();
  state = 'idle';
  bees = [];
  $('playSub').textContent = 'Level ' + prefs.level + tierText(prefs.level);
  syncHomeToggles();
  homeEl.hidden = false;
  prefetch(prefs.level);
}
$('playBtn').addEventListener('click', () => {
  unlockAudio();
  sfx('click');
  homeEl.hidden = true;
  startLevel(prefs.level);
});
$('howBtn').addEventListener('click', () => {
  const ol = document.createElement('ol');
  ol.className = 'howto';
  for (const t of [
    'Tap a numbered swarm to move it into the hive.',
    'Its bees fly out one by one, each grabbing a block of their color.',
    'Bees can only reach blocks on the outside edge of the picture.',
    'The hive holds 5 swarms. A swarm leaves once all its bees are out.',
    'If every spot is waiting on blocks nobody can reach, the hive jams.',
    'Linked or joined swarms leave together. Joined ones wait until both are at the front, and keep both spots until both are empty.',
    'Clear every block to finish the level.',
  ]) { const li = document.createElement('li'); li.textContent = t; ol.append(li); }
  openModal('How to play', [ol], [{ label: 'Got it', fn: closeModal }]);
});

// ---------- boot ----------
initHaptics();
window.addEventListener('resize', () => { if (L) resize(); if (swarm) sizeFx(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { setBuzz(0); if (state === 'play') $('menuBtn').click(); }
});
document.fonts?.ready.then(() => { boardDirty = true; });
goHome();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Small hook for automated checks.
window.__hive = {
  get state() { return state; },
  get level() { return L; },
  get slots() { return game ? game.slots.map((v) => v && { ...v }) : []; },
  get idle() { return !!game && !game.canProgress() && bees.length === 0 && flyers.length === 0; },
  tap: (k) => tapColumn(k),
  start: (n) => { homeEl.hidden = true; return startLevel(n); },
};
