// Paints a top-down battlemap image from a map's terrain and heights, so the artwork always
// matches the rules underneath. Browser only (uses canvas).
//
//   paintBackdrop(map, { hexPx, seed, biome }) -> { canvas, hexPx, ox, oy }
//   biome: 'meadow' (default), 'snow' (snowfields, frozen water, snow-laden pines) or
//          'desert' (dunes, red sandstone cliffs, palms around the water),
//          'cave' (rock is solid dark stone, so only the passages are lit; forest is glowing fungus)
//
// Stage 1 builds soft low-resolution fields (water, forest, ruins, rock, height) from the hexes,
// with the hex boundaries wobbled by noise so nothing looks hexagonal. Stage 2 shades every pixel
// from those fields: ground colour, hill shading lit from the north-west, cliffs, water and shore.
// Stage 3 draws trees, boulders, walls and small details on top.
import { key, hexRound, dist } from './hex.js';

const R3 = Math.sqrt(3);
const L = 4;                                    // low-res field scale

// How the house on hex (q, r) sits, in units of the hex size: its turn, half-length and half-depth,
// and where its chimney is (t along the ridge, and dx, dy from the hex centre). The painter draws
// it from this and the game puts the chimney smoke there, so both agree.
export function houseLayout(q, r) {
  const h = (n) => hash(q * 3 + 11, r * 5 + 7, n);
  const ang = (h(71) - 0.5) * 0.9 + (h(72) < 0.35 ? Math.PI / 2 : 0);
  const w = 0.6 + h(73) * 0.12, d = 0.36 + h(74) * 0.08;
  const t = (h(75) < 0.5 ? -1 : 1) * (0.35 + h(76) * 0.35), off = -0.28;
  const lx = t * w, ly = off * d;
  return { ang, w, d, t, off, dx: lx * Math.cos(ang) - ly * Math.sin(ang), dy: lx * Math.sin(ang) + ly * Math.cos(ang), thatch: h(77) < 0.4 };
}

// The buildings a set of cells makes. House hexes next to each other join up: three that all touch
// become a manor, two a long hall, the rest stand alone. Each building is
//   { cells, kind: 'house' | 'hall' | 'manor', ang, w, d, thatch, chim: [{t, off, dx, dy}] }
// with sizes in units of the hex size and the chimneys given from the building's middle (the
// average of its hexes' centres). Deterministic, so the painter and the smoke agree.
export function buildings(cellList) {
  const houses = cellList.filter((c) => c.t === 'house').sort((x, y) => x.r - y.r || x.q - y.q);
  const at = new Map(houses.map((c) => [key(c.q, c.r), c])), used = new Set(), out = [];
  const N = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const free = (c) => N.map(([dq, dr]) => at.get(key(c.q + dq, c.r + dr))).filter((n) => n && !used.has(n));
  const px = (c) => [Math.sqrt(3) * (c.q + c.r / 2), 1.5 * c.r];
  const chimney = (ang, w, d, t, off) => { const lx = t * w, ly = off * d; return { t, off, dx: lx * Math.cos(ang) - ly * Math.sin(ang), dy: lx * Math.sin(ang) + ly * Math.cos(ang) }; };
  for (const c of houses) {                              // manors first
    if (used.has(c)) continue;
    const nb = free(c);
    let trio = null;
    for (const x of nb) for (const y of nb) if (x !== y && dist(x, y) === 1) trio = trio || [c, x, y];
    if (!trio) continue;
    trio.forEach((x) => used.add(x));
    const h = (n) => hash(c.q * 3 + 11, c.r * 5 + 7, n), ang = (h(81) - 0.5) * 0.5, w = 1.02 + h(82) * 0.1, d = 0.86 + h(83) * 0.08;
    out.push({ cells: trio, kind: 'manor', ang, w, d, thatch: false, chim: [chimney(ang, w, d, h(84) < 0.5 ? -0.45 : 0.45, -0.45)] });
  }
  for (const c of houses) {                              // then halls
    if (used.has(c)) continue;
    const n = free(c)[0];
    if (!n) continue;
    used.add(c); used.add(n);
    const [x0, y0] = px(c), [x1, y1] = px(n), h = (k) => hash(c.q * 3 + 11, c.r * 5 + 7, k);
    let ang = Math.atan2(y1 - y0, x1 - x0);
    if (ang > Math.PI / 2 || ang <= -Math.PI / 2) ang += Math.PI * (ang > 0 ? -1 : 1);     // keep the lit slope on top
    const w = 1.36 + h(85) * 0.08, d = 0.46 + h(86) * 0.07;
    out.push({ cells: [c, n], kind: 'hall', ang, w, d, thatch: h(87) < 0.35, chim: [chimney(ang, w, d, -0.6, -0.3), chimney(ang, w, d, 0.55, -0.3)] });
  }
  for (const c of houses) {                              // the rest stand alone
    if (used.has(c)) continue;
    const lay = houseLayout(c.q, c.r);
    out.push({ cells: [c], kind: 'house', ang: lay.ang, w: lay.w, d: lay.d, thatch: lay.thatch, chim: [{ t: lay.t, off: lay.off, dx: lay.dx, dy: lay.dy }] });
  }
  return out;
}

function hash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, oct) {
  let v = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { v += amp * vnoise(x * f, y * f, s + i * 17); n += amp; amp *= 0.5; f *= 2; }
  return v / n;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function blur(f, w, h, radius, passes = 2) {
  const r = Math.max(1, Math.round(radius)), tmp = new Float32Array(f.length), n = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {                       // horizontal
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += f[y * w + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / n;
        acc += f[y * w + clamp(x + r + 1, 0, w - 1)] - f[y * w + clamp(x - r, 0, w - 1)];
      }
    }
    for (let x = 0; x < w; x++) {                       // vertical
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        f[y * w + x] = acc / n;
        acc += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
      }
    }
  }
  return f;
}

export function paintBackdrop(map, { hexPx = 140, seed = 7, biome = 'meadow' } = {}) {
  const snow = biome === 'snow', desert = biome === 'desert', cave = biome === 'cave';
  const SOLID = { t: 'rock', e: 0 };
  const s = hexPx / R3;                                 // hex "size" (centre to corner) in pixels
  const cells = Object.values(map.cells);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const c of cells) {
    const x = hexPx * (c.q + c.r / 2), y = 1.5 * s * c.r;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const margin = hexPx * 0.9;
  const W = Math.ceil(x1 - x0 + hexPx + 2 * margin), H = Math.ceil(y1 - y0 + 2 * s + 2 * margin);
  const ox = margin + hexPx / 2 - x0, oy = margin + s - y0;      // image position of hex 0,0
  const centre = (c) => [ox + hexPx * (c.q + c.r / 2), oy + 1.5 * s * c.r];
  const hexOf = (X, Y) => { const r = (Y - oy) / (1.5 * s); return hexRound((X - ox) / hexPx - r / 2, r); };
  // Off the board, continue whatever the nearest hex has so the picture has no hard edge.
  const near = [];
  for (let dq = -3; dq <= 3; dq++) for (let dr = -3; dr <= 3; dr++) {
    const d = dist({ q: dq, r: dr }, { q: 0, r: 0 });
    if (d > 0 && d <= 3) near.push([d, dq, dr]);
  }
  near.sort((a, b) => a[0] - b[0]);
  const cellNear = (h) => {
    const c = map.cells[key(h.q, h.r)];
    if (c) return c;
    for (const [, dq, dr] of near) { const n = map.cells[key(h.q + dq, h.r + dr)]; if (n) return n; }
    return null;
  };

  // ---- Stage 1: low-res fields ----
  const lw = Math.ceil(W / L) + 2, lh = Math.ceil(H / L) + 2, N = lw * lh;
  const fWater = new Float32Array(N), fForest = new Float32Array(N), fRuins = new Float32Array(N);
  const fRock = new Float32Array(N), fElev = new Float32Array(N), fLava = new Float32Array(N);
  for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
    const X = i * L, Y = j * L;
    const wx = X + (fbm(X / (s * 1.1), Y / (s * 1.1), seed + 1, 3) - 0.5) * s * 1.0;
    const wy = Y + (fbm(X / (s * 1.1), Y / (s * 1.1), seed + 2, 3) - 0.5) * s * 1.0;
    const hw = hexOf(wx, wy);
    const c = cave && !map.cells[key(hw.q, hw.r)] ? SOLID : cellNear(hw);   // a cave is solid stone beyond its edge
    if (!c) continue;
    const k = j * lw + i;
    fElev[k] = c.e;
    if (c.t === 'water') fWater[k] = 1;
    else if (c.t === 'forest') fForest[k] = 1;
    else if (c.t === 'ruins') fRuins[k] = 1;
    else if (c.t === 'rock') fRock[k] = 1;
    else if (c.t === 'lava') fLava[k] = 1;
  }
  const fHeat = blur(Float32Array.from(fLava), lw, lh, (s * 0.75) / L);      // the glow lava throws on what is around it
  blur(fLava, lw, lh, (s * 0.13) / L);
  const fDepth = blur(Float32Array.from(fWater), lw, lh, (s * 0.5) / L);
  blur(fWater, lw, lh, (s * 0.14) / L);
  blur(fForest, lw, lh, (s * 0.24) / L);
  blur(fRuins, lw, lh, (s * 0.1) / L);
  blur(fRock, lw, lh, (s * 0.2) / L);
  blur(fElev, lw, lh, (s * 0.22) / L);
  // Height with gentle undulation, then its slope (in levels per hex size) for hill shading.
  const fH = new Float32Array(N), fGx = new Float32Array(N), fGy = new Float32Array(N);
  for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
    const k = j * lw + i;
    const und = (fbm((i * L) / (s * 2.2), (j * L) / (s * 2.2), seed + 5, 4) - 0.5) * 0.7;
    fH[k] = fElev[k] + und * (1 - fDepth[k]);
  }
  for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
    const k = j * lw + i;
    fGx[k] = ((fH[j * lw + Math.min(i + 1, lw - 1)] - fH[j * lw + Math.max(i - 1, 0)]) / (2 * L)) * s;
    fGy[k] = ((fH[Math.min(j + 1, lh - 1) * lw + i] - fH[Math.max(j - 1, 0) * lw + i]) / (2 * L)) * s;
  }

  // ---- Stage 2: per-pixel shading ----
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(W, H), px = image.data;
  const cos = Math.cos(0.21), sin = Math.sin(0.21), tile = s * 0.36;
  for (let Y = 0; Y < H; Y++) {
    const fy = Y / L, j0 = Math.floor(fy), ty = fy - j0;
    for (let X = 0; X < W; X++) {
      const fx = X / L, i0 = Math.floor(fx), tx = fx - i0;
      const a = j0 * lw + i0, b = a + 1, c = a + lw, d = c + 1;
      const wa = (1 - tx) * (1 - ty), wb = tx * (1 - ty), wc = (1 - tx) * ty, wd = tx * ty;
      const S = (f) => f[a] * wa + f[b] * wb + f[c] * wc + f[d] * wd;

      const n1 = fbm(X / (s * 1.7), Y / (s * 1.7), seed + 10, 4);
      const n2 = fbm(X / (s * 0.28), Y / (s * 0.28), seed + 11, 3);
      const elev = S(fElev), forest = S(fForest), rock = S(fRock), ruins = S(fRuins), water = S(fWater);

      // Grass, drier and paler with height.
      let t = sstep(0.3, 0.7, n1);
      let r = 70 + 36 * t, g = 110 + 32 * t, bl = 50 + 12 * t;
      t = clamp((n2 - 0.45) * 1.4, 0, 1) * 0.55;
      r += (146 - r) * t; g += (164 - g) * t; bl += (80 - bl) * t;
      t = Math.min(1, elev / 3) * 0.5;
      r += (170 - r) * t; g += (168 - g) * t; bl += (104 - bl) * t;
      if (desert) {                                         // sand with wind ripples, redder sandstone with height
        t = sstep(0.3, 0.7, n1);
        r = 216 + 16 * t; g = 184 + 14 * t; bl = 130 + 14 * t;
        const ripple = Math.sin((X * 0.55 + Y) / (s * 0.085) + n1 * 26) * 0.5 + 0.5;
        t = ripple * sstep(0.35, 0.6, n2) * 0.16;
        r -= 60 * t; g -= 58 * t; bl -= 50 * t;
        t = Math.min(1, elev / 2.5) * 0.62;
        r += (204 - r) * t; g += (132 - g) * t; bl += (92 - bl) * t;
      }
      if (cave) {                                           // worn stone floor, a little warmer on raised ground
        t = sstep(0.3, 0.7, n1);
        r = 104 + 20 * t; g = 97 + 18 * t; bl = 94 + 14 * t;
        t = clamp((n2 - 0.42) * 1.6, 0, 1) * 0.4;
        r += (72 - r) * t; g += (68 - g) * t; bl += (70 - bl) * t;
        t = Math.min(1, elev / 3) * 0.45;
        r += (150 - r) * t; g += (132 - g) * t; bl += (108 - bl) * t;
      }
      // Forest floor.
      t = forest * 0.82;
      if (cave) { r += (50 - r) * t; g += (84 - g) * t; bl += (92 - bl) * t; }      // damp, faintly lit by the fungus
      else if (desert) { r += (128 - r) * t; g += (134 - g) * t; bl += (70 - bl) * t; }
      else { r += (46 - r) * t; g += (76 - g) * t; bl += (40 - bl) * t; }
      // Bare stony ground around boulders.
      t = sstep(0.25, 0.7, rock) * 0.85;
      const m = 0.82 + 0.36 * n2;
      if (cave) {                                           // the wall: a pale lit rim, then darkness
        const deep = sstep(0.46, 0.72, rock), lit = sstep(0.22, 0.46, rock);
        const wr = 150 * m + (22 - 150 * m) * deep, wg = 136 * m + (20 - 136 * m) * deep, wb = 120 * m + (28 - 120 * m) * deep;
        r += (wr - r) * lit; g += (wg - g) * lit; bl += (wb - bl) * lit;
        if (deep > 0.6) { const vein = sstep(0.62, 0.7, fbm(X / (s * 0.5), Y / (s * 0.9), seed + 50, 3)) * 14; r += vein; g += vein; bl += vein * 1.3; }
      } else if (desert) { r += (158 * m - r) * t; g += (106 * m - g) * t; bl += (76 * m - bl) * t; }
      else { r += (132 * m - r) * t; g += (127 * m - g) * t; bl += (116 * m - bl) * t; }
      // Flagstones.
      t = sstep(0.4, 0.6, ruins);
      if (t > 0) {
        const u = (X * cos + Y * sin) / tile, iu = Math.floor(u);
        const v = (Y * cos - X * sin) / (tile * 0.7) + (iu & 1) * 0.5, iv = Math.floor(v);
        const fu = u - iu, fv = v - iv;
        const edge = Math.min(fu, 1 - fu, (fv < 1 - fv ? fv : 1 - fv) * 0.7);
        const tone = 0.8 + 0.3 * hash(iu, iv, seed + 30);
        let sr = 170 * tone, sg = 162 * tone, sb = 142 * tone;
        if (edge < 0.07) { sr = 92; sg = 88; sb = 76; }
        const moss = sstep(0.58, 0.72, n2) * 0.6;
        if (cave) { sr *= 0.74; sg *= 0.74; sb *= 0.78; }
        else if (desert) { sr = sr * 1.12 + 14; sg = sg * 1.02; sb = sb * 0.84; sr += (222 - sr) * moss; sg += (190 - sg) * moss; sb += (136 - sb) * moss; }   // drifted sand
        else { sr += (96 - sr) * moss; sg += (124 - sg) * moss; sb += (64 - sb) * moss; }
        r += (sr - r) * t; g += (sg - g) * t; bl += (sb - bl) * t;
      }
      if (snow) {
        const lum = (r * 0.3 + g * 0.6 + bl * 0.1) / 150;
        const keep = Math.max(sstep(0.4, 0.6, ruins) * 0.6, sstep(0.25, 0.7, rock) * 0.45);
        const sr = 204 + 36 * lum - forest * 42, sg = 214 + 32 * lum - forest * 32, sb = 228 + 24 * lum - forest * 14;
        r += (sr - r) * (1 - keep); g += (sg - g) * (1 - keep); bl += (sb - bl) * (1 - keep);
      }
      // Hills: light from the north-west, bare earth and rock where it gets steep.
      const gx = S(fGx), gy = S(fGy), steep = Math.hypot(gx, gy);
      t = sstep(1.5, 2.9, steep) * (1 - sstep(0.4, 0.6, ruins));
      if (t > 0) {
        const strata = 0.5 + 0.5 * Math.sin(S(fH) * 13 + n2 * 5);
        let er = snow ? 128 - 36 * strata : 132 - 34 * strata, eg = snow ? 130 - 34 * strata : 112 - 28 * strata, eb = snow ? 138 - 30 * strata : 86 - 22 * strata;
        if (desert) { er = 188 - 58 * strata; eg = 102 - 40 * strata; eb = 66 - 26 * strata; }      // banded red rock
        if (cave) { er = 92 - 34 * strata; eg = 82 - 30 * strata; eb = 76 - 24 * strata; }
        r += (er - r) * t; g += (eg - g) * t; bl += (eb - bl) * t;
      }
      let shade = 1 + clamp((gx + gy) * 0.16, -0.3, 0.3);
      // A fine contour line where the ground crosses each half level, so slopes read as terraces.
      if (steep > 0.55) {
        const hgt = S(fH) - 0.5, off = Math.abs(hgt - Math.round(hgt));
        shade *= 1 - 0.3 * (1 - sstep(0, (steep / s) * 2.2, off));
      }
      r *= shade; g *= shade; bl *= shade;
      if (snow && shade < 1) bl += (1 - shade) * 46;       // snow shadows lean blue

      // Water: muddy bank, foam at the edge, deeper blue toward the middle.
      if (water > 0.5) {
        const depth = sstep(0.4, 0.92, S(fDepth));
        let wr = 104 - 66 * depth, wg = 176 - 78 * depth, wb = 170 - 22 * depth;
        if (snow) { wr = 176 - 78 * depth; wg = 208 - 62 * depth; wb = 224 - 40 * depth; }     // frozen over
        if (desert) { wr = 96 - 70 * depth; wg = 204 - 74 * depth; wb = 190 - 40 * depth; }    // clear oasis water
        if (cave) { wr = 34 - 22 * depth; wg = 118 - 72 * depth; wb = 132 - 62 * depth; }      // a still, dark pool
        const rip = fbm(X / (s * 0.16), Y / (s * 0.7), seed + 20, 3);
        if (rip > 0.58) { const hl = (rip - 0.58) * 150; wr += hl; wg += hl; wb += hl; }
        const foam = (1 - sstep(0.5, 0.62, water)) * (0.35 + 0.65 * n2) * (cave ? 0.35 : 1);
        wr += (236 - wr) * foam; wg += (246 - wg) * foam; wb += (240 - wb) * foam;
        r = wr; g = wg; bl = wb;
      } else if (water > 0.26) {
        t = sstep(0.26, 0.5, water) * 0.88;
        if (snow) { r += (196 - r) * t; g += (212 - g) * t; bl += (228 - bl) * t; }
        else if (cave) { r += (58 - r) * t; g += (66 - g) * t; bl += (70 - bl) * t; }
        else if (desert) { r += (150 - r) * t; g += (140 - g) * t; bl += (84 - bl) * t; }       // damp, greener bank
        else { r += (142 - r) * t; g += (126 - g) * t; bl += (90 - bl) * t; }
      }

      // Lava: a bright, slowly flowing core under plates of dark crust, and an orange glow on its banks.
      const lava = S(fLava);
      if (lava > 0.5) {
        const core = sstep(0.5, 0.9, lava);
        const flow = fbm(X / (s * 0.55), Y / (s * 0.22), seed + 60, 4), plates = fbm(X / (s * 0.21), Y / (s * 0.21), seed + 61, 3);
        let lr = 255, lg = 96 + 150 * flow * core, lb = 16 + 90 * flow * flow * core;
        const crust = sstep(0.5, 0.6, plates) * (1 - 0.45 * core) + (1 - core) * 0.35;
        t = clamp(crust, 0, 1);
        lr += (74 - lr) * t; lg += (26 - lg) * t; lb += (18 - lb) * t;
        const seam = 1 - sstep(0, 0.035, Math.abs(plates - 0.5));          // glowing cracks between the plates
        lr += (255 - lr) * seam * 0.8; lg += (214 - lg) * seam * 0.8; lb += (110 - lb) * seam * 0.6;
        r = lr; g = lg; bl = lb;
      } else {
        t = clamp(S(fHeat) * 1.5, 0, 1) * (lava > 0.3 ? 1 : 0.8);
        if (t > 0.01) { r += (255 - r) * t * 0.5; g += (112 - g) * t * 0.36; bl += (24 - bl) * t * 0.3; }
        if (lava > 0.3) { t = sstep(0.3, 0.5, lava); r += (40 - r) * t * 0.7; g += (20 - g) * t * 0.7; bl += (16 - bl) * t * 0.7; }   // scorched rim
      }

      const grain = (hash(X, Y, seed + 40) - 0.5) * 13;
      const edgeDist = Math.max(Math.abs(X / W - 0.5), Math.abs(Y / H - 0.5)) * 2;
      const vig = 1 - sstep(0.78, 1, edgeDist) * (cave ? 0.5 : 0.28);
      const o = (Y * W + X) * 4;
      px[o] = (r + grain) * vig; px[o + 1] = (g + grain) * vig; px[o + 2] = (bl + grain) * vig; px[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  // ---- Stage 3: objects ----
  let rs = (seed * 2654435761) >>> 0;
  const rnd = () => { rs = (rs + 0x6D2B79F5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const sorted = [...cells].sort((p, q) => p.r - q.r || p.q - q.q);
  const blob = (cx, cy, rad, n, wobble) => {            // irregular closed polygon
    const pts = [], a0 = rnd() * 6.28;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * 6.283, rr = rad * (1 - wobble + rnd() * wobble * 2);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.92]);
    }
    return pts;
  };
  const poly = (pts, dx = 0, dy = 0) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)));
    ctx.closePath();
  };
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // Roads: a trodden track from each road hex to the road hexes next to it, onto a bridge (ruins by water), and up to a house's door.
  {
    const N = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    const segs = [], seen = new Set();
    for (const c of sorted) {
      if (c.t !== 'road') continue;
      for (const [dq, dr] of N) {
        const n = map.cells[key(c.q + dq, c.r + dr)];
        if (!n || (n.t !== 'road' && n.t !== 'ruins' && n.t !== 'house')) continue;
        // Ruins count only as a bridge (next to water); a house gets one path, from the first road hex that reaches it.
        if (n.t === 'ruins' && !N.some(([aq, ar]) => map.cells[key(n.q + aq, n.r + ar)]?.t === 'water')) continue;
        const id = n.t === 'road' ? [key(c.q, c.r), key(n.q, n.r)].sort().join('|') : '>' + key(n.q, n.r);
        if (seen.has(id)) continue;
        seen.add(id);
        const [x0, y0] = centre(c), [x1, y1] = centre(n), bend = (hash(c.q + n.q, c.r + n.r, seed + 90) - 0.5) * s * 0.5;
        segs.push([x0, y0, x1, y1, (x0 + x1) / 2 - (y1 - y0) / (s * 1.73) * bend, (y0 + y1) / 2 + (x1 - x0) / (s * 1.73) * bend]);
      }
      if (!segs.some((g0) => g0[0] === centre(c)[0] && g0[1] === centre(c)[1])) { const [x, y] = centre(c); segs.push([x, y, x + 0.01, y, x, y]); }   // a lone road hex
    }
    const dirt = snow ? ['rgba(150,160,176,', 'rgba(196,204,216,'] : desert ? ['rgba(168,132,90,', 'rgba(232,206,160,'] : cave ? ['rgba(48,44,42,', 'rgba(104,96,88,'] : ['rgba(104,84,52,', 'rgba(176,148,104,'];
    for (const [col, width, alpha] of [[dirt[0], 0.62, 0.3], [dirt[0], 0.46, 0.5], [dirt[1], 0.3, 0.75]]) {
      ctx.strokeStyle = col + alpha + ')'; ctx.lineWidth = s * width;
      for (const [x0, y0, x1, y1, mx, my] of segs) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke(); }
    }
    ctx.strokeStyle = 'rgba(40,28,14,0.22)'; ctx.lineWidth = 1.2;                                     // cart ruts
    for (const [x0, y0, x1, y1, mx, my] of segs) for (const off of [-0.07, 0.07]) {
      const nx = -(y1 - y0), ny = x1 - x0, nl = Math.hypot(nx, ny) || 1, ox = nx / nl * s * off, oy = ny / nl * s * off;
      ctx.beginPath(); ctx.moveTo(x0 + ox, y0 + oy); ctx.quadraticCurveTo(mx + ox, my + oy, x1 + ox, y1 + oy); ctx.stroke();
    }
  }

  // Meadow details: grass tufts, a few flowers.
  for (const c of sorted) {
    if (c.t !== 'grass' || snow) continue;
    const [cx, cy] = centre(c);
    if (cave) {                                         // loose stones
      for (let i = 0; i < 4; i++) {
        const x = cx + (rnd() - 0.5) * hexPx, y = cy + (rnd() - 0.5) * s * 1.6, pr = 1.4 + rnd() * 2.6;
        ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.arc(x + 1.2, y + 1.5, pr, 0, 6.3); ctx.fill();
        ctx.fillStyle = rnd() < 0.5 ? '#8f877d' : '#6d665f'; ctx.beginPath(); ctx.arc(x, y, pr, 0, 6.3); ctx.fill();
      }
      continue;
    }
    if (desert) {                                       // pebbles and the odd dry shrub
      for (let i = 0; i < 5; i++) {
        const x = cx + (rnd() - 0.5) * hexPx, y = cy + (rnd() - 0.5) * s * 1.6, pr = 1.2 + rnd() * 2.2;
        ctx.fillStyle = 'rgba(60,34,18,0.3)'; ctx.beginPath(); ctx.arc(x + 1, y + 1.2, pr, 0, 6.3); ctx.fill();
        ctx.fillStyle = rnd() < 0.5 ? '#c79a70' : '#a8744e'; ctx.beginPath(); ctx.arc(x, y, pr, 0, 6.3); ctx.fill();
      }
      if (rnd() < 0.22) {
        const x = cx + (rnd() - 0.5) * hexPx * 0.6, y = cy + (rnd() - 0.5) * s, n = 9;
        ctx.strokeStyle = 'rgba(40,24,10,0.3)'; ctx.lineWidth = 2;
        for (let i = 0; i < n; i++) { const a = (i / n) * 6.283 + rnd() * 0.4, l = s * (0.07 + rnd() * 0.06); ctx.beginPath(); ctx.moveTo(x + 1.5, y + 2); ctx.lineTo(x + 1.5 + Math.cos(a) * l, y + 2 + Math.sin(a) * l); ctx.stroke(); }
        ctx.strokeStyle = '#7d8a4a'; ctx.lineWidth = 1.6;
        for (let i = 0; i < n; i++) { const a = (i / n) * 6.283 + rnd() * 0.4, l = s * (0.07 + rnd() * 0.06); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke(); }
      }
      continue;
    }
    ctx.strokeStyle = 'rgba(38,66,28,0.34)'; ctx.lineWidth = 1.3;
    for (let i = 0; i < 9; i++) {
      const x = cx + (rnd() - 0.5) * hexPx, y = cy + (rnd() - 0.5) * s * 1.6, h = 3 + rnd() * 4;
      ctx.beginPath(); ctx.moveTo(x - 2.5, y - h); ctx.lineTo(x, y); ctx.lineTo(x + 2.5, y - h * 0.9); ctx.stroke();
    }
    if (rnd() < 0.3) {
      const fx = cx + (rnd() - 0.5) * hexPx * 0.6, fy = cy + (rnd() - 0.5) * s, col = ['#f4f0dc', '#f2d95c', '#d9c6f0'][Math.floor(rnd() * 3)];
      for (let i = 0; i < 6; i++) {
        const x = fx + (rnd() - 0.5) * s * 0.5, y = fy + (rnd() - 0.5) * s * 0.4;
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(x + 0.8, y + 1, 2, 0, 6.3); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 1.9, 0, 6.3); ctx.fill();
      }
    }
  }

  // Ruined walls and rubble.
  for (const c of sorted) {
    if (c.t !== 'ruins') continue;
    const [cx, cy] = centre(c);
    for (let i = 0; i < 7; i++) {
      const p = blob(cx + (rnd() - 0.5) * hexPx * 0.8, cy + (rnd() - 0.5) * s * 1.3, s * (0.035 + rnd() * 0.04), 6, 0.3);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; poly(p, 1.5, 2); ctx.fill();
      ctx.fillStyle = cave ? '#7d766b' : desert ? '#c9a57e' : '#a9a18c'; poly(p); ctx.fill();
      ctx.strokeStyle = 'rgba(40,36,28,0.7)'; ctx.lineWidth = 1; ctx.stroke();
    }
    const base = Math.floor(rnd() * 3);
    for (let i = 0, n = 2 + Math.floor(rnd() * 2); i < n; i++) {
      const ang = ((base + i) % 3) * 1.0472 + (rnd() - 0.5) * 0.12;
      const len = s * (0.55 + rnd() * 0.45), th = s * 0.17;
      const wx = cx + (rnd() - 0.5) * s * 0.9, wy = cy + (rnd() - 0.5) * s * 0.8;
      const wall = (dx, dy, fill, stroke) => {
        ctx.save();
        ctx.translate(wx + dx, wy + dy); ctx.rotate(ang);
        ctx.beginPath(); ctx.rect(-len / 2, -th / 2, len, th);
        ctx.fillStyle = fill; ctx.fill();
        if (stroke) {
          ctx.strokeStyle = '#36322a'; ctx.lineWidth = 1.6; ctx.stroke();
          ctx.fillStyle = 'rgba(255,250,232,0.3)'; ctx.fillRect(-len / 2 + 2, -th / 2 + 2, len - 4, th * 0.38);
          ctx.strokeStyle = 'rgba(54,50,42,0.6)'; ctx.lineWidth = 1;
          for (let x = -len / 2 + th * (0.7 + rnd() * 0.4); x < len / 2 - 3; x += th * (0.9 + rnd() * 0.5)) {
            ctx.beginPath(); ctx.moveTo(x, -th / 2); ctx.lineTo(x, th / 2); ctx.stroke();
          }
        }
        ctx.restore();
      };
      wall(s * 0.075, s * 0.095, 'rgba(0,0,0,0.42)', false);
      wall(0, 0, cave ? '#8a8376' : desert ? '#d2ad84' : '#b3ab95', true);
    }
  }

  // Boulders.
  for (const c of sorted) {
    if (c.t !== 'rock' || cave) continue;               // cave rock is painted as solid wall instead
    const [cx, cy] = centre(c);
    const stones = [[cx + (rnd() - 0.5) * s * 0.2, cy + (rnd() - 0.5) * s * 0.2, s * 0.52]];
    for (let i = 0; i < 3; i++) {
      const a = rnd() * 6.28;
      stones.push([cx + Math.cos(a) * s * 0.62, cy + Math.sin(a) * s * 0.55, s * (0.14 + rnd() * 0.13)]);
    }
    stones.sort((p, q) => p[1] - q[1]);
    for (const [bx, by, br] of stones) {
      const p = blob(bx, by, br, 9, 0.16);
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; poly(p, br * 0.2, br * 0.26); ctx.fill();
      const grad = ctx.createLinearGradient(bx - br, by - br, bx + br, by + br);
      if (desert) { grad.addColorStop(0, '#edc49a'); grad.addColorStop(0.5, '#b9774c'); grad.addColorStop(1, '#6b3a24'); }
      else { grad.addColorStop(0, '#d6d3c8'); grad.addColorStop(0.5, '#96938b'); grad.addColorStop(1, '#55534f'); }
      poly(p); ctx.fillStyle = grad; ctx.fill();
      ctx.strokeStyle = '#2a2927'; ctx.lineWidth = 1.8; ctx.stroke();
      const top = p.map(([x, y]) => [bx + (x - bx) * 0.58 - br * 0.14, by + (y - by) * 0.58 - br * 0.17]);
      poly(top); ctx.fillStyle = snow ? 'rgba(250,252,255,0.9)' : 'rgba(255,255,255,0.22)'; ctx.fill();
      ctx.strokeStyle = 'rgba(30,30,28,0.35)'; ctx.lineWidth = 1.1;
      for (const i of [1, 4, 7]) { ctx.beginPath(); ctx.moveTo(top[i][0], top[i][1]); ctx.lineTo(p[i][0], p[i][1]); ctx.stroke(); }
    }
  }

  // Stalagmites (standing stones outdoors).
  const spikes = [];
  for (const c of sorted) {
    if (c.t !== 'spikes') continue;
    const [cx, cy] = centre(c);
    for (let i = 0, n = 6 + Math.floor(rnd() * 3); i < n; i++) {
      const a = rnd() * 6.283, d = Math.sqrt(rnd()) * s * 0.6;
      spikes.push([cx + Math.cos(a) * d, cy + s * 0.22 + Math.sin(a) * d * 0.8, s * (i < 3 ? 0.17 + rnd() * 0.07 : 0.09 + rnd() * 0.06)]);
    }
  }
  spikes.sort((a, b) => a[1] - b[1]);
  const stone = cave ? [[226, 214, 196], [128, 116, 104], [52, 46, 44]] : desert ? [[246, 214, 170], [186, 122, 80], [96, 54, 34]] : snow ? [[250, 252, 255], [150, 156, 166], [70, 74, 84]] : [[224, 222, 210], [140, 138, 128], [66, 64, 60]];
  const rgb = (c, k = 1) => `rgb(${c.map((v) => Math.round(Math.min(255, v * k)))})`;
  if (!cave) {
    // Above ground: standing stones. A few upright slabs per hex — taller than wide, with a blunt,
    // uneven top, a lit left face, a darker side and a long shadow.
    for (const [x, y, pr0] of spikes.filter((_, i) => i % 2 === 0)) {
      const w = pr0 * 1.25, h = w * (2.3 + rnd() * 1.1), side = w * 0.55, tilt = (rnd() - 0.5) * w * 0.35;
      const top = y - h, t1 = top + (rnd() - 0.5) * w * 0.3, t2 = top + (rnd() - 0.5) * w * 0.3;
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.beginPath(); ctx.moveTo(x - w * 0.5, y + w * 0.15); ctx.lineTo(x + h * 0.8, y + h * 0.4); ctx.lineTo(x + h * 0.8 + w, y + h * 0.4 - w * 0.4); ctx.lineTo(x + w + side, y - w * 0.2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgb(stone[2], 1.15);                        // the side in shade
      ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w + side, y - side * 0.5); ctx.lineTo(x + w + side + tilt, t2 - side * 0.3); ctx.lineTo(x + w + tilt, t2 + w * 0.25); ctx.closePath(); ctx.fill();
      const face = ctx.createLinearGradient(x - w, top, x + w, y);
      face.addColorStop(0, rgb(stone[0])); face.addColorStop(1, rgb(stone[1]));
      ctx.fillStyle = face;                                       // the broad lit face
      ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x - w * 0.9 + tilt, t1 + w * 0.3); ctx.quadraticCurveTo(x - w * 0.5 + tilt, t1 - w * 0.1, x + tilt, top);
      ctx.quadraticCurveTo(x + w * 0.7 + tilt, top, x + w + tilt, t2 + w * 0.25); ctx.lineTo(x + w, y); ctx.quadraticCurveTo(x, y + w * 0.3, x - w, y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(20,18,14,0.8)'; ctx.lineWidth = 1.2; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.fillStyle = snow ? 'rgba(255,255,255,0.9)' : 'rgba(96,124,64,0.5)';      // snow cap, or moss
      ctx.beginPath(); ctx.moveTo(x - w * 0.9 + tilt, t1 + w * 0.3); ctx.quadraticCurveTo(x - w * 0.5 + tilt, t1 - w * 0.1, x + tilt, top); ctx.quadraticCurveTo(x + w * 0.7 + tilt, top, x + w + tilt, t2 + w * 0.25);
      ctx.quadraticCurveTo(x + tilt, top + w * 0.7, x - w * 0.9 + tilt, t1 + w * 0.3); ctx.fill();
      ctx.strokeStyle = 'rgba(20,18,14,0.3)'; ctx.lineWidth = 1;   // a crack or two
      ctx.beginPath(); ctx.moveTo(x - w * 0.2 + tilt * 0.6, top + h * 0.35); ctx.lineTo(x + w * 0.1 + tilt * 0.4, top + h * 0.55); ctx.lineTo(x - w * 0.1, top + h * 0.8); ctx.stroke();
    }
  } else {
  // Each is a tall cone drawn leaning away from the viewer: a lit left face, a dark right face,
  // a sharp tip well above its foot, and a long pointed shadow.
  for (const [x, y, pr] of spikes) {
    const h = pr * (2.6 + rnd() * 1.4), lean = (rnd() - 0.5) * pr * 0.7;
    const tx = x - pr * 0.25 + lean, ty = y - h;                  // the tip
    const lx = x - pr, rx = x + pr, by = y + pr * 0.42;           // foot: left, right, and the front of its curve
    ctx.fillStyle = 'rgba(0,0,0,0.4)';                            // shadow, thrown down-right
    ctx.beginPath(); ctx.moveTo(lx + pr * 0.5, y + pr * 0.3); ctx.lineTo(x + h * 0.85, y + h * 0.42); ctx.lineTo(rx, y - pr * 0.1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgb(stone[2]);                                // dark right face
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(rx, y); ctx.quadraticCurveTo(x + pr * 0.6, by, x - pr * 0.1, by); ctx.closePath(); ctx.fill();
    const lit = ctx.createLinearGradient(tx, ty, lx, by);         // lit left face, paler toward the tip
    lit.addColorStop(0, rgb(stone[0])); lit.addColorStop(1, rgb(stone[1]));
    ctx.fillStyle = lit;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x - pr * 0.1, by); ctx.quadraticCurveTo(x - pr * 0.7, by, lx, y); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(20,16,14,0.8)'; ctx.lineWidth = 1.2; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(tx, ty); ctx.lineTo(rx, y); ctx.quadraticCurveTo(x + pr * 0.6, by, x - pr * 0.1, by); ctx.quadraticCurveTo(x - pr * 0.7, by, lx, y); ctx.stroke();
    ctx.strokeStyle = 'rgba(20,16,14,0.35)'; ctx.lineWidth = 1;   // the ridge between the faces, and a few rings
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x - pr * 0.1, by); ctx.stroke();
    for (const f of [0.45, 0.72]) {
      const ax = tx + (lx - tx) * f, ay = ty + (y - ty) * f, mx = tx + (x - pr * 0.1 - tx) * f, my = ty + (by - ty) * f;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + mx) / 2, my + pr * 0.08, mx, my); ctx.stroke();
    }
  }

  }

  // Buildings, seen from above: a pitched roof (one slope lit, one in shade), a ridge, chimneys,
  // and a trodden yard. Tiled or thatched in a meadow, snow-covered in winter, flat-roofed adobe
  // in the desert, stone in a cave. Halls are long, manors have a hipped roof and a porch.
  for (const b of buildings(sorted)) {
    let cx = 0, cy = 0;
    for (const c of b.cells) { const [x, y] = centre(c); cx += x / b.cells.length; cy += y / b.cells.length; }
    const w = b.w * s, d = b.d * s, reach = Math.max(w, d) + s * 0.4;
    const yard = ctx.createRadialGradient(cx, cy, reach * 0.3, cx, cy, reach);
    yard.addColorStop(0, snow ? 'rgba(150,160,175,0.45)' : cave ? 'rgba(60,54,50,0.5)' : 'rgba(124,98,62,0.55)'); yard.addColorStop(1, 'rgba(124,98,62,0)');
    ctx.fillStyle = yard; ctx.beginPath(); ctx.arc(cx, cy, reach, 0, 6.3); ctx.fill();
    const roof = snow ? ['#f6f9fd', '#c2ccdb', '#8b97aa'] : desert ? ['#e2c596', '#cfae7c', '#9c7d52'] : cave ? ['#8a857f', '#57534f', '#3a3734']
      : b.thatch ? ['#d2b56a', '#9a7d3c', '#6d5626'] : b.kind === 'manor' ? ['#8f9aa6', '#5c6672', '#3c444e'] : ['#c06f45', '#853f27', '#5e2a1a'];
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(b.ang);
    const sh = b.kind === 'manor' ? 1.5 : 1;                                                           // taller buildings throw longer shadows
    const sx = sh * (s * 0.1 * Math.cos(-b.ang) - s * 0.14 * Math.sin(-b.ang)), sy = sh * (s * 0.1 * Math.sin(-b.ang) + s * 0.14 * Math.cos(-b.ang));
    ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fillRect(-w + sx, -d + sy, 2 * w, 2 * d);                 // shadow
    ctx.fillStyle = snow ? '#6f5a48' : desert ? '#b8935f' : cave ? '#2c2a28' : '#e9dcc0';             // walls showing under the eaves
    ctx.fillRect(-w - s * 0.035, -d - s * 0.035, 2 * w + s * 0.07, 2 * d + s * 0.07);
    const P = (pts, fill) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
    if (desert) {                                                                                     // flat roof with a parapet
      ctx.fillStyle = roof[1]; ctx.fillRect(-w, -d, 2 * w, 2 * d);
      ctx.fillStyle = roof[0]; ctx.fillRect(-w + s * 0.07, -d + s * 0.07, 2 * w - s * 0.14, 2 * d - s * 0.14);
      ctx.fillStyle = 'rgba(60,40,20,0.5)'; ctx.fillRect(w * 0.25, -d * 0.45, s * 0.14, s * 0.14);      // roof hatch
    } else if (b.kind === 'manor') {                                                                  // hipped: four slopes meeting at a short ridge
      const rx = Math.max(0, w - d);
      P([[-w, -d], [w, -d], [rx, 0], [-rx, 0]], roof[0]);
      P([[-w, d], [w, d], [rx, 0], [-rx, 0]], roof[1]);
      P([[-w, -d], [-rx, 0], [-w, d]], snow ? '#dfe6f0' : cave ? '#726d68' : '#788490');
      P([[w, -d], [rx, 0], [w, d]], roof[2]);
      ctx.strokeStyle = 'rgba(20,24,30,0.3)'; ctx.lineWidth = 1;
      for (let i = 1; i < 5; i++) { const k = i / 5; ctx.strokeRect(-w * k - rx * (1 - k), -d * k, 2 * (w * k + rx * (1 - k)), 2 * d * k); }
      ctx.strokeStyle = 'rgba(16,18,22,0.75)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-w, -d); ctx.lineTo(-rx, 0); ctx.lineTo(-w, d); ctx.moveTo(w, -d); ctx.lineTo(rx, 0); ctx.lineTo(w, d); ctx.moveTo(-rx, 0); ctx.lineTo(rx, 0); ctx.stroke();
      ctx.fillStyle = snow ? '#6f5a48' : '#d9ccb0'; ctx.fillRect(-s * 0.22, d, s * 0.44, s * 0.2);      // porch
      ctx.fillStyle = roof[1]; ctx.fillRect(-s * 0.26, d + s * 0.06, s * 0.52, s * 0.16);
      ctx.strokeStyle = 'rgba(16,18,22,0.75)'; ctx.lineWidth = 1.2; ctx.strokeRect(-s * 0.26, d + s * 0.06, s * 0.52, s * 0.16);
    } else {
      ctx.fillStyle = roof[0]; ctx.fillRect(-w, -d, 2 * w, d);                                         // lit slope
      ctx.fillStyle = roof[1]; ctx.fillRect(-w, 0, 2 * w, d);                                          // shaded slope
      ctx.strokeStyle = 'rgba(30,18,10,0.28)'; ctx.lineWidth = 1;                                      // courses of tile or thatch
      for (let i = 1; i < 4; i++) for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(-w, side * d * i / 4); ctx.lineTo(w, side * d * i / 4); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(30,18,10,0.14)';
      for (let x = -w + s * 0.08; x < w; x += s * 0.085) { ctx.beginPath(); ctx.moveTo(x, -d); ctx.lineTo(x, d); ctx.stroke(); }
      ctx.strokeStyle = roof[2]; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-w, 0); ctx.lineTo(w, 0); ctx.stroke();   // ridge
      if (b.kind === 'hall') {                                                                         // a cross-gable breaks up the long roof
        const gx = w * 0.12, gw = s * 0.34;
        P([[gx - gw, d + s * 0.2], [gx, 0], [gx + gw, d + s * 0.2]], roof[1]);
        P([[gx - gw, d + s * 0.2], [gx, 0], [gx, d + s * 0.2]], roof[0]);
        ctx.strokeStyle = 'rgba(24,16,10,0.85)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(gx - gw, d); ctx.lineTo(gx - gw, d + s * 0.2); ctx.lineTo(gx + gw, d + s * 0.2); ctx.lineTo(gx + gw, d); ctx.moveTo(gx, 0); ctx.lineTo(gx, d + s * 0.2); ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(24,16,10,0.85)'; ctx.lineWidth = 1.4; ctx.strokeRect(-w, -d, 2 * w, 2 * d);
    for (const ch of b.chim) {
      const cs = s * (b.kind === 'house' ? 0.075 : 0.09), chx = ch.t * w, chy = ch.off * d;
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(chx - cs + sx * 0.5, chy - cs + sy * 0.5, 2 * cs, 2 * cs);
      ctx.fillStyle = desert ? '#8f6e44' : '#6b5a52'; ctx.fillRect(chx - cs, chy - cs, 2 * cs, 2 * cs);
      ctx.fillStyle = '#1c1512'; ctx.fillRect(chx - cs * 0.5, chy - cs * 0.5, cs, cs);
      ctx.strokeStyle = 'rgba(20,14,10,0.9)'; ctx.lineWidth = 1; ctx.strokeRect(chx - cs, chy - cs, 2 * cs, 2 * cs);
    }
    ctx.restore();
  }

  // Trees, back to front. A few large crowns per hex with smaller ones in the gaps; each crown
  // is built from overlapping leaf clumps, darkest at the bottom-right and lightest top-left.
  const trees = [];
  for (const c of sorted) {
    if (c.t !== 'forest') continue;
    const [cx, cy] = centre(c);
    const placed = [];
    const place = (rad) => {
      for (let tries = 0; tries < 14; tries++) {
        const a = rnd() * 6.283, d = Math.sqrt(rnd()) * s * 0.7;
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.95;
        if (placed.every((p) => Math.hypot(p[0] - x, p[1] - y) > (p[2] + rad) * 0.6)) {
          placed.push([x, y, rad]);
          trees.push([x, y, rad, rnd(), desert || rnd() < (snow ? 0.62 : 0.24)]);
          return;
        }
      }
    };
    for (let i = 0, n = 3 + (rnd() < 0.5 ? 1 : 0); i < n; i++) place(s * (0.4 + rnd() * 0.14));
    for (let i = 0; i < 4; i++) place(s * (0.2 + rnd() * 0.1));
  }
  trees.sort((p, q) => p[1] - q[1]);
  //           shade      dark       mid        light      highlight
  const LEAF = [
    ['#1c4522', '#2a6630', '#3d873a', '#62a747', '#95ca5e'],
    ['#27501f', '#3c7227', '#58932f', '#82b33f', '#b6d660'],
    ['#153c29', '#1f5837', '#2d7747', '#4b9858', '#80c17c'],
    ['#2c4a1c', '#4a6b22', '#6d8c2c', '#97ab3e', '#c6cf63'],
  ];
  if (snow) {                                           // bare crowns carrying snow
    LEAF.length = 0;
    LEAF.push(['#27362f', '#3a4e45', '#6c867c', '#c6d7dc', '#f7fbfd'], ['#2b3a36', '#42564f', '#7a9189', '#d2e0e4', '#ffffff']);
  }
  const castShadow = (tr) => {
    ctx.shadowColor = 'rgba(4,16,8,0.55)'; ctx.shadowBlur = tr * 0.4;
    ctx.shadowOffsetX = tr * 0.3; ctx.shadowOffsetY = tr * 0.36;
  };
  for (const [x, y, tr, tone, conifer] of trees) {
    if (cave) {                                         // glowing fungus: a soft halo, then the cap
      const cr = tr * 0.62, hue = tone < 0.6 ? [90, 240, 220] : tone < 0.85 ? [170, 130, 255] : [150, 255, 140];
      const halo = ctx.createRadialGradient(x, y, cr * 0.4, x, y, cr * 2.6);
      halo.addColorStop(0, `rgba(${hue},0.34)`); halo.addColorStop(1, `rgba(${hue},0)`);
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, cr * 2.6, 0, 6.3); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(x + cr * 0.22, y + cr * 0.28, cr, 0, 6.3); ctx.fill();
      const cap = ctx.createRadialGradient(x - cr * 0.3, y - cr * 0.3, cr * 0.05, x, y, cr);
      cap.addColorStop(0, '#ffffff'); cap.addColorStop(0.3, `rgb(${hue})`); cap.addColorStop(1, `rgb(${hue.map((v) => Math.round(v * 0.32))})`);
      ctx.fillStyle = cap; ctx.beginPath(); ctx.arc(x, y, cr, 0, 6.3); ctx.fill();
      ctx.strokeStyle = 'rgba(6,20,24,0.8)'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < 4; i++) { const a = rnd() * 6.283, d = rnd() * cr * 0.65; ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, cr * (0.06 + rnd() * 0.07), 0, 6.3); ctx.fill(); }
      continue;
    }
    if (conifer) {
      // Seen from above: stacked, slightly rotated tiers of pointed boughs.
      const points = desert ? 7 + Math.floor(rnd() * 3) : 9 + Math.floor(rnd() * 4), spin = rnd() * 6.28;
      const inner = desert ? 0.2 : 0.6;                 // palms: long thin fronds
      const tiers = desert
        ? [[1.12, '#24481c', '#4c8a2e'], [0.78, '#2f5f22', '#6aa838'], [0.46, '#4a7d2a', '#93c64a'], [0.13, '#5a3d1e', '#9a7242']]
        : snow
        ? [[1, '#12301f', '#1f4d33'], [0.72, '#1a472d', '#3b6f55'], [0.46, '#b9cdd4', '#f1f6f9'], [0.22, '#dfe9ee', '#ffffff']]
        : [[1, '#12301f', '#1b4a2f'], [0.72, '#1a472d', '#27623d'], [0.46, '#235a39', '#35794b'], [0.22, '#2f7046', '#4a9460']];
      tiers.forEach(([k, dark, light], ti) => {
        const star = new Path2D();
        for (let i = 0; i < points * 2; i++) {
          const a = spin + ti * 0.35 + (i / (points * 2)) * 6.283;
          const rr = tr * k * (i % 2 ? inner : 1) * (0.94 + rnd() * 0.12);
          const px2 = x + Math.cos(a) * rr, py2 = y + Math.sin(a) * rr;
          if (i) star.lineTo(px2, py2); else star.moveTo(px2, py2);
        }
        star.closePath();
        ctx.save();
        if (ti === 0) castShadow(tr);
        const grad = ctx.createLinearGradient(x - tr * k, y - tr * k, x + tr * k, y + tr * k);
        grad.addColorStop(0, light); grad.addColorStop(0.65, dark);
        ctx.fillStyle = grad; ctx.fill(star);
        ctx.restore();
        ctx.strokeStyle = 'rgba(6,20,12,0.6)'; ctx.lineWidth = ti ? 1.2 : 2; ctx.stroke(star);
      });
      if (!desert) { ctx.fillStyle = snow ? '#ffffff' : '#6fb07a'; ctx.beginPath(); ctx.arc(x - tr * 0.03, y - tr * 0.04, tr * 0.06, 0, 6.3); ctx.fill(); }
      continue;
    }
    const [shade, dark, mid, light, high] = LEAF[Math.floor(tone * LEAF.length)];
    const crown = new Path2D();
    crown.arc(x, y, tr * 0.74, 0, 6.3);
    for (let i = 0, n = 10 + Math.floor(rnd() * 4), a0 = rnd() * 6.28; i < n; i++) {
      const a = a0 + (i / n) * 6.283 + (rnd() - 0.5) * 0.2, lr = tr * (0.24 + rnd() * 0.12);
      const lx = x + Math.cos(a) * tr * 0.72, ly = y + Math.sin(a) * tr * 0.72;
      crown.moveTo(lx + lr, ly);
      crown.arc(lx, ly, lr, 0, 6.3);
    }
    ctx.save(); castShadow(tr); ctx.fillStyle = shade; ctx.fill(crown); ctx.restore();
    ctx.strokeStyle = 'rgba(8,24,12,0.85)'; ctx.lineWidth = 2.6; ctx.stroke(crown);
    ctx.fillStyle = shade; ctx.fill(crown);
    ctx.save();
    ctx.clip(crown);
    // Each clump is a darker disc with a lighter one nudged toward the light, which reads as a
    // tuft of leaves. Three passes, climbing toward the lit side of the crown.
    const clumps = (count, ox2, oy2, spread, r0, r1, under, over) => {
      for (let i = 0; i < count; i++) {
        const a = rnd() * 6.283, d = Math.sqrt(rnd()) * tr * spread;
        const px2 = x + tr * ox2 + Math.cos(a) * d, py2 = y + tr * oy2 + Math.sin(a) * d, cr = tr * (r0 + rnd() * (r1 - r0));
        ctx.fillStyle = under; ctx.beginPath(); ctx.arc(px2 + cr * 0.14, py2 + cr * 0.18, cr, 0, 6.3); ctx.fill();
        ctx.fillStyle = over; ctx.beginPath(); ctx.arc(px2 - cr * 0.05, py2 - cr * 0.06, cr * 0.88, 0, 6.3); ctx.fill();
      }
    };
    clumps(18, 0, 0, 1.0, 0.2, 0.3, shade, dark);
    clumps(14, -0.1, -0.12, 0.82, 0.17, 0.26, dark, mid);
    clumps(10, -0.22, -0.26, 0.6, 0.14, 0.22, mid, light);
    clumps(5, -0.34, -0.38, 0.36, 0.1, 0.16, light, high);
    ctx.restore();
  }

  return { canvas, hexPx, ox, oy };
}
