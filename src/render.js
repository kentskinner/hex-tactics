// 2.5D canvas renderer: hexes are drawn as prisms, back row first, so height reads naturally.
import { CLASSES, footprint, isBig } from './engine.js';
import { key, DIRS, hexRound } from './hex.js';
import { buildings } from './paint.js';
import { paintedTokens } from './tokens.js';

// Two views share this code. Top-down (flat): undistorted hexes, height shown by shade, a number
// and contour/cliff edges. 2.5D: ground plane squashed vertically and hexes raised by elevation.
const R3 = Math.sqrt(3);
const TOP = {
  grass: ['#6aa84f', '#7fb85a', '#98c466', '#b7cf7a'],
  forest: ['#5b9a48', '#6ca952', '#84b65d', '#a0c06e'],
  ruins: ['#9a9a7c', '#a8a888', '#b6b694', '#c4c4a2'],
  spikes: ['#8d8f86', '#9a9c92', '#a8aa9f', '#b6b8ac'],
  road: ['#b9a070', '#c2aa7c', '#cbb488', '#d4be94'],
  house: ['#b98a5e', '#c2946a', '#cb9e76', '#d4a882'],
  rock: ['#7d8a80', '#8a968b', '#98a397', '#a6b0a3'],
  water: ['#4a93cf', '#4a93cf', '#4a93cf', '#4a93cf'],
  lava: ['#e8641c', '#e8641c', '#e8641c', '#e8641c'],
};
const TEAM = [{ fill: '#3f83e0', dark: '#173763' }, { fill: '#e2574c', dark: '#6e1f1a' }, { fill: '#6fa24a', dark: '#22401a' }];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.flat = true;
    this.grid = 1;            // strength of the hex grid lines, 0..1
    this.overlay = 0.4;       // opacity of the terrain tint drawn over a backdrop image
  }

  // Token art: assets/tokens/<class>.svg is drawn in Blue's colours and recoloured for Red.
  async loadTokens() {
    const RED = { '#5b9bf0': '#f58a7c', '#2f6fd6': '#d2443a', '#173763': '#6e1f1a' };
    const WILD = { '#5b9bf0': '#a9cf7c', '#2f6fd6': '#5f9440', '#173763': '#22401a' };     // neutral monsters: green
    const tokens = {};
    await Promise.all(Object.keys(CLASSES).map(async (cls) => {
      const res = await fetch(`assets/tokens/${cls}.svg`);
      if (!res.ok) return;
      const svg = await res.text();
      tokens[cls] = await Promise.all([svg, svg.replace(/#5b9bf0|#2f6fd6|#173763/g, (c) => RED[c]), svg.replace(/#5b9bf0|#2f6fd6|#173763/g, (c) => WILD[c])].map(async (text) => {
        const img = new Image();
        img.src = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
        await img.decode();
        return img;
      }));
    }));
    this.tokens = tokens;
    this.painted = paintedTokens();                  // top-down painted figures, for the classes that have one
    this.facing = new Map();                         // unit id -> which way it faces on screen (set by the UI as units act)
  }

  layout(map) {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    Object.assign(this, { dpr, w, h, map });
    const SQ = this.sq = this.flat ? 1 : 0.62;     // vertical squash of the ground plane
    // Fit the board's bounding box (any shape), plus `pad` hexes of margin while editing.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of Object.values(map.cells)) {
      const x = R3 * (c.q + c.r / 2), y = 1.5 * c.r * SQ;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const pad = this.pad || 0;
    x0 -= pad * R3; x1 += pad * R3; y0 -= pad * 1.5; y1 += pad * 1.5;
    this.S = Math.min(w / (x1 - x0 + R3 + 0.7), h / (y1 - y0 + 2 * SQ + (this.flat ? 0.6 : 0.42 * 5.2)));
    // Camera: zoom (1 = the whole board fits) and pan (screen pixels). A board of a different size starts fitted.
    const count = Object.keys(map.cells).length;
    if (this.fitted !== undefined && Math.abs(count - this.fitted) > 8) { this.zoom = 1; this.panX = 0; this.panY = 0; }
    this.fitted = count;
    this.zoom = Math.max(1, Math.min(8, this.zoom || 1));
    if (this.zoom === 1) { this.panX = 0; this.panY = 0; }
    this.S *= this.zoom;
    const maxX = this.S * (x1 - x0) / 2, maxY = this.S * (y1 - y0) / 2;      // keep the board's centre on screen
    this.panX = Math.max(-maxX, Math.min(maxX, this.panX || 0));
    this.panY = Math.max(-maxY, Math.min(maxY, this.panY || 0));
    this.EH = this.flat ? 0 : this.S * 0.42;       // pixels per elevation level
    this.ox = w / 2 - this.S * (x0 + x1) / 2 + this.panX;
    this.oy = h / 2 - this.S * (y0 + y1) / 2 + this.EH * 1.4 + this.panY;
    this.rebuild();
  }

  // Zoom by `factor` keeping the screen point (x, y) where it is (default: the middle of the view).
  zoomBy(factor, x = this.w / 2, y = this.h / 2) {
    const z0 = this.zoom || 1, z1 = Math.max(1, Math.min(8, z0 * factor)), f = z1 / z0;
    this.panX = x - this.w / 2 - (x - this.w / 2 - (this.panX || 0)) * f;
    this.panY = y - this.h / 2 - (y - this.h / 2 - (this.panY || 0)) * f;
    this.zoom = z1;
    this.layout(this.map);
  }
  panBy(dx, dy) { this.panX = (this.panX || 0) + dx; this.panY = (this.panY || 0) + dy; this.layout(this.map); }
  fit() { this.zoom = 1; this.panX = 0; this.panY = 0; this.layout(this.map); }

  // Recompute per-cell geometry without re-fitting (used while the editor changes cells).
  rebuild() {
    this.order = Object.values(this.map.cells).sort((a, b) => a.r - b.r || a.q - b.q);
    this.geo = new Map();
    for (const c of this.order) {
      const p = this.pos(c.q, c.r, c.e - (c.t === 'water' ? 0.3 : 0));
      this.geo.set(key(c.q, c.r), { ...p, pts: this.corners(p), drop: (c.e + 1 - (c.t === 'water' ? 0.3 : 0)) * this.EH });
    }
  }

  corners(p) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i + 30);
      pts.push([p.x + this.S * Math.cos(a), p.y + this.S * Math.sin(a) * this.sq]);
    }
    return pts;
  }

  // Top-down only: the hex coordinate under a screen point, whether or not a cell exists there.
  hexAt(x, y) {
    const r = (y - this.oy) / (1.5 * this.S);
    return hexRound((x - this.ox) / (R3 * this.S) - r / 2, r);
  }

  pos(q, r, e = 0) {
    return { x: this.ox + this.S * R3 * (q + r / 2), y: this.oy + this.S * 1.5 * r * this.sq - e * this.EH };
  }

  // Screen point -> {q, r} of the unit or hex top under it (front-most first), or null.
  pick(x, y, state) {
    const S = this.S;
    for (const u of this.flat ? [] : [...state.units].sort((a, b) => b.r - a.r)) {
      const g = this.geo.get(key(u.q, u.r));
      if (Math.abs(x - g.x) < S * 0.32 && y < g.y && y > g.y - S * 1.05) return { q: u.q, r: u.r };
    }
    for (let i = this.order.length - 1; i >= 0; i--) {
      const c = this.order[i];
      this.topPath(this.geo.get(key(c.q, c.r)));
      if (this.ctx.isPointInPath(x * this.dpr, y * this.dpr)) return { q: c.q, r: c.r };
    }
    return null;
  }

  topPath(g) {
    const ctx = this.ctx;
    ctx.beginPath();
    g.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }

  // ui: { reach: Map|null, selected: id|null, targets: Set<id>, hoverTargets: Set<id>,
  //       hover: {q,r}|null, anim: {id,x,y}|null, floats: [{q,r,text,t0}] }
  draw(state, ui) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.lineJoin = 'round';
    const bd = this.flat ? this.backdrop : null;
    if (bd) {
      // backdrop: {img, hexPx, ox, oy} — hexPx is one hex's width in image pixels, and image
      // point (ox, oy) sits under the centre hex.
      const k = (R3 * this.S) / bd.hexPx;
      ctx.drawImage(bd.img, this.ox - bd.ox * k, this.oy - bd.oy * k, bd.img.width * k, bd.img.height * k);
    }
    const byCell = new Map();                        // every hex of every unit's footprint
    for (const u of state.units) for (const c of footprint(u)) byCell.set(key(c.q, c.r), u);

    if (this.flat) {
      for (const c of this.order) this.cell(c, this.geo.get(key(c.q, c.r)));
      this.contours();
    }
    for (const c of this.order) {
      const k = key(c.q, c.r), g = this.geo.get(k), u = byCell.get(k);
      if (!this.flat) this.cell(c, g);
      const fill = (style) => { this.topPath(g); ctx.fillStyle = style; ctx.fill(); };
      const ring = (style, lw) => { this.topPath(g); ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.stroke(); };
      if (ui.reachCells?.has(k)) {
        fill('rgba(90,170,255,0.42)');
        if (ui.zone?.has(k) && !(u && u.id === ui.selected)) {      // moving here ends the move: enemy zone of control
          ctx.save();
          this.topPath(g); ctx.clip();
          ctx.strokeStyle = 'rgba(255,70,50,0.95)'; ctx.lineWidth = 7; ctx.stroke();
          ctx.restore();
        }
      }
      const th = ui.threat?.get(k);
      if (th) fill(th === 'now' ? 'rgba(255,140,0,0.55)' : 'rgba(255,170,40,0.28)');
      const point = ui.objectives?.find((o) => o.q === c.q && o.r === c.r);
      if (point) this.objective(g, point.owner);
      if (ui.scorch?.has(k)) {                       // burn mark left by a fireball
        const rot = ui.scorch.get(k), r = this.S * 1.25;
        ctx.save();
        ctx.translate(g.x, g.y); ctx.scale(1, this.sq); ctx.rotate(rot);
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        grad.addColorStop(0, 'rgba(18,12,8,0.72)'); grad.addColorStop(0.45, 'rgba(30,18,10,0.5)'); grad.addColorStop(1, 'rgba(40,24,12,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        for (let i = 0; i < 14; i++) {               // ragged edge
          const an = (i / 14) * 6.283, rr = r * (0.78 + 0.22 * Math.sin(i * 2.7 + rot * 3));
          if (i) ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); else ctx.moveTo(Math.cos(an) * rr, Math.sin(an) * rr);
        }
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      if (ui.castCells?.has(k)) fill(ui.castColor || 'rgba(255,150,40,0.3)');     // where a spell may be aimed
      if (u && ui.targets.has(u.id)) fill('rgba(255,60,50,0.5)');
      if (u && ui.hoverTargets.has(u.id)) ring('#ff3b30', 2.5);
      if (u && u.id === ui.selected) ring('#ffe14a', 3);
      if (ui.hover && ui.hover.q === c.q && ui.hover.r === c.r) ring('rgba(255,255,255,0.9)', 2);
      if (bd) ctx.globalAlpha = Math.min(1, this.overlay * 1.6);
      if (ctx.globalAlpha > 0.02) this.decor(c, g);
      ctx.globalAlpha = 1;
      if (ui.fogVis && !ui.fogVis.has(k)) fill('rgba(8,12,22,0.56)');     // fog of war: out of sight
      if (u && !isBig(u) && ui.anim?.id !== u.id) this.drawUnit(u, state, ui);
    }
    for (const u of state.units) {                   // big creatures go on top of the ground they cover
      if (isBig(u) && ui.anim?.id !== u.id) this.drawUnit(u, state, ui);
    }
    for (const h of ui.destCells || []) {            // where a big creature would end up
      const g = this.geo.get(key(h.q, h.r));
      if (!g) continue;
      this.topPath(g);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 3; ctx.stroke();
    }
    for (const h of ui.aoe || []) {                  // hexes the spell under the cursor would hit
      const g = this.geo.get(key(h.q, h.r));
      if (!g) continue;
      this.topPath(g);
      ctx.fillStyle = 'rgba(255,80,20,0.28)'; ctx.fill();
      ctx.strokeStyle = '#ff5a1f'; ctx.lineWidth = 3; ctx.stroke();
    }
    for (const gh of ui.ghosts || []) {             // enemies last seen here, now out of sight
      const p = this.centre(gh);
      if (!p) continue;
      ctx.globalAlpha = 0.5;
      this.drawUnit({ ...gh, id: -1, hp: CLASSES[gh.cls].hp, acted: false }, state, ui);
      ctx.globalAlpha = 1;
      ctx.font = `bold ${Math.round(this.S * 0.7)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const ty = p.y - (this.flat ? 0 : this.S * 0.45);
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText('?', p.x, ty);
      ctx.fillStyle = '#fff'; ctx.fillText('?', p.x, ty);
      ctx.textBaseline = 'alphabetic';
    }
    if (ui.ghost) {                                  // editor: outline of a hex that doesn't exist yet
      ctx.beginPath();
      this.corners(this.pos(ui.ghost.q, ui.ghost.r)).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.setLineDash([]);
    }
    if (ui.anim) {
      const u = state.units.find((x) => x.id === ui.anim.id);
      if (u && ui.anim.mound) {                   // a burrower on the move: just the ground heaving above it
        const { x, y } = ui.anim, S = this.S, w = Math.sin(performance.now() / 45);
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x + 2, y + 3, S * 0.62, S * 0.5, 0, 0, 6.3); ctx.fill();
        const gr = ctx.createRadialGradient(x - S * 0.15, y - S * 0.15, S * 0.05, x, y, S * 0.6);
        gr.addColorStop(0, '#b9a082'); gr.addColorStop(0.6, '#7d6850'); gr.addColorStop(1, '#3f3327');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(x, y, S * (0.56 + 0.04 * w), S * (0.46 - 0.03 * w), 0, 0, 6.3); ctx.fill();
        ctx.strokeStyle = 'rgba(25,18,12,0.85)'; ctx.lineWidth = 1.6; ctx.beginPath();
        for (let i = 0; i < 5; i++) { const a = i * 1.257 + 0.4; ctx.moveTo(x + Math.cos(a) * S * 0.08, y + Math.sin(a) * S * 0.07); ctx.lineTo(x + Math.cos(a + 0.25) * S * 0.3, y + Math.sin(a + 0.25) * S * 0.24); ctx.lineTo(x + Math.cos(a) * S * 0.5, y + Math.sin(a) * S * 0.4); }
        ctx.stroke();
      } else if (u) this.drawUnit(u, state, ui, ui.anim);
    }
    if (ui.sight) this.sight(ui.sight);
    if (ui.fx?.length) this.effects(ui, state);
    if (this.weather !== false) this.drawWeather();

    const now = performance.now();
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(this.S * 0.6)}px system-ui, sans-serif`;
    for (const f of ui.floats) {
      const t = (now - f.t0) / 900;
      if (t > 1) continue;
      const g = this.centre(f);
      if (!g) continue;
      ctx.globalAlpha = 1 - t * t;
      ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff';
      ctx.strokeText(f.text, g.x, g.y - this.S * (1.3 + t * 0.8));
      ctx.fillText(f.text, g.x, g.y - this.S * (1.3 + t * 0.8));
    }
    ctx.globalAlpha = 1;
  }

  // Screen centre of a hex {q, r}, or of a whole unit when given one ({q, r, o, cls}).
  centre(h) {
    if (h.cls && isBig(h)) {
      let x = 0, y = 0, n = 0;
      for (const c of footprint(h)) {
        const g = this.geo.get(key(c.q, c.r));
        if (g) { x += g.x; y += g.y; n++; }
      }
      if (n) return { x: x / n, y: y / n };
    }
    const g = this.geo.get(key(h.q, h.r));
    return g ? { x: g.x, y: g.y } : null;
  }

  // How much bigger than a one-hex token a creature is drawn.
  scaleOf(u) {
    const size = CLASSES[u.cls].size;
    return size === 'large' ? 1.85 : size === 'huge' ? 2.8 : 1;
  }

  // A unit where it stands (or at `at` while animating), sized to its footprint, with the
  // shudder of a fresh hit and the icy shell of a frozen unit.
  drawUnit(u, state, ui, at = null) {
    const ctx = this.ctx, p = at || this.centre(u);
    if (!p) return;
    let dx = 0;
    if (ui.shake && (ui.shake.id === u.id || ui.shake.ids?.has(u.id))) {
      const k = (performance.now() - ui.shake.t0) / ui.shake.dur;
      if (k < 1) dx = Math.sin(k * 38) * this.S * 0.07 * (1 - k);
    }
    const k = this.scaleOf(u) * (at?.k ?? 1);
    if (k <= 0.02) return;
    ctx.save();
    ctx.translate(p.x + dx, p.y); ctx.scale(k, k);
    this.unit(u, 0, 0, state);
    if (u.frozen === 2) {                          // caught in a web: spokes and sagging rings
      const cy = this.flat ? 0 : -this.S * 0.42, r = this.S * 0.62;
      ctx.strokeStyle = 'rgba(250,250,245,0.9)'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const an = i * Math.PI / 4 + 0.2; ctx.moveTo(0, cy); ctx.lineTo(Math.cos(an) * r, cy + Math.sin(an) * r); }
      for (const f of [0.38, 0.68, 0.98]) {
        for (let i = 0; i < 8; i++) {
          const a0 = i * Math.PI / 4 + 0.2, a1 = a0 + Math.PI / 4, am = (a0 + a1) / 2;
          ctx.moveTo(Math.cos(a0) * r * f, cy + Math.sin(a0) * r * f);
          ctx.quadraticCurveTo(Math.cos(am) * r * f * 0.8, cy + Math.sin(am) * r * f * 0.8, Math.cos(a1) * r * f, cy + Math.sin(a1) * r * f);
        }
      }
      ctx.stroke();
    } else if (u.frozen) {
      const cy = this.flat ? 0 : -this.S * 0.42, r = this.S * 0.6;
      ctx.fillStyle = 'rgba(170,230,255,0.3)'; ctx.strokeStyle = 'rgba(215,245,255,0.95)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, cy, r, 0, 6.3); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff';
      for (let i = 0; i < 3; i++) {
        const an = (i * Math.PI) / 3, fx0 = r * 0.72, fy0 = cy - r * 0.72, fr = this.S * 0.17;
        ctx.beginPath();
        ctx.moveTo(fx0 - Math.cos(an) * fr, fy0 - Math.sin(an) * fr); ctx.lineTo(fx0 + Math.cos(an) * fr, fy0 + Math.sin(an) * fr);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Control point: a ring inside the hex and a pennant at its corner, in the owner's colour
  // (gold while unclaimed). The pennant sits clear of a unit standing on the hex.
  objective(g, owner) {
    const ctx = this.ctx, S = this.S;
    const col = owner === null ? '#ffd84a' : TEAM[owner].fill, dark = owner === null ? '#6b5200' : TEAM[owner].dark;
    ctx.save();
    ctx.translate(g.x, g.y); ctx.scale(1, this.sq);
    ctx.beginPath(); ctx.arc(0, 0, S * 0.74, 0, 6.3);
    ctx.fillStyle = owner === null ? 'rgba(255,216,74,0.16)' : owner ? 'rgba(226,87,76,0.22)' : 'rgba(63,131,224,0.22)';
    ctx.fill();
    ctx.setLineDash([S * 0.2, S * 0.12]);
    ctx.lineWidth = Math.max(4, S * 0.13); ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
    ctx.lineWidth = Math.max(2.5, S * 0.08); ctx.strokeStyle = col; ctx.stroke();
    ctx.restore();
    const px = g.x - S * 0.62, py = g.y - S * 0.34 * this.sq, h = S * 0.62;     // pennant
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2a1c0e'; ctx.lineWidth = Math.max(2.5, S * 0.07);
    ctx.beginPath(); ctx.moveTo(px, py + h * 0.25); ctx.lineTo(px, py - h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px, py - h); ctx.lineTo(px + S * 0.36, py - h * 0.8); ctx.lineTo(px, py - h * 0.58); ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    ctx.strokeStyle = dark; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // Attack effects. Each entry of ui.fx is {type, t0, dur, ...}; positions are hexes, resolved
  // here so they survive a resize. Finished effects are removed.
  //   arrow  {from, to}        projectile on a shallow arc, with a ground shadow
  //   charge {at}              glow gathering on a caster
  //   bolt   {from, to}        lightning: a jagged path that re-forks every few frames
  //   slash  {at, angle}       melee swoosh
  //   flash  {at, color}       brief burst on the target
  //   sparks {at, color, bits} flying particles
  //   death  {unit}            the fallen unit shrinks and fades
  // Decorative weather, picked by the map's biome: snowfall, blowing sand, cloud shadows and
  // pollen over meadows, embers rising from lava, dust motes in other caves. Screen-space
  // particles, a few hundred at most, so the cost is negligible.
  drawWeather() {
    const ctx = this.ctx, w = this.w, h = this.h, now = performance.now();
    const dt = Math.min(0.05, (now - (this.wxT || now)) / 1000);
    this.wxT = now;
    const biome = this.map.biome || 'meadow';
    if (this.wxMap !== this.map || this.wxBiome !== biome) {          // new map: start the weather afresh
      this.wxMap = this.map; this.wxBiome = biome;
      this.wxLava = this.order.filter((c) => c.t === 'lava');
      this.wxHouses = buildings(this.order).flatMap((b) => b.chim.map((ch) => ({ cells: b.cells, dx: ch.dx, dy: ch.dy })));   // one entry per chimney
      this.wxSmoke = [];
      this.wxCam = null;
      this.wxKind = biome === 'snow' ? 'snow' : biome === 'desert' ? 'sand' : biome === 'cave' ? (this.wxLava.length ? 'embers' : 'motes') : 'clouds';
      const R = Math.random, area = w * h, many = (n, make) => Array.from({ length: Math.round(n) }, make);
      this.wx = this.wxKind === 'snow' ? many(Math.min(320, area / 6000), () => ({ x: R() * w, y: R() * h, z: 0.4 + R() * 0.6, ph: R() * 6.3 }))
        : this.wxKind === 'sand' ? many(Math.min(140, area / 12000), () => ({ x: R() * w, y: R() * h, z: 0.5 + R() * 0.5, len: 14 + R() * 30 }))
        : this.wxKind === 'motes' ? many(Math.min(70, area / 22000), () => ({ x: R() * w, y: R() * h, z: 0.4 + R() * 0.6, ph: R() * 6.3, hue: R() }))
        : this.wxKind === 'clouds' ? [...many(6, () => ({ cloud: true, x: R() * w, y: R() * h, r: 150 + R() * 170,
            puffs: many(4 + R() * 3, () => [(R() - 0.5) * 1.5, (R() - 0.5) * 0.8, 0.45 + R() * 0.45]) })), ...many(Math.min(40, area / 40000), () => ({ x: R() * w, y: R() * h, z: 0.4 + R() * 0.6, ph: R() * 6.3 }))]
        : [];
    }
    // Particles live in screen space, so when the view pans or zooms, carry them along with the map.
    const cam = this.wxCam;
    if (cam && (cam.ox !== this.ox || cam.oy !== this.oy || cam.S !== this.S)) {
      const k = this.S / cam.S, anchored = this.wxKind === 'embers';
      // Smoke and embers belong to a spot on the map, so they scale with it. The rest (snow, sand,
      // pollen, clouds, dust) just fills the view: a pan slides it along, but a zoom would squeeze it
      // into a clump or fling it off screen, so on a zoom it is scattered afresh instead.
      for (const p of [...(anchored ? this.wx : []), ...(this.wxSmoke || [])]) { p.x = (p.x - cam.ox) * k + this.ox; p.y = (p.y - cam.oy) * k + this.oy; }
      if (!anchored) for (const p of this.wx) {
        if (Math.abs(k - 1) < 1e-6) { p.x += this.ox - cam.ox; p.y += this.oy - cam.oy; }
        else { p.x = Math.random() * w; p.y = Math.random() * h; }
      }
    }
    this.wxCam = { ox: this.ox, oy: this.oy, S: this.S };
    const P = this.wx, t = now / 1000;
    ctx.save();
    // Weather stays over the map: the whole painted image when there is one, otherwise the hexes themselves.
    const bd = this.flat ? this.backdrop : null;
    ctx.beginPath();
    if (bd) {
      const k = (R3 * this.S) / bd.hexPx;
      ctx.rect(this.ox - bd.ox * k, this.oy - bd.oy * k, bd.img.width * k, bd.img.height * k);
    } else {
      for (const g of this.geo.values()) { g.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
    }
    ctx.clip();
    if (this.wxKind === 'snow') {
      ctx.fillStyle = '#ffffff';
      for (const p of P) {
        p.y += (26 + 44 * p.z) * dt; p.x += (10 + Math.sin(t * 0.9 + p.ph) * 16) * p.z * dt;
        if (p.y > h + 4 || p.y < -8) { p.y = -4; p.x = Math.random() * w; }
        if (p.x > w + 4) p.x = -4; else if (p.x < -8) p.x = w;
        const fr = 1 + 2.1 * p.z;
        ctx.globalAlpha = 0.22 * p.z; ctx.fillStyle = '#35507a';          // a soft shadow, so flakes show against snow
        ctx.beginPath(); ctx.arc(p.x + fr, p.y + fr * 1.4, fr, 0, 6.3); ctx.fill();
        ctx.globalAlpha = 0.5 + 0.5 * p.z; ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(p.x, p.y, fr, 0, 6.3); ctx.fill();
      }
    } else if (this.wxKind === 'sand') {
      const gust = 0.55 + 0.45 * Math.sin(t * 0.35);                 // the wind rises and falls
      ctx.strokeStyle = '#f6e3b8'; ctx.lineCap = 'round';
      for (const p of P) {
        p.x += (240 + 260 * p.z) * (0.5 + gust * 0.5) * dt; p.y += (18 + Math.sin(t + p.len) * 14) * dt;
        if (p.x > w + 40 || p.x < -80) { p.x = -40; p.y = Math.random() * h; }
        if (p.y > h) p.y = 0; else if (p.y < 0) p.y = h;
        ctx.globalAlpha = (0.18 + 0.3 * p.z) * (0.4 + 0.6 * gust); ctx.lineWidth = 1 + p.z;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.len * (0.6 + gust), p.y - p.len * 0.07); ctx.stroke();
      }
    } else if (this.wxKind === 'motes') {                             // slow dust and spores, faintly glowing
      for (const p of P) {
        p.x += Math.sin(t * 0.3 + p.ph) * 7 * dt; p.y -= (3 + 6 * p.z) * dt;
        if (p.y < -4 || p.y > h + 8) { p.y = h + 4; p.x = Math.random() * w; }
        if (p.x < -4) p.x = w; else if (p.x > w + 4) p.x = 0;
        ctx.globalAlpha = (0.2 + 0.3 * p.z) * (0.6 + 0.4 * Math.sin(t * 1.3 + p.ph));
        ctx.fillStyle = p.hue < 0.6 ? '#9ff5e6' : p.hue < 0.85 ? '#c9b0ff' : '#e9e2d2';
        ctx.beginPath(); ctx.arc(p.x, p.y, 0.8 + 1.4 * p.z, 0, 6.3); ctx.fill();
      }
    } else if (this.wxKind === 'clouds') {
      for (const p of P) {
        if (p.cloud) {                                               // a cloud's shadow sliding over the land
          p.x += 26 * dt; p.y += 9 * dt;
          if (p.r > 600 || p.r < 60) p.r = 150 + Math.random() * 170;      // zooming rescales them; keep them cloud-sized
          if (p.x - p.r * 2 > w || p.x + p.r * 2 < 0) { p.x = -p.r * 2; p.y = Math.random() * h; }
          if (p.y - p.r * 2 > h) p.y = -p.r * 2; else if (p.y + p.r * 2 < 0) p.y = h + p.r;
          ctx.globalAlpha = 1;
          for (const [dx, dy, k] of p.puffs) {                       // a few overlapping puffs make one cloud
            const cx = p.x + dx * p.r, cy = p.y + dy * p.r, rr = p.r * k;
            const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
            g.addColorStop(0, 'rgba(8,16,28,0.12)'); g.addColorStop(0.55, 'rgba(8,16,28,0.09)'); g.addColorStop(1, 'rgba(8,16,28,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.3); ctx.fill();
          }
        } else {                                                     // pollen on the breeze
          p.x += (12 + 10 * p.z + Math.sin(t * 0.7 + p.ph) * 8) * dt; p.y += Math.sin(t * 0.5 + p.ph) * 6 * dt;
          if (p.x > w + 4 || p.x < -8) { p.x = -4; p.y = Math.random() * h; }
          if (p.y < -4) p.y = h; else if (p.y > h + 4) p.y = 0;
          ctx.globalAlpha = 0.25 + 0.35 * p.z; ctx.fillStyle = '#fff8d8';
          ctx.beginPath(); ctx.arc(p.x, p.y, 0.7 + 1.1 * p.z, 0, 6.3); ctx.fill();
        }
      }
    } else if (this.wxKind === 'embers') {                            // sparks rising from the lava
      const want = Math.min(220, this.wxLava.length * 6);
      for (let i = 0; i < 4 && P.length < want; i++) {
        const c = this.wxLava[Math.floor(Math.random() * this.wxLava.length)], g = this.geo.get(key(c.q, c.r));
        if (!g) break;
        P.push({ x: g.x + (Math.random() - 0.5) * this.S * 1.5, y: g.y + (Math.random() - 0.5) * this.S * 1.2, age: 0, life: 2 + Math.random() * 3, vy: 18 + Math.random() * 40, ph: Math.random() * 6.3, z: 0.4 + Math.random() * 0.6 });
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i];
        p.age += dt;
        if (p.age >= p.life) { P.splice(i, 1); continue; }
        p.y -= p.vy * dt; p.x += Math.sin(t * 2 + p.ph) * 12 * dt;
        const k = p.age / p.life;
        ctx.globalAlpha = (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85) * 0.9;
        ctx.fillStyle = k < 0.4 ? '#ffe9a0' : k < 0.7 ? '#ff9a3c' : '#e0401c';
        const er = (1.3 + 2.1 * p.z) * (1 - k * 0.5), ea = ctx.globalAlpha;
        ctx.beginPath(); ctx.arc(p.x, p.y, er, 0, 6.3); ctx.fill();
        ctx.globalAlpha = ea * 0.22;                                 // a little halo
        ctx.beginPath(); ctx.arc(p.x, p.y, er * 3, 0, 6.3); ctx.fill();
      }
    }
    // Chimney smoke: every house lets go of a slow puff now and then; it rises, drifts downwind,
    // swells and thins out.
    const houses = this.wxHouses || [];
    if (houses.length) {
      const SM = this.wxSmoke, S = this.S;
      for (let n = houses.length * 1.5 * dt; n > 0 && SM.length < 420; n -= 1) {
        if (Math.random() > n) break;
        const ch = houses[Math.floor(Math.random() * houses.length)];
        let gx = 0, gy = 0, gn = 0;                                  // the building's middle: the average of its hexes
        for (const c of ch.cells) { const g = this.geo.get(key(c.q, c.r)); if (g) { gx += g.x; gy += g.y; gn++; } }
        if (!gn) break;
        SM.push({ x: gx / gn + ch.dx * S, y: gy / gn + ch.dy * S * this.sq, age: 0, life: 3.2 + Math.random() * 2.6, ph: Math.random() * 6.3 });
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = this.wxBiome === 'snow' ? '#aeb4bf' : this.wxBiome === 'cave' ? '#9a9aa0' : '#ececec';
      for (let i = SM.length - 1; i >= 0; i--) {
        const p = SM[i];
        p.age += dt;
        if (p.age >= p.life) { SM.splice(i, 1); continue; }
        const k = p.age / p.life;
        p.y -= S * 0.2 * (1 - k * 0.5) * dt;
        p.x += (S * (0.08 + 0.16 * k) + Math.sin(t * 0.8 + p.ph) * S * 0.03) * dt;
        ctx.globalAlpha = 0.38 * Math.min(1, k * 7) * Math.pow(1 - k, 1.4);
        ctx.beginPath(); ctx.arc(p.x, p.y, S * (0.06 + 0.3 * k), 0, 6.3); ctx.fill();
      }
    }
    ctx.restore();
  }

  effects(ui, state) {
    const ctx = this.ctx, S = this.S, now = performance.now(), lift = this.flat ? 0 : S * 0.45;
    const P = (h) => { const c = this.centre(h); return c ? [c.x, c.y - lift] : null; };
    ui.fx = ui.fx.filter((f) => now < f.t0 + f.dur);
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const f of ui.fx) {
      const t = (now - f.t0) / f.dur;
      if (t < 0) continue;
      if (f.type === 'confetti') {                   // falls across the whole board
        ctx.globalAlpha = t > 0.8 ? (1 - t) / 0.2 : 1;
        for (const [x0, speed, phase, color, size] of f.bits) {
          const y = -20 + (this.h + 40) * ((t * speed * 1.6 + phase / 6.28) % 1);
          const x = x0 * this.w + Math.sin(phase + t * 9 * speed) * 26;
          ctx.fillStyle = color;
          ctx.save();
          ctx.translate(x, y); ctx.rotate(phase + t * 12 * speed); ctx.scale(1, Math.cos(phase + t * 14));
          ctx.fillRect(-size / 2, -size / 2, size, size * 0.6);
          ctx.restore();
        }
        continue;
      }
      const a = P(f.from || f.at || f.unit), b = f.to ? P(f.to) : null;
      if (!a || (f.to && !b)) continue;
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;

      if (f.type === 'arrow') {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]), arc = len * 0.13;
        const x = a[0] + (b[0] - a[0]) * t, gy = a[1] + (b[1] - a[1]) * t, y = gy - Math.sin(Math.PI * t) * arc;
        const ang = Math.atan2(b[1] - a[1] - Math.cos(Math.PI * t) * Math.PI * arc, b[0] - a[0]);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath(); ctx.ellipse(x, gy + S * 0.1, S * 0.22, S * 0.06, Math.atan2(b[1] - a[1], b[0] - a[0]), 0, 6.3); ctx.fill();
        ctx.translate(x, y); ctx.rotate(ang);
        ctx.strokeStyle = '#2a1c0e'; ctx.lineWidth = Math.max(3, S * 0.09);
        ctx.beginPath(); ctx.moveTo(-S * 0.34, 0); ctx.lineTo(S * 0.24, 0); ctx.stroke();
        ctx.strokeStyle = '#f3e7c6'; ctx.lineWidth = Math.max(1.5, S * 0.045);
        ctx.beginPath(); ctx.moveTo(-S * 0.34, 0); ctx.lineTo(S * 0.24, 0); ctx.stroke();
        ctx.fillStyle = '#dfe5ea'; ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(S * 0.38, 0); ctx.lineTo(S * 0.2, -S * 0.1); ctx.lineTo(S * 0.24, 0); ctx.lineTo(S * 0.2, S * 0.1); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fffaf0';
        ctx.beginPath(); ctx.moveTo(-S * 0.24, 0); ctx.lineTo(-S * 0.4, -S * 0.09); ctx.lineTo(-S * 0.34, 0); ctx.lineTo(-S * 0.4, S * 0.09); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      } else if (f.type === 'charge') {
        const r = S * (0.25 + 0.5 * t), g = ctx.createRadialGradient(a[0], a[1], 0, a[0], a[1], r);
        const tint = f.color === 'fire' ? '255,160,50' : f.color === 'frost' ? '150,235,255' : f.color === 'arcane' ? '200,140,255' : f.color === 'web' ? '240,240,232' : '140,200,255';
        g.addColorStop(0, `rgba(255,255,255,${0.9 * t})`); g.addColorStop(0.4, `rgba(${tint},${0.6 * t})`); g.addColorStop(1, `rgba(${tint},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(a[0], a[1], r, 0, 6.3); ctx.fill();
      } else if (f.type === 'bolt') {
        if (!f.path || now > f.next) {               // re-fork every ~45 ms so it crackles
          f.next = now + 45;
          const fork = (p0, p1, sway) => {
            const n = Math.max(4, Math.round(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / (S * 0.3)));
            const nx = -(p1[1] - p0[1]), ny = p1[0] - p0[0], nl = Math.hypot(nx, ny) || 1, pts = [];
            for (let i = 0; i <= n; i++) {
              const k = i / n, off = i && i < n ? (Math.random() - 0.5) * 2 * sway : 0;
              pts.push([p0[0] + (p1[0] - p0[0]) * k + (nx / nl) * off, p0[1] + (p1[1] - p0[1]) * k + (ny / nl) * off]);
            }
            return pts;
          };
          const main = fork(a, b, S * 0.2);
          f.path = [main];
          for (let i = 0; i < 2; i++) {
            const from = main[1 + Math.floor(Math.random() * (main.length - 2))], ang = Math.random() * 6.28, l = S * (0.4 + Math.random() * 0.5);
            f.path.push(fork(from, [from[0] + Math.cos(ang) * l, from[1] + Math.sin(ang) * l], S * 0.1));
          }
        }
        const fade = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
        ctx.shadowColor = '#6cc6ff'; ctx.shadowBlur = S * 0.5;
        f.path.forEach((pts, bi) => {
          for (const [w, col, al] of [[S * 0.26, '#3f8cff', 0.3], [S * 0.12, '#9bdcff', 0.85], [S * 0.045, '#ffffff', 1]]) {
            ctx.globalAlpha = al * fade * (bi ? 0.7 : 1);
            ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, w * (bi ? 0.55 : 1));
            ctx.beginPath();
            pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.stroke();
          }
        });
      } else if (f.type === 'orb') {                 // fireball / frost bolt in flight, with a trail
        const fire = f.color === 'fire';
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]), arc = len * 0.07;
        const at = (k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k - Math.sin(Math.PI * k) * arc];
        for (let i = 7; i >= 1; i--) {
          const k = t - i * 0.035;
          if (k < 0) continue;
          const [x, y] = at(k);
          ctx.globalAlpha = 0.5 - i * 0.06;
          ctx.fillStyle = fire ? (i > 3 ? '#b8431a' : '#ff8a2a') : (i > 3 ? '#4aa3d8' : '#9fe3ff');
          ctx.beginPath(); ctx.arc(x, y, S * (0.24 - i * 0.022), 0, 6.3); ctx.fill();
        }
        const [x, y] = at(t), r = S * 0.36;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.35, fire ? '#ffd76a' : '#d8f6ff');
        g.addColorStop(0.7, fire ? 'rgba(255,110,30,0.85)' : 'rgba(90,200,255,0.85)');
        g.addColorStop(1, fire ? 'rgba(200,40,0,0)' : 'rgba(40,120,255,0)');
        ctx.globalAlpha = 1;
        ctx.shadowColor = fire ? '#ff7a1a' : '#6fd6ff'; ctx.shadowBlur = S * 0.6;
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
      } else if (f.type === 'breath') {              // a jet of flame fanning out from the dragon toward its aim
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = Math.hypot(b[0] - a[0], b[1] - a[1]) * f.reach;
        const fade = t > 0.7 ? (1 - t) / 0.3 : 1;
        ctx.globalCompositeOperation = 'lighter';
        for (const [off, speed, phase, wob] of f.bits) {
          const run = t * 3.2 * speed - phase;       // each puff sets out in turn, then loops
          if (run < 0) continue;
          const k = run % 1, d = S * 1.1 + (L - S * 1.1) * k;
          const th = ang + off * 1.0 * (0.35 + 0.65 * k) + Math.sin(now / 90 + wob * 6.28) * 0.04;
          const x = a[0] + Math.cos(th) * d, y = a[1] + Math.sin(th) * d, r = S * (0.16 + 0.55 * k);
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          const hot = 1 - k;
          g.addColorStop(0, `rgba(255,${Math.round(150 + 105 * hot)},${Math.round(40 + 190 * hot * hot)},${0.55 * fade})`);
          g.addColorStop(0.5, `rgba(255,${Math.round(70 + 90 * hot)},20,${0.3 * fade})`);
          g.addColorStop(1, 'rgba(160,20,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      } else if (f.type === 'explosion') {           // fireball going off: fills the hex and its neighbours
        const ease = 1 - (1 - t) * (1 - t), r = S * R3 * 1.5 * ease, al = 1 - t;
        const g = ctx.createRadialGradient(a[0], a[1], 0, a[0], a[1], Math.max(1, r));
        g.addColorStop(0, `rgba(255,255,235,${al})`);
        g.addColorStop(0.35, `rgba(255,205,90,${al})`);
        g.addColorStop(0.72, `rgba(255,95,25,${0.85 * al})`);
        g.addColorStop(1, 'rgba(120,20,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(a[0], a[1], Math.max(1, r), 0, 6.3); ctx.fill();
        ctx.globalAlpha = al;
        ctx.strokeStyle = '#ffe8b8'; ctx.lineWidth = Math.max(1, S * 0.14 * al);
        ctx.beginPath(); ctx.arc(a[0], a[1], Math.max(1, r * 0.96), 0, 6.3); ctx.stroke();
      } else if (f.type === 'blink') {               // teleport: a ring that collapses (out) or opens (in)
        const k = f.out ? 1 - t : t, r = S * (0.15 + 0.6 * k);
        ctx.globalAlpha = f.out ? 1 - t * 0.3 : 1 - t;
        ctx.shadowColor = '#c890ff'; ctx.shadowBlur = S * 0.5;
        ctx.strokeStyle = '#ecd6ff'; ctx.lineWidth = Math.max(2, S * 0.1);
        ctx.beginPath(); ctx.arc(a[0], a[1], r, 0, 6.3); ctx.stroke();
        ctx.fillStyle = 'rgba(190,130,255,0.35)'; ctx.fill();
      } else if (f.type === 'slash') {
        const sweep = Math.min(1, t * 2.2), fade = 1 - t * t, r = S * 0.62;
        const a0 = f.angle - 1.25, a1 = a0 + 2.5 * sweep;
        ctx.globalAlpha = fade;
        ctx.fillStyle = '#ffffff'; ctx.shadowColor = '#fff6c8'; ctx.shadowBlur = S * 0.3;
        ctx.beginPath();
        ctx.arc(a[0], a[1], r, a0, a1);
        ctx.arc(a[0] - Math.cos(f.angle) * r * 0.28, a[1] - Math.sin(f.angle) * r * 0.28, r * 0.92, a1, a0, true);
        ctx.closePath(); ctx.fill();
      } else if (f.type === 'flash') {
        const r = S * (0.45 + 0.35 * t), g = ctx.createRadialGradient(a[0], a[1], 0, a[0], a[1], r);
        g.addColorStop(0, f.color || '#ffffff'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(a[0], a[1], r, 0, 6.3); ctx.fill();
      } else if (f.type === 'sparks') {
        ctx.strokeStyle = f.color || '#ffe9a8'; ctx.lineWidth = Math.max(1.5, S * 0.05);
        ctx.globalAlpha = 1 - t;
        for (const [ang, spd] of f.bits) {
          const d0 = S * spd * t, d1 = S * spd * Math.max(0, t - 0.18);
          ctx.beginPath();
          ctx.moveTo(a[0] + Math.cos(ang) * d0, a[1] + Math.sin(ang) * d0 + S * 0.5 * t * t);
          ctx.lineTo(a[0] + Math.cos(ang) * d1, a[1] + Math.sin(ang) * d1 + S * 0.5 * t * t);
          ctx.stroke();
        }
      } else if (f.type === 'hold') {                // a unit that is already gone from the state, still standing
        this.drawUnit(f.unit, state, ui, ui.anim?.id === f.unit.id ? ui.anim : null);
      } else if (f.type === 'death') {
        const g = this.centre(f.unit), k = (1 - 0.45 * t) * this.scaleOf(f.unit);
        ctx.globalAlpha = 1 - t;
        ctx.translate(g.x, g.y); ctx.scale(k, k);
        this.unit({ ...f.unit, hp: 0, acted: false }, 0, 0, state);
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      }
    }
    ctx.restore();
  }

  // Top-down only: mark the high side of every height change (thin = slope, thick = cliff)
  // and print the height of raised hexes.
  contours() {
    const ctx = this.ctx, S = this.S;
    ctx.lineCap = 'round';
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.max(10, Math.round(S * 0.36))}px system-ui, sans-serif`;
    for (const c of this.order) {
      if (c.e === 0) continue;
      const g = this.geo.get(key(c.q, c.r));
      for (let i = 0; i < 6 && this.edges !== false; i++) {      // edges can be switched off; the number stays
        const [dq, dr] = DIRS[5 - i];                 // edge i faces this neighbour
        const n = this.map.cells[key(c.q + dq, c.r + dr)];
        if (!n || n.e >= c.e) continue;
        const cliff = c.e - n.e >= 2, a = g.pts[i], b = g.pts[(i + 1) % 6];
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        ctx.strokeStyle = cliff ? '#2e2013' : 'rgba(46,32,19,0.7)';
        ctx.lineWidth = cliff ? Math.max(4, S * 0.16) : 2.5;
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillText(c.e, g.x, g.y + S * 0.82);
    }
    ctx.lineCap = 'butt';
  }

  // Sight line from the selected ranged unit to the hovered enemy.
  // s: {from, to, status: 'ok'|'blocked'|'range', blocker: cell|null, d}
  sight(s) {
    const ctx = this.ctx, S = this.S, lift = this.flat ? 0 : S * 0.4;
    const a = this.geo.get(key(s.from.q, s.from.r)), b = this.geo.get(key(s.to.q, s.to.r));
    const col = s.status === 'ok' ? '#7dff7a' : s.status === 'blocked' ? '#ff4d40' : '#d0d6dc';
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    for (const pass of [0, 1]) {
      ctx.beginPath(); ctx.moveTo(a.x, a.y - lift); ctx.lineTo(b.x, b.y - lift); ctx.stroke();
      ctx.lineWidth = 2.5; ctx.strokeStyle = col;
    }
    ctx.setLineDash([]);
    if (s.blocker) {
      const g = this.geo.get(key(s.blocker.q, s.blocker.r)), r = S * 0.28;
      this.topPath(g); ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(g.x - r, g.y - r); ctx.lineTo(g.x + r, g.y + r);
      ctx.moveTo(g.x + r, g.y - r); ctx.lineTo(g.x - r, g.y + r);
      ctx.stroke();
    }
    const text = s.status === 'ok' ? `${s.d} hexes` : s.status === 'blocked' ? 'blocked' : `${s.d} hexes — out of range`;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - lift - 8;
    ctx.font = `bold ${Math.max(12, Math.round(S * 0.36))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(text, mx, my);
    ctx.fillStyle = col; ctx.fillText(text, mx, my);
    ctx.restore();
  }

  cell(c, g) {
    const ctx = this.ctx, p = g.pts, water = c.t === 'water';
    if (this.flat && this.backdrop) {                // the image is the art; just tint and outline
      this.topPath(g);
      if (c.t !== 'grass' || c.e) { ctx.globalAlpha = this.overlay; ctx.fillStyle = TOP[c.t][c.e]; ctx.fill(); ctx.globalAlpha = 1; }
      const ga = this.grid ?? 1;                     // grid strength, 0 (hidden) to 1
      if (ga > 0) {
        ctx.strokeStyle = 'rgba(0,0,0,' + 0.22 * ga + ')'; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,' + 0.4 * ga + ')'; ctx.lineWidth = 1; ctx.stroke();
      }
      return;
    }
    const side = (a, b, color) => {
      ctx.beginPath();
      ctx.moveTo(p[a][0], p[a][1]); ctx.lineTo(p[b][0], p[b][1]);
      ctx.lineTo(p[b][0], p[b][1] + g.drop); ctx.lineTo(p[a][0], p[a][1] + g.drop);
      ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
    };
    if (!this.flat) {
      side(0, 1, water ? '#2f6a9c' : '#6b5138');   // lower-right face (shaded)
      side(1, 2, water ? '#3b7fb8' : '#8b6b49');   // lower-left face (lit)
    }
    this.topPath(g);
    ctx.fillStyle = TOP[c.t][c.e];
    ctx.fill();
    if (this.flat && c.e) { ctx.fillStyle = `rgba(255,236,170,${c.e * 0.13})`; ctx.fill(); }   // stronger height tint
    if ((this.grid ?? 1) > 0) { ctx.strokeStyle = 'rgba(0,0,0,' + 0.22 * (this.grid ?? 1) + ')'; ctx.lineWidth = 1; ctx.stroke(); }
  }

  decor(c, g) {
    const ctx = this.ctx, S = this.S, { x, y } = g;
    ctx.lineWidth = 1;
    if (c.t === 'house') {                           // walls, a pitched roof and a chimney
      const w = S * 0.5, wall = S * 0.34, top = y - S * 0.1;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.fillStyle = '#e4d6b8'; ctx.fillRect(x - w, top, 2 * w, wall); ctx.strokeRect(x - w, top, 2 * w, wall);
      ctx.fillStyle = '#5b3a24'; ctx.fillRect(x + w * 0.35, top - S * 0.5, S * 0.14, S * 0.3);
      ctx.beginPath(); ctx.moveTo(x - w * 1.15, top); ctx.lineTo(x, top - S * 0.48); ctx.lineTo(x + w * 1.15, top); ctx.closePath();
      ctx.fillStyle = '#a8502f'; ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#4a3020'; ctx.fillRect(x - S * 0.08, top + wall * 0.35, S * 0.16, wall * 0.65);
    } else if (c.t === 'lava') {                     // bright seams in a darker crust
      ctx.strokeStyle = 'rgba(255,225,120,0.9)'; ctx.lineWidth = 2;
      for (const [dx, dy] of [[-0.35, -0.15], [0.05, 0.12], [-0.1, -0.32]]) {
        ctx.beginPath();
        ctx.moveTo(x + S * dx, y + S * dy);
        ctx.quadraticCurveTo(x + S * (dx + 0.14), y + S * (dy + 0.1), x + S * (dx + 0.3), y + S * (dy - 0.02));
        ctx.stroke();
      }
    } else if (c.t === 'water') {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
      for (const [dx, dy] of [[-0.3, -0.12], [0.15, 0.1]]) {
        ctx.beginPath();
        ctx.moveTo(x + S * dx, y + S * dy);
        ctx.quadraticCurveTo(x + S * (dx + 0.12), y + S * (dy - 0.08), x + S * (dx + 0.25), y + S * dy);
        ctx.stroke();
      }
    } else if (c.t === 'forest') {
      for (const [dx, dy, k] of [[-0.42, -0.1, 0.8], [0.4, -0.16, 0.9], [0.02, 0.2, 1]]) {
        const tx = x + S * dx, ty = y + S * dy, h = S * 0.85 * k, w = S * 0.3 * k;
        ctx.fillStyle = '#5a3d25';
        ctx.fillRect(tx - S * 0.04, ty - h * 0.25, S * 0.08, h * 0.25);
        for (const [base, tip, col] of [[0.2, 0.75, '#2f6b35'], [0.5, 1, '#3d8243']]) {
          ctx.beginPath();
          ctx.moveTo(tx - w, ty - h * base); ctx.lineTo(tx, ty - h * tip); ctx.lineTo(tx + w, ty - h * base);
          ctx.closePath();
          ctx.fillStyle = col; ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.stroke();
        }
      }
    } else if (c.t === 'spikes') {
      for (const [dx, dy, k] of [[-0.4, -0.05, 0.75], [0.38, -0.12, 0.9], [0.0, 0.22, 1.1], [-0.12, -0.3, 0.6]]) {
        const tx = x + S * dx, ty = y + S * dy, h = S * 0.7 * k, w = S * 0.17 * k;
        ctx.beginPath(); ctx.moveTo(tx - w, ty); ctx.lineTo(tx - w * 0.1, ty - h); ctx.lineTo(tx + w, ty); ctx.closePath();
        ctx.fillStyle = '#6c6f6a'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(tx - w, ty); ctx.lineTo(tx - w * 0.1, ty - h); ctx.lineTo(tx - w * 0.1, ty); ctx.closePath();
        ctx.fillStyle = '#b4b7ae'; ctx.fill();
      }
    } else if (c.t === 'rock') {
      const P = (pts, col) => {
        ctx.beginPath();
        pts.forEach(([dx, dy], i) => (i ? ctx.lineTo(x + S * dx, y + S * dy) : ctx.moveTo(x + S * dx, y + S * dy)));
        ctx.closePath();
        ctx.fillStyle = col; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke();
      };
      P([[-0.62, 0.12], [-0.5, -0.5], [-0.1, -0.95], [0.35, -0.8], [0.62, -0.2], [0.55, 0.2], [0, 0.36]], '#5f6770');
      P([[-0.5, -0.5], [-0.1, -0.95], [0.35, -0.8], [0.05, -0.38]], '#9aa3ab');
      P([[-0.62, 0.12], [-0.5, -0.5], [0.05, -0.38], [0, 0.36]], '#7b848c');
    } else if (c.t === 'ruins') {
      const block = (dx, dy, w, h) => {
        const bx = x + S * dx, by = y + S * dy, bw = S * w, bh = S * h, sk = S * 0.12;
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.fillStyle = '#8f8a78'; ctx.fillRect(bx, by - bh, bw, bh); ctx.strokeRect(bx, by - bh, bw, bh);
        ctx.beginPath();
        ctx.moveTo(bx, by - bh); ctx.lineTo(bx + sk, by - bh - sk * 0.7);
        ctx.lineTo(bx + bw + sk, by - bh - sk * 0.7); ctx.lineTo(bx + bw, by - bh);
        ctx.closePath();
        ctx.fillStyle = '#c9c4ae'; ctx.fill(); ctx.stroke();
      };
      block(-0.68, -0.05, 0.4, 0.5);
      block(0.34, 0.08, 0.34, 0.3);
      block(-0.3, 0.34, 0.5, 0.2);
    }
  }

  unit(u, x, y, state) {
    const ctx = this.ctx, S = this.S, col = TEAM[u.team], cls = CLASSES[u.cls];
    if (this.flat) {                                 // round token that stays inside its hex
      const f = u.hp / cls.hp, img = this.tokens?.[u.cls]?.[u.team], r = S * (img ? 0.56 : 0.46);
      // A painted figure when there is one — but a one-hex figure too small to make out falls back to its coin.
      const figure = (isBig(u) || S >= 20) && this.painted ? this.painted.get(u.cls, u.team, this.facing?.get(u.id)) : null;
      if (!figure) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(x + r * 0.1, y + r * 0.16, r, r, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.save();
      if (u.acted && u.team === state.turn && state.winner === null) ctx.filter = 'saturate(0.25) brightness(0.8)';
      if (figure) {
        const half = S * 0.56 * figure.scale;
        ctx.drawImage(figure.canvas, x - half, y - half, half * 2, half * 2);
      } else if (img) {
        ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
      } else {                                       // fallback until the token art has loaded
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = col.fill; ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = col.dark; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `bold ${Math.round(S * 0.5)}px system-ui, sans-serif`;
        ctx.fillText(cls.glyph, x, y - S * 0.04);
        ctx.textBaseline = 'alphabetic';
      }
      ctx.restore();
      const bw = S * 0.7, bh = Math.max(4, S * 0.12), bx = x - bw / 2, by = y - S * 0.78;
      ctx.fillStyle = '#111'; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = f > 0.5 ? '#5fd35f' : f > 0.25 ? '#f0c040' : '#f05040';
      ctx.fillRect(bx, by, bw * f, bh);
      return;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x, y, S * 0.4, S * 0.18, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    if (u.acted && u.team === state.turn && state.winner === null) ctx.filter = 'saturate(0.25) brightness(0.8)';
    ctx.fillStyle = col.fill; ctx.strokeStyle = col.dark; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - S * 0.3, y - S * 0.06);
    ctx.quadraticCurveTo(x, y + S * 0.1, x + S * 0.3, y - S * 0.06);
    ctx.lineTo(x + S * 0.15, y - S * 0.62); ctx.lineTo(x - S * 0.15, y - S * 0.62);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - S * 0.78, S * 0.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(S * 0.36)}px system-ui, sans-serif`;
    ctx.fillText(cls.glyph, x, y - S * 0.28);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();

    const bw = S * 0.84, bh = Math.max(4, S * 0.13), bx = x - bw / 2, by = y - S * 1.2;
    const f = u.hp / cls.hp;
    ctx.fillStyle = '#111'; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = f > 0.5 ? '#5fd35f' : f > 0.25 ? '#f0c040' : '#f05040';
    ctx.fillRect(bx, by, bw * f, bh);
  }
}
