// Procedural pixel pictures. Each motif paints simple shapes onto a grid of
// color keys (see palette.js); the size and some colors vary with the seed,
// so the same motif shows up in many versions.

class Raster {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.g = new Array(w * h).fill('.');
  }
  get(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? '.' : this.g[y * this.w + x]; }
  set(x, y, k) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.g[y * this.w + x] = k; }
  // Paint every cell whose center satisfies pred(px, py), in cell units.
  shape(pred, k) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (pred(x + 0.5, y + 0.5)) this.g[y * this.w + x] = k;
    }
    return this;
  }
  circle(cx, cy, r, k) { return this.shape((x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r, k); }
  ellipse(cx, cy, rx, ry, k, ang = 0) {
    const c = Math.cos(ang), s = Math.sin(ang);
    return this.shape((x, y) => {
      const dx = x - cx, dy = y - cy;
      const u = dx * c + dy * s, v = -dx * s + dy * c;
      return (u / rx) ** 2 + (v / ry) ** 2 <= 1;
    }, k);
  }
  ring(cx, cy, r0, r1, k, pred = () => true) {
    return this.shape((x, y) => {
      const d = Math.hypot(x - cx, y - cy);
      return d >= r0 && d < r1 && pred(x, y);
    }, k);
  }
  rect(x0, y0, x1, y1, k) { return this.shape((x, y) => x >= x0 && x < x1 && y >= y0 && y < y1, k); }
  poly(pts, k) {
    return this.shape((x, y) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }, k);
  }
  line(x0, y0, x1, y1, th, k) {
    return this.shape((x, y) => {
      const dx = x1 - x0, dy = y1 - y0;
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)) <= th / 2;
    }, k);
  }
  // Recolor only cells that are already a given key.
  recolor(from, to, pred) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const i = y * this.w + x;
      if (this.g[i] === from && pred(x + 0.5, y + 0.5)) this.g[i] = to;
    }
    return this;
  }
  // Draw a border of color k around everything painted so far.
  outline(k) {
    const add = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.get(x, y) !== '.') continue;
      if (this.get(x - 1, y) !== '.' || this.get(x + 1, y) !== '.' || this.get(x, y - 1) !== '.' || this.get(x, y + 1) !== '.') add.push([x, y]);
    }
    for (const [x, y] of add) this.set(x, y, k);
    return this;
  }
  mirrorX() {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w / 2; x++) this.set(this.w - 1 - x, y, this.get(x, y));
    return this;
  }
  // Crop to the painted area.
  trim() {
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.get(x, y) !== '.') { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    const r = new Raster(x1 - x0 + 1, y1 - y0 + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) r.set(x - x0, y - y0, this.get(x, y));
    return r;
  }
}

const PETALS = ['R', 'K', 'P', 'O', 'S', 'W', 'B', 'Y'];

// Each motif: (S, rng) => Raster. S is the rough picture size in cells.
// `colors` is a rough color count (for picking simple motifs early on).
export const MOTIFS = {
  heart: { colors: 2, make(S, r) {
    const R = new Raster(S, S), c = S / 2;
    const main = r.pick(['R', 'K', 'P', 'O']);
    R.shape((x, y) => {
      const u = (x - c) / (S * 0.42), v = -(y - S * 0.47) / (S * 0.42);
      return (u * u + v * v - 1) ** 3 - u * u * v ** 3 <= 0;
    }, main);
    R.ellipse(S * 0.32, S * 0.33, S * 0.08, S * 0.05, 'W', -0.7);
    if (S > 12 && r.chance(0.6)) R.outline(main === 'R' ? 'M' : 'D');
    return R;
  } },

  star: { colors: 3, make(S, r) {
    const R = new Raster(S, S), c = S / 2;
    const pts = (ro, ri) => Array.from({ length: 10 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? ri : ro;
      return [c + Math.cos(a) * rr, c + 0.05 * S + Math.sin(a) * rr];
    });
    R.poly(pts(S * 0.5, S * 0.21), 'Y');
    R.poly(pts(S * 0.3, S * 0.13), r.pick(['O', 'H']));
    if (S > 12) { R.circle(c - S * 0.08, c + S * 0.02, S * 0.04, 'D'); R.circle(c + S * 0.08, c + S * 0.02, S * 0.04, 'D'); }
    return R;
  } },

  apple: { colors: 4, make(S, r) {
    const R = new Raster(S, S);
    const main = r.pick(['R', 'L', 'Y']);
    R.circle(S * 0.36, S * 0.58, S * 0.33, main).circle(S * 0.64, S * 0.58, S * 0.33, main);
    R.ellipse(S * 0.3, S * 0.48, S * 0.07, S * 0.12, 'W', 0.4);
    R.line(S * 0.5, S * 0.3, S * 0.55, S * 0.08, Math.max(1.2, S * 0.07), 'N');
    R.ellipse(S * 0.7, S * 0.15, S * 0.15, S * 0.07, 'G', -0.5);
    return R;
  } },

  cherries: { colors: 4, make(S, r) {
    const R = new Raster(S, S);
    R.line(S * 0.28, S * 0.7, S * 0.55, S * 0.15, Math.max(1.2, S * 0.05), 'G');
    R.line(S * 0.72, S * 0.66, S * 0.55, S * 0.15, Math.max(1.2, S * 0.05), 'G');
    R.ellipse(S * 0.72, S * 0.14, S * 0.18, S * 0.08, 'L', -0.3);
    R.circle(S * 0.28, S * 0.74, S * 0.22, 'R').circle(S * 0.72, S * 0.7, S * 0.22, 'M');
    R.circle(S * 0.22, S * 0.68, S * 0.05, 'W').circle(S * 0.66, S * 0.64, S * 0.05, 'W');
    return R;
  } },

  balloons: { colors: 4, make(S, r) {
    const R = new Raster(S, S);
    const cols = r.shuffle(['R', 'S', 'Y', 'P', 'K', 'L']).slice(0, 3);
    const spots = [[0.3, 0.3], [0.68, 0.26], [0.5, 0.42]];
    spots.forEach(([x, y], i) => R.line(x * S, (y + 0.2) * S, 0.5 * S, 0.95 * S, 1, 'A'));
    spots.forEach(([x, y], i) => {
      R.ellipse(x * S, y * S, S * 0.17, S * 0.21, cols[i]);
      R.ellipse((x - 0.06) * S, (y - 0.08) * S, S * 0.03, S * 0.05, 'W');
    });
    return R;
  } },

  flower: { colors: 5, make(S, r) {
    const R = new Raster(S, S);
    const cx = S / 2, cy = S * 0.38;
    const petal = r.pick(PETALS), center = petal === 'Y' ? 'N' : r.pick(['Y', 'O', 'N']);
    R.line(cx, cy, cx, S, Math.max(1.5, S * 0.08), 'G');
    R.ellipse(cx - S * 0.18, S * 0.78, S * 0.16, S * 0.07, 'L', 0.5);
    R.ellipse(cx + S * 0.18, S * 0.72, S * 0.16, S * 0.07, 'L', -0.5);
    const n = r.int(5, 8), pr = S * (n > 6 ? 0.12 : 0.14);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      R.circle(cx + Math.cos(a) * S * 0.2, cy + Math.sin(a) * S * 0.2, pr, petal);
    }
    R.circle(cx, cy, S * 0.14, center);
    if (S > 14) R.circle(cx - S * 0.04, cy - S * 0.04, S * 0.04, 'W');
    return R;
  } },

  tulips: { colors: 5, make(S, r) {
    const R = new Raster(S, S);
    const cols = r.shuffle(['R', 'K', 'P', 'Y', 'O']);
    const xs = [0.25, 0.5, 0.75];
    xs.forEach((fx, i) => {
      const x = fx * S, top = S * (i === 1 ? 0.12 : 0.28);
      R.line(x, top + S * 0.15, x, S * 0.95, Math.max(1.2, S * 0.05), 'G');
      R.ellipse(x + (i === 0 ? -1 : 1) * S * 0.08, S * 0.78, S * 0.1, S * 0.04, 'L', i === 0 ? 0.7 : -0.7);
      const w = S * 0.11;
      R.poly([[x - w, top], [x - w / 3, top + w * 0.6], [x, top], [x + w / 3, top + w * 0.6], [x + w, top], [x + w, top + w * 1.4], [x - w, top + w * 1.4]], cols[i]);
      R.ellipse(x, top + w * 1.35, w, w * 0.55, cols[i]);
    });
    return R;
  } },

  mushroom: { colors: 4, make(S, r) {
    const R = new Raster(S, S);
    const cap = r.pick(['R', 'O', 'P', 'B']);
    R.rect(S * 0.36, S * 0.45, S * 0.64, S * 0.9, 'W');
    R.ellipse(S / 2, S * 0.9, S * 0.45, S * 0.07, 'G');
    R.shape((x, y) => y < S * 0.5 && ((x - S / 2) / (S * 0.48)) ** 2 + ((y - S * 0.5) / (S * 0.42)) ** 2 <= 1, cap);
    for (const [x, y, rr] of [[0.3, 0.3, 0.07], [0.55, 0.2, 0.08], [0.72, 0.38, 0.06], [0.45, 0.42, 0.04]]) R.recolor(cap, 'W', (px, py) => Math.hypot(px - x * S, py - y * S) <= rr * S + 0.3);
    if (S > 16) { R.circle(S * 0.44, S * 0.62, S * 0.025, 'D'); R.circle(S * 0.56, S * 0.62, S * 0.025, 'D'); }
    return R;
  } },

  ladybug: { colors: 4, make(S, r) {
    const R = new Raster(S, S);
    const shell = r.pick(['R', 'R', 'O', 'Y']);
    for (let i = 0; i < 3; i++) {
      const y = S * (0.45 + i * 0.15);
      R.line(S * 0.12, y, S * 0.88, y, 1, 'D');
    }
    R.circle(S / 2, S * 0.2, S * 0.17, 'D');
    R.circle(S * 0.43, S * 0.15, S * 0.04, 'W').circle(S * 0.57, S * 0.15, S * 0.04, 'W');
    R.circle(S / 2, S * 0.56, S * 0.36, shell);
    R.line(S / 2, S * 0.22, S / 2, S * 0.92, Math.max(1, S * 0.04), 'D');
    for (const [x, y] of [[0.33, 0.42], [0.67, 0.42], [0.3, 0.66], [0.7, 0.66], [0.42, 0.8], [0.58, 0.8]]) R.circle(x * S, y * S, S * 0.055, 'D');
    return R;
  } },

  tree: { colors: 5, make(S, r) {
    const R = new Raster(S, S);
    R.rect(S * 0.43, S * 0.55, S * 0.57, S * 0.95, 'N');
    R.line(S * 0.5, S * 0.75, S * 0.68, S * 0.6, Math.max(1, S * 0.05), 'N');
    R.ellipse(S / 2, S * 0.96, S * 0.4, S * 0.06, 'L');
    for (const [x, y, rr] of [[0.5, 0.25, 0.22], [0.3, 0.42, 0.2], [0.7, 0.42, 0.2], [0.5, 0.48, 0.2]]) R.circle(x * S, y * S, rr * S, 'G');
    R.recolor('G', 'F', (x, y) => x - S * 0.5 + (y - S * 0.35) > S * 0.28);
    const fruit = r.pick(['R', 'O', 'K', 'Y']);
    for (const [x, y] of [[0.35, 0.3], [0.62, 0.22], [0.7, 0.48], [0.3, 0.52], [0.5, 0.4]]) if (r.chance(0.8)) R.circle(x * S, y * S, Math.max(0.8, S * 0.04), fruit);
    return R;
  } },

  house: { colors: 6, make(S, r) {
    const R = new Raster(S, S);
    const wall = r.pick(['W', 'Y', 'S', 'K']), roof = r.pick(['R', 'M', 'B', 'N']);
    R.rect(S * 0.66, S * 0.08, S * 0.78, S * 0.35, 'A');
    R.rect(S * 0.15, S * 0.45, S * 0.85, S * 0.95, wall);
    R.poly([[S * 0.05, S * 0.48], [S * 0.5, S * 0.1], [S * 0.95, S * 0.48]], roof);
    R.rect(S * 0.42, S * 0.68, S * 0.58, S * 0.95, 'N');
    R.rect(S * 0.2, S * 0.55, S * 0.36, S * 0.71, 'S').rect(S * 0.64, S * 0.55, S * 0.8, S * 0.71, 'S');
    if (S > 14) { R.line(S * 0.28, S * 0.55, S * 0.28, S * 0.71, 1, 'W'); R.line(S * 0.72, S * 0.55, S * 0.72, S * 0.71, 1, 'W'); }
    R.rect(S * 0.05, S * 0.95, S * 0.95, S, 'G');
    return R;
  } },

  fish: { colors: 5, make(S, r) {
    const R = new Raster(S, S);
    const body = r.pick(['O', 'S', 'P', 'Y', 'K']), stripe = body === 'W' ? 'O' : 'W';
    R.poly([[S * 0.62, S * 0.5], [S * 0.95, S * 0.25], [S * 0.95, S * 0.75]], body === 'O' ? 'R' : 'B');
    R.ellipse(S * 0.42, S * 0.5, S * 0.34, S * 0.24, body);
    R.recolor(body, stripe, (x) => Math.abs(x - S * 0.5) < S * 0.04 || Math.abs(x - S * 0.32) < S * 0.035);
    R.circle(S * 0.22, S * 0.44, Math.max(1.1, S * 0.07), 'W').rect(Math.floor(S * 0.22), Math.floor(S * 0.44), Math.floor(S * 0.22) + 1, Math.floor(S * 0.44) + 1, 'D');
    R.poly([[S * 0.35, S * 0.27], [S * 0.5, S * 0.1], [S * 0.6, S * 0.3]], body === 'O' ? 'R' : 'B');
    R.circle(S * 0.08, S * 0.2, S * 0.04, 'S').circle(S * 0.14, S * 0.08, S * 0.03, 'S');
    return R;
  } },

  sun: { colors: 4, make(S, r) {
    const R = new Raster(S, S), c = S / 2;
    const n = r.pick([8, 12]);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      R.line(c + Math.cos(a) * S * 0.3, c + Math.sin(a) * S * 0.3, c + Math.cos(a) * S * 0.48, c + Math.sin(a) * S * 0.48, Math.max(1.4, S * 0.07), 'O');
    }
    R.circle(c, c, S * 0.3, 'Y');
    R.circle(c - S * 0.1, c - S * 0.04, S * 0.035, 'D').circle(c + S * 0.1, c - S * 0.04, S * 0.035, 'D');
    R.circle(c - S * 0.17, c + S * 0.06, S * 0.05, 'K').circle(c + S * 0.17, c + S * 0.06, S * 0.05, 'K');
    R.ring(c, c + S * 0.02, S * 0.1, S * 0.15, 'D', (x, y) => y > c + S * 0.08);
    return R;
  } },

  rainbow: { colors: 7, make(S, r) {
    const R = new Raster(S, Math.ceil(S * 0.7)), c = S / 2, base = S * 0.62;
    const bands = ['R', 'O', 'Y', 'G', 'S', 'P'];
    const bw = S * 0.065;
    bands.forEach((k, i) => R.ring(c, base, S * 0.46 - (i + 1) * bw, S * 0.46 - i * bw, k, (x, y) => y < base));
    for (const x of [0.13, 0.87]) {
      R.circle(x * S, base, S * 0.08, 'W').circle((x - 0.07) * S, base + S * 0.03, S * 0.06, 'W').circle((x + 0.07) * S, base + S * 0.03, S * 0.06, 'W');
    }
    return R;
  } },

  honeyjar: { colors: 5, make(S, r) {
    const R = new Raster(S, S);
    R.shape((x, y) => y > S * 0.3 && y < S * 0.95 && ((x - S / 2) / (S * 0.38)) ** 4 + ((y - S * 0.62) / (S * 0.33)) ** 4 <= 1, 'H');
    R.recolor('H', 'Y', (x, y) => x < S * 0.3 && y < S * 0.7);
    R.rect(S * 0.22, S * 0.16, S * 0.78, S * 0.3, r.pick(['R', 'B', 'N']));
    R.rect(S * 0.28, S * 0.48, S * 0.72, S * 0.72, 'W');
    R.circle(S / 2, S * 0.6, S * 0.07, 'D');
    R.line(S * 0.3, S * 0.3, S * 0.3, S * 0.42, Math.max(1.2, S * 0.06), 'H');
    R.line(S * 0.62, S * 0.3, S * 0.62, S * 0.38, Math.max(1.2, S * 0.06), 'H');
    return R;
  } },

  bee: { colors: 4, make(S, r) {
    const R = new Raster(S, S);
    R.ellipse(S * 0.38, S * 0.24, S * 0.17, S * 0.13, 'S', -0.4);
    R.ellipse(S * 0.62, S * 0.24, S * 0.17, S * 0.13, 'S', 0.4);
    R.ellipse(S / 2, S * 0.58, S * 0.4, S * 0.27, 'Y');
    R.recolor('Y', 'D', (x) => Math.abs(x - S * 0.5) < S * 0.05 || Math.abs(x - S * 0.7) < S * 0.05);
    R.poly([[S * 0.88, S * 0.52], [S * 0.99, S * 0.58], [S * 0.88, S * 0.64]], 'D');
    R.circle(S * 0.24, S * 0.52, S * 0.05, 'D');
    R.circle(S * 0.3, S * 0.64, S * 0.04, 'K');
    return R;
  } },

  butterfly: { colors: 5, make(S, r) {
    const R = new Raster(S, S);
    const a = r.pick(['P', 'B', 'O', 'S']), b = r.pick(['K', 'Y', 'T', 'R']);
    R.ellipse(S * 0.28, S * 0.33, S * 0.22, S * 0.2, a, -0.3);
    R.ellipse(S * 0.32, S * 0.7, S * 0.15, S * 0.16, b, 0.3);
    R.circle(S * 0.24, S * 0.3, S * 0.07, 'W');
    R.circle(S * 0.32, S * 0.7, S * 0.05, 'Y');
    R.mirrorX();
    R.ellipse(S / 2, S * 0.52, S * 0.05, S * 0.3, 'D');
    R.line(S * 0.48, S * 0.24, S * 0.38, S * 0.06, 1, 'D').line(S * 0.52, S * 0.24, S * 0.62, S * 0.06, 1, 'D');
    return R;
  } },

  cactus: { colors: 5, make(S, r) {
    const R = new Raster(S, S);
    R.rect(S * 0.42, S * 0.12, S * 0.58, S * 0.75, 'G');
    R.circle(S * 0.5, S * 0.14, S * 0.08, 'G');
    R.rect(S * 0.22, S * 0.32, S * 0.3, S * 0.52, 'G').rect(S * 0.22, S * 0.46, S * 0.45, S * 0.53, 'G');
    R.rect(S * 0.7, S * 0.24, S * 0.78, S * 0.44, 'G').rect(S * 0.55, S * 0.4, S * 0.78, S * 0.47, 'G');
    R.recolor('G', 'F', (x) => Math.abs(x - S * 0.5) < 0.6);
    R.circle(S * 0.5, S * 0.07, S * 0.06, r.pick(['K', 'R', 'Y']));
    R.poly([[S * 0.24, S * 0.72], [S * 0.76, S * 0.72], [S * 0.68, S * 0.98], [S * 0.32, S * 0.98]], 'O');
    R.rect(S * 0.2, S * 0.7, S * 0.8, S * 0.77, 'N');
    return R;
  } },

  rocket: { colors: 6, make(S, r) {
    const R = new Raster(S, S);
    const accent = r.pick(['R', 'B', 'P']);
    R.poly([[S * 0.5, S * 0.86], [S * 0.38, S * 0.98], [S * 0.62, S * 0.98]], 'Y');
    R.poly([[S * 0.5, S * 0.8], [S * 0.42, S * 0.92], [S * 0.58, S * 0.92]], 'O');
    R.poly([[S * 0.32, S * 0.58], [S * 0.18, S * 0.8], [S * 0.36, S * 0.78]], accent);
    R.poly([[S * 0.68, S * 0.58], [S * 0.82, S * 0.8], [S * 0.64, S * 0.78]], accent);
    R.ellipse(S * 0.5, S * 0.5, S * 0.18, S * 0.36, 'W');
    R.recolor('W', accent, (x, y) => y < S * 0.27);
    R.circle(S * 0.5, S * 0.45, S * 0.09, 'A').circle(S * 0.5, S * 0.45, S * 0.06, 'S');
    return R;
  } },

  sailboat: { colors: 6, make(S, r) {
    const R = new Raster(S, S);
    R.rect(0, S * 0.84, S, S, 'B');
    R.recolor('B', 'S', (x, y) => Math.sin(x * 0.9) > 0.3 && y < S * 0.89);
    R.poly([[S * 0.1, S * 0.68], [S * 0.9, S * 0.68], [S * 0.76, S * 0.85], [S * 0.24, S * 0.85]], r.pick(['N', 'R']));
    R.line(S * 0.5, S * 0.08, S * 0.5, S * 0.68, 1, 'D');
    R.poly([[S * 0.46, S * 0.12], [S * 0.46, S * 0.62], [S * 0.12, S * 0.62]], 'W');
    R.poly([[S * 0.54, S * 0.22], [S * 0.54, S * 0.62], [S * 0.8, S * 0.62]], r.pick(['Y', 'K', 'W']));
    R.poly([[S * 0.52, S * 0.06], [S * 0.66, S * 0.1], [S * 0.52, S * 0.14]], 'R');
    return R;
  } },

  icecream: { colors: 6, make(S, r) {
    const R = new Raster(S, S);
    R.poly([[S * 0.28, S * 0.5], [S * 0.72, S * 0.5], [S * 0.5, S * 0.98]], 'H');
    R.recolor('H', 'N', (x, y) => Math.round((x + y) / 2) % 3 === 0 || Math.round((x - y + S) / 2) % 3 === 0);
    const sc = r.shuffle(['K', 'W', 'O', 'L', 'N', 'P']);
    R.circle(S * 0.36, S * 0.46, S * 0.16, sc[0]).circle(S * 0.64, S * 0.46, S * 0.16, sc[1]);
    R.circle(S * 0.5, S * 0.28, S * 0.17, sc[2]);
    R.circle(S * 0.5, S * 0.08, S * 0.06, 'R');
    return R;
  } },

  watermelon: { colors: 5, make(S, r) {
    const R = new Raster(S, Math.ceil(S * 0.6)), c = S / 2, top = S * 0.05;
    const half = (rr, k) => R.shape((x, y) => y >= top && Math.hypot(x - c, y - top) <= rr, k);
    half(S * 0.5, 'F'); half(S * 0.44, 'L'); half(S * 0.4, 'R');
    for (const [x, y] of [[0.35, 0.15], [0.5, 0.22], [0.65, 0.15], [0.42, 0.32], [0.58, 0.32], [0.25, 0.1], [0.75, 0.1]]) R.set(Math.floor(x * S), Math.floor(y * S), 'D');
    return R;
  } },

  snowman: { colors: 6, make(S, r) {
    const R = new Raster(S, S);
    R.circle(S * 0.5, S * 0.72, S * 0.26, 'W').circle(S * 0.5, S * 0.36, S * 0.18, 'W');
    R.rect(S * 0.34, S * 0.04, S * 0.66, S * 0.2, 'D').rect(S * 0.26, S * 0.18, S * 0.74, S * 0.23, 'D');
    R.rect(S * 0.3, S * 0.5, S * 0.7, S * 0.56, r.pick(['R', 'B', 'G']));
    R.poly([[S * 0.5, S * 0.38], [S * 0.68, S * 0.42], [S * 0.5, S * 0.44]], 'O');
    R.circle(S * 0.43, S * 0.32, S * 0.03, 'D').circle(S * 0.57, S * 0.32, S * 0.03, 'D');
    for (const y of [0.64, 0.74, 0.84]) R.circle(S * 0.5, y * S, S * 0.03, 'D');
    R.outline('A');
    return R;
  } },

  cat: { colors: 5, make(S, r) {
    const R = new Raster(S, S);
    const fur = r.pick(['O', 'A', 'N', 'D']);
    R.poly([[S * 0.12, S * 0.45], [S * 0.18, S * 0.08], [S * 0.42, S * 0.3]], fur);
    R.poly([[S * 0.88, S * 0.45], [S * 0.82, S * 0.08], [S * 0.58, S * 0.3]], fur);
    R.poly([[S * 0.18, S * 0.36], [S * 0.21, S * 0.18], [S * 0.33, S * 0.3]], 'K');
    R.poly([[S * 0.82, S * 0.36], [S * 0.79, S * 0.18], [S * 0.67, S * 0.3]], 'K');
    R.ellipse(S * 0.5, S * 0.56, S * 0.4, S * 0.34, fur);
    R.ellipse(S * 0.5, S * 0.72, S * 0.18, S * 0.12, 'W');
    R.circle(S * 0.35, S * 0.5, S * 0.07, 'L').circle(S * 0.65, S * 0.5, S * 0.07, 'L');
    R.rect(S * 0.34, S * 0.44, S * 0.37, S * 0.56, 'D').rect(S * 0.64, S * 0.44, S * 0.67, S * 0.56, 'D');
    R.circle(S * 0.5, S * 0.64, S * 0.04, 'K');
    return R;
  } },

  // Concentric rings: every inner color is sealed in by the outer ones.
  target: { colors: 6, make(S, r) {
    const R = new Raster(S, S), c = S / 2;
    const cols = r.shuffle(['R', 'O', 'Y', 'L', 'T', 'B', 'P', 'K', 'W']).slice(0, r.int(4, 6));
    const n = cols.length * 2 - 1;
    for (let i = 0; i < n; i++) {
      const k = cols[i < cols.length ? i : n - 1 - i];
      R.circle(c, c, S * 0.5 * (1 - i / n), k);
    }
    return R;
  } },

  mandala: { colors: 7, make(S, r) {
    const R = new Raster(S, S), c = S / 2;
    const cols = r.shuffle(['R', 'O', 'Y', 'L', 'G', 'T', 'S', 'B', 'P', 'K', 'M']).slice(0, r.int(5, 7));
    const fold = r.pick([4, 6, 8]);
    const bands = r.int(4, 6);
    const table = Array.from({ length: bands }, () => Array.from({ length: 3 }, () => r.pick(cols)));
    const wob = r() * 0.15 + 0.05;
    R.shape((x, y) => {
      const dx = x - c, dy = y - c, d = Math.hypot(dx, dy) / (S / 2);
      const a = Math.atan2(dy, dx);
      return d <= 1 - wob * (1 + Math.cos(a * fold)) / 2;
    }, 'X');
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (R.get(x, y) !== 'X') continue;
      const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.hypot(dx, dy) / (S / 2);
      const a = ((Math.atan2(dy, dx) / (Math.PI * 2)) * fold + 10) % 1;
      const band = Math.min(bands - 1, Math.floor(d * bands));
      const seg = a < 0.33 || a > 0.67 ? 0 : a < 0.45 || a > 0.55 ? 1 : 2;
      R.set(x, y, table[band][seg]);
    }
    return R;
  } },

  quilt: { colors: 6, make(S, r) {
    const n = Math.max(3, Math.round(S / 5)), cell = Math.max(2, Math.floor((S * 0.8) / n));
    const R = new Raster(n * cell, n * cell);
    const cols = r.shuffle(['R', 'O', 'Y', 'L', 'G', 'T', 'S', 'B', 'P', 'K', 'W']).slice(0, r.int(4, 6));
    for (let by = 0; by < Math.ceil(n / 2); by++) for (let bx = 0; bx < Math.ceil(n / 2); bx++) {
      const k = r.pick(cols), k2 = r.pick(cols), kind = r.int(0, 3);
      const paint = (ox, oy, flipX, flipY) => {
        for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
          const u = flipX ? cell - 1 - x : x, v = flipY ? cell - 1 - y : y;
          let col = k;
          if (kind === 1 && u > v) col = k2;
          if (kind === 2 && (u === 0 || v === 0 || u === cell - 1 || v === cell - 1)) col = k2;
          if (kind === 3 && (u + v) % 2) col = k2;
          R.set(ox + x, oy + y, col);
        }
      };
      paint(bx * cell, by * cell, false, false);
      paint((n - 1 - bx) * cell, by * cell, true, false);
      paint(bx * cell, (n - 1 - by) * cell, false, true);
      paint((n - 1 - bx) * cell, (n - 1 - by) * cell, true, true);
    }
    return R;
  } },
};

// Simple motifs for the first levels.
export const EASY = ['heart', 'star', 'apple', 'balloons', 'cherries', 'sun', 'mushroom'];
// Motifs that wall colors in behind other colors.
export const NESTED = ['target', 'mandala', 'rainbow', 'watermelon', 'quilt'];
export const ALL = Object.keys(MOTIFS);

// Build a picture: { name, w, h, keys: [colorKey...], cells: [index or -1] }.
export function makePicture(name, S, rng, { outline = [] } = {}) {
  let R = MOTIFS[name].make(S, rng);
  for (const k of outline) R.outline(k);
  R = R.trim();
  const keys = [];
  const cells = R.g.map((k) => {
    if (k === '.') return -1;
    let i = keys.indexOf(k);
    if (i < 0) { i = keys.length; keys.push(k); }
    return i;
  });
  return { name, w: R.w, h: R.h, keys, cells };
}

// Text preview for debugging: node -e "..." prints a picture.
export function toText(pic) {
  let s = '';
  for (let y = 0; y < pic.h; y++) {
    for (let x = 0; x < pic.w; x++) {
      const v = pic.cells[y * pic.w + x];
      s += v < 0 ? '.' : pic.keys[v];
    }
    s += '\n';
  }
  return s;
}

// Related shades used to split one big color into two.
const SHADES = {
  R: ['M', 'K', 'O'], M: ['R', 'P'], O: ['Y', 'R', 'H'], Y: ['H', 'O', 'L'], H: ['Y', 'N', 'O'],
  L: ['G', 'Y', 'T'], G: ['F', 'L', 'T'], F: ['G', 'T'], T: ['S', 'G', 'F'], S: ['B', 'T', 'W'],
  B: ['S', 'P'], P: ['K', 'B', 'M'], K: ['P', 'R', 'W'], N: ['H', 'D', 'O'], W: ['A', 'Y', 'S'],
  D: ['A', 'N', 'B'], A: ['W', 'D'],
};

// Add shading until the picture has `target` colors: pick the biggest color
// and paint its lower-right part (or a band, or speckles) in a related shade.
export function enrich(pic, target, rng) {
  const { w, h } = pic;
  for (let guard = 0; pic.keys.length < target && guard < 12; guard++) {
    const counts = pic.keys.map(() => 0);
    for (const c of pic.cells) if (c >= 0) counts[c]++;
    const order = counts.map((n, i) => i).sort((a, b) => counts[b] - counts[a]);
    let done = false;
    for (const c of order) {
      if (counts[c] < 12) break;
      const shade = (SHADES[pic.keys[c]] || []).find((k) => !pic.keys.includes(k));
      if (!shade) continue;
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      pic.cells.forEach((v, i) => { if (v === c) { const x = i % w, y = (i / w) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } });
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, span = Math.max(x1 - x0, y1 - y0) + 1;
      const style = rng.int(0, 2);
      const ang = rng() * Math.PI * 2;
      const pred = style === 0
        ? (x, y) => (x - cx) + (y - cy) > span * 0.15 // shadow on the lower right
        : style === 1
          ? (x, y) => Math.abs(Math.cos(ang) * (x - cx) + Math.sin(ang) * (y - cy)) < span * 0.18 // a band
          : (x, y) => Math.hypot(x - cx, y - cy) < span * 0.28; // a core
      const ni = pic.keys.length;
      let changed = 0;
      pic.cells.forEach((v, i) => { if (v === c && pred(i % w, (i / w) | 0)) { pic.cells[i] = ni; changed++; } });
      if (changed >= 4 && counts[c] - changed >= 4) { pic.keys.push(shade); done = true; break; }
      pic.cells.forEach((v, i) => { if (v === ni) pic.cells[i] = c; }); // undo
    }
    if (!done) break;
  }
  return pic;
}

// Sprinkle single pixels of related colors already in the picture, so
// every color turns up in many places and its last blocks end up buried.
export function speckle(pic, rate, rng) {
  if (rate <= 0) return pic;
  const { w } = pic;
  const present = new Set(pic.keys);
  const orig = pic.cells.slice();
  for (let i = 0; i < orig.length; i++) {
    const c = orig[i];
    if (c < 0 || !rng.chance(rate)) continue;
    // Keep the picture readable: only speckle cells surrounded by the same color.
    const x = i % w;
    const same = [i - 1, i + 1, i - w, i + w].filter((j) => j >= 0 && j < orig.length && Math.abs((j % w) - x) <= 1 && orig[j] === c).length;
    if (same < 3) continue;
    const opts = (SHADES[pic.keys[c]] || []).filter((k) => present.has(k));
    const pool = opts.length ? opts : [...present].filter((k) => k !== pic.keys[c]);
    if (!pool.length) continue;
    pic.cells[i] = pic.keys.indexOf(rng.pick(pool));
  }
  return pic;
}
