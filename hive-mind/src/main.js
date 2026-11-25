import { Game, SLOT_COUNT } from './engine.js';
import { TIERS } from './generator.js';
import { unlockAudio, sfx, setBuzz, setSoundEnabled } from './audio.js';
import { initHaptics, haptic, setHapticsEnabled } from './haptics.js';

// ---------- settings & progress ----------
const STORE = 'hivemind.v1';
const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } })();
const prefs = { level: 1, sound: true, haptics: true, fast: false, ...saved };
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
  tileCache.set(key, t);
  return t;
}

function beeSprite(colorIdx, frame) {
  const key = colorIdx + ':' + frame;
  let s = beeCache.get(key);
  if (s) return s;
  const size = lay.beeSize;
  const px = Math.ceil(size * 2 * dpr);
  s = document.createElement('canvas');
  s.width = s.height = px;
  const c = s.getContext('2d');
  c.scale(dpr, dpr);
  c.translate(size, size);
  const body = L.colors[colorIdx];
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

function drawLinkBar(c, x, y1, y2, r) {
  c.save();
  c.lineCap = 'round';
  c.strokeStyle = '#8a5a1e';
  c.lineWidth = r * 0.42;
  c.beginPath(); c.moveTo(x, y1); c.lineTo(x, y2); c.stroke();
  c.strokeStyle = '#d99a3a';
  c.lineWidth = r * 0.22;
  c.beginPath(); c.moveTo(x, y1); c.lineTo(x, y2); c.stroke();
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
  for (let i = 0; i < vSlots.length; i++) {
    const v = vSlots[i];
    if (!v || v.arriveAt > now) continue;
    const t = Math.min(1, (now - v.arriveAt) / 160);
    drawBox(c, lay.slots[i].x, lay.slots[i].y, r, v.c, v.n, { scale: 1 + 0.12 * Math.sin(t * Math.PI) });
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
  for (let k = 0; k < L.columns.length; k++) {
    const col = lay.cols[k];
    const ptr = game.ptr[k];
    const boxes = L.columns[k];
    let dx = 0;
    const sh = colShake[k];
    if (sh && now - sh < 350) dx = Math.sin((now - sh) / 25) * 6 * (1 - (now - sh) / 350);
    const slide = colShift[k] ? 1 - ease(Math.min(1, (now - colShift[k]) / 200)) : 0;
    const off = slide * (col.y2 - col.y);
    const front = boxes[ptr], next = boxes[ptr + 1];
    if (next) {
      const ny = col.y2 + off;
      if (front && front.link) drawLinkBar(c, col.x + dx, col.y + off, ny, r);
      drawBox(c, col.x + dx, ny, r * 0.86, next.c, next.n, { hidden: !!next.hidden, alpha: 0.95, dim: true });
    }
    if (front) {
      const need = front.link ? 2 : 1;
      drawBox(c, col.x + dx, col.y + off, r, front.c, front.n, { dim: need > room });
    }
    const more = boxes.length - ptr - 2;
    if (more > 0) {
      c.font = `600 ${Math.round(r * 0.42)}px ${FONT}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = 'rgba(110,70,20,0.75)';
      c.fillText('+' + more, col.x, col.y2 + lay.hh * 0.5 + 10);
    }
  }
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
}

function bezier(b, t) {
  const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2;
  const dx = b.x1 - b.x0, dy = b.y1 - b.y0;
  const cx = mx - dy * b.k, cy = my + dx * b.k;
  const u = 1 - t;
  return {
    x: u * u * b.x0 + 2 * u * t * cx + t * t * b.x1,
    y: u * u * b.y0 + 2 * u * t * cy + t * t * b.y1,
    a: Math.atan2(2 * u * (cy - b.y0) + 2 * t * (b.y1 - cy), 2 * u * (cx - b.x0) + 2 * t * (b.x1 - cx)),
  };
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
    const p = bezier(b, ease(b.t) * 0.3 + b.t * 0.7);
    const frame = ((now / 45 + b.seed) | 0) % 2;
    c.save();
    c.translate(p.x, p.y);
    if (b.phase === 1) c.drawImage(tile(b.c, carry), -carry / 2, size * 0.25, carry, carry);
    c.rotate(p.a);
    c.drawImage(beeSprite(b.c, frame), -size, -size, size * 2, size * 2);
    c.restore();
  }
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
  const speed = prefs.fast ? 2 : 1;
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
  setBuzz(bees.length);

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
    const from = lay.slots[ev.slot];
    spawnBee(ev, from);
    if (v && v.id === ev.id) {
      v.n--;
      if (ev.last) {
        popping.push({ slot: ev.slot, c: v.c, at: now });
        vSlots[ev.slot] = null;
        sfx('done');
      }
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
  if (!game.front(k)) return;
  if (!game.canTap(k)) {
    colShake[k] = now;
    sfx('error');
    haptic('error');
    return;
  }
  const col = lay.cols[k];
  const placed = game.tap(k);
  placed.forEach((p, i) => {
    const dur = 230;
    const y0 = i === 0 ? col.y : col.y2;
    flyers.push({ c: p.box.c, n: p.box.n, x0: col.x, y0, x1: lay.slots[p.slot].x, y1: lay.slots[p.slot].y, start: now, dur });
    vSlots[p.slot] = { id: p.id, c: p.box.c, n: p.box.n, arriveAt: now + dur };
  });
  colShift[k] = now;
  tapsMade++;
  sfx('tap');
  haptic('tap');
  if (hintMode === 'tap') hideHint();
  maybeLinkHint();
}

function maybeLinkHint() {
  if (prefs.seenLink || !hintEl.hidden) return;
  if (!L.columns.some((_, k) => game.front(k)?.link)) return;
  prefs.seenLink = true;
  save();
  showHint('Linked swarms leave together and need 2 free spots', null, 5000);
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
  else if (n === 3) showHint('Only 5 swarms fit in the hive, so choose carefully!', null, 5000);
  else if (n === 4) showHint('From here on the hive has just 4 spots. Plan your order!', null, 5000);
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
  setTimeout(() => {
    const mini = miniPicture(L, 150);
    openModal(`Level ${n} done!`, [mini, para(`You uncovered: ${L.name}`)], [
      { label: 'Next level', fn: () => startLevel(n + 1) },
      { label: 'Home', secondary: true, fn: goHome },
    ]);
  }, 900);
}

function loseLevel() {
  sfx('lose');
  haptic('lose');
  openModal('Hive jammed!', [para('Every spot in the hive is waiting on blocks the bees can’t reach yet. Try a different order.')], [
    { label: 'Try again', fn: () => startLevel(L.n) },
    { label: 'Home', secondary: true, fn: goHome },
  ]);
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
function openModal(title, nodes, actions) {
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
  modalEl.hidden = false;
}
function closeModal() { modalEl.hidden = true; }

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
  openModal('Paused', [toggleRow()], [
    { label: 'Resume', fn: () => { closeModal(); state = pausedState; } },
    { label: 'Restart level', secondary: true, fn: () => startLevel(L.n) },
    { label: 'Home', secondary: true, fn: goHome },
  ]);
});

const speedBtn = $('speedBtn');
function syncSpeed() {
  $('speedLabel').textContent = prefs.fast ? '2×' : '1×';
  speedBtn.classList.toggle('fast', prefs.fast);
}
speedBtn.addEventListener('click', () => {
  prefs.fast = !prefs.fast;
  save();
  syncSpeed();
  sfx('click');
});
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
    'The hive holds 4 swarms (5 on the first levels). A swarm leaves once all its bees are out.',
    'If every spot is waiting on blocks nobody can reach, the hive jams.',
    'Clear every block to finish the level.',
  ]) { const li = document.createElement('li'); li.textContent = t; ol.append(li); }
  openModal('How to play', [ol], [{ label: 'Got it', fn: closeModal }]);
});

// ---------- boot ----------
initHaptics();
window.addEventListener('resize', () => { if (L) resize(); });
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
  get idle() { return !!game && !game.canProgress() && bees.length === 0 && flyers.length === 0; },
  tap: (k) => tapColumn(k),
  start: (n) => { homeEl.hidden = true; return startLevel(n); },
};
