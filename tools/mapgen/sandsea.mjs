// "sandsea": a vast desert (37 x 23). Open dunes broken by cliff-sided mesas that can only be
// climbed by ramps, a caravanserai between two pools at the centre, a well on each army's side,
// an obelisk ring in the north and south, dune ridges, rock spires, and two sand worms.
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/^[/]([A-Za-z]:)/, '$1');
const { rectBoard, mapFromData, mapProblem } = await import(pathToFileURL(root + 'src/mapgen.js').href);
const E = await import(pathToFileURL(root + 'src/engine.js').href);
const { dist, key, DIRS, hexRound } = await import(pathToFileURL(root + 'src/hex.js').href);

const COLS = 37, ROWS = 23, r0 = 11, c0 = 18;
const data = rectBoard(COLS, ROWS);
let cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
const at = (col, row) => ({ q: col - c0 - Math.floor((row - r0 - ((row - r0) & 1)) / 2), r: row - r0 });
const cell = (h) => cells.get(key(h.q, h.r));
const mir = (h) => ({ q: -h.q, r: -h.r });
const both = (h, fn) => { for (const p of [h, mir(h)]) { const c = cell(p); if (c) fn(c); } };
const set = (list, fn) => { for (const [col, row] of list) both(at(col, row), fn); };
const near = (col, row, rad) => { const o = at(col, row); return data.cells.filter((c) => dist(c, o) <= rad); };
const nb = (h, i) => ({ q: h.q + DIRS[i][0], r: h.r + DIRS[i][1] });
const line = (a, b, fn) => { const p = at(...a), q = at(...b), n = dist(p, q); for (let i = 0; i <= n; i++) both(hexRound(p.q + (q.q - p.q) * (i / n) + 1e-6, p.r + (q.r - p.r) * (i / n) + 2e-6), fn); };
const origin = { q: 0, r: 0 };
for (const c of data.cells) { c.t = 'grass'; c.e = 0; }

// Mesas: flat-topped, sheer on every side. [col, row, radius, crown]
const mesas = [[10, 5, 2, 1], [7, 18, 2, 0], [16, 16, 1, 0], [3, 2, 1, 0], [15, 2, 1, 0]];
for (const [col, row, rad, crown] of mesas) for (const c of near(col, row, rad)) both(c, (x) => { x.e = dist(c, at(col, row)) <= crown - 1 + (crown ? 1 : 0) && crown ? 3 : 2; });
for (const c of near(10, 5, 0)) both(c, (x) => { x.e = 3; });
for (const c of near(10, 5, 1)) both(c, (x) => { x.e = Math.max(x.e, 2); });
// Ramps (one level up from the sand): two onto the big mesa, one onto each of the middle-sized ones.
set([[12, 7], [13, 7], [7, 5], [9, 20], [10, 20], [17, 15]], (c) => { c.e = 1; });
// Dune ridges: one level high, enough to break sight lines and give archers a perch.
line([12, 10], [14, 13], (c) => { if (!c.e) c.e = 1; });
line([5, 4], [7, 2], (c) => { if (!c.e) c.e = 1; });
line([11, 21], [14, 20], (c) => { if (!c.e) c.e = 1; });
line([2, 17], [3, 19], (c) => { if (!c.e) c.e = 1; });

// The caravanserai at the centre: walls on a low rise between two pools, palms around them.
for (const c of data.cells) { const d = dist(c, origin); if (d <= 4) c.e = 0; }
for (const c of data.cells) if (dist(c, origin) <= 1) { c.t = 'ruins'; c.e = 1; }
set([[15, 10], [15, 11], [16, 10], [14, 11]], (c) => { c.t = 'water'; c.e = 0; });
set([[14, 10], [16, 9], [15, 12], [16, 12], [13, 11], [15, 9]], (c) => { if (c.t === 'grass') { c.t = 'forest'; c.e = 0; } });
set([[16, 13], [20, 8]], (c) => { if (c.t === 'grass') c.t = 'ruins'; });

// A well on each army's side: a ruin with water and palms.
const well = at(8, 11);
both(well, (c) => { c.t = 'ruins'; c.e = 0; });
for (const i of [0, 1]) both(nb(well, i), (c) => { c.t = 'water'; c.e = 0; });
for (const i of [3, 4, 5]) both(nb(well, i), (c) => { c.t = 'forest'; c.e = 0; });
both(nb(nb(well, 4), 4), (c) => { c.t = 'forest'; c.e = 0; });

// Obelisk rings, north and south of the centre: an altar inside a ring of standing stones.
const ring = at(19, 3);
for (const c of [...data.cells]) if (dist(c, ring) <= 2) both(c, (x) => { x.e = 0; x.t = 'grass'; });
both(ring, (c) => { c.t = 'ruins'; });
for (const c of [...data.cells]) if (dist(c, ring) === 2 && (((c.q - ring.q) - (c.r - ring.r)) % 2 + 2) % 2 === 0) both(c, (x) => { x.t = 'spikes'; });

// Rock spires and scrub.
set([[6, 8], [5, 13], [11, 9], [12, 14], [9, 15], [14, 6], [17, 6], [13, 18], [4, 20], [16, 20], [8, 1], [12, 1], [2, 5], [17, 18], [11, 12]], (c) => { if (c.t === 'grass' && c.e === 0) c.t = 'rock'; });
set([[5, 6], [6, 6], [10, 13], [11, 16], [12, 16], [14, 4], [3, 16], [16, 18], [9, 9], [6, 21], [13, 3], [17, 8]], (c) => { if (c.t === 'grass' && c.e === 0) c.t = 'forest'; });

// Drop cells whose mirror image is off the board, and make the rest exactly symmetric (west half is the master).
data.cells = data.cells.filter((c) => cells.has(key(-c.q, -c.r)));
cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
for (const c of data.cells) { const m = cell(mir(c)); if (c.q > 0 || (c.q === 0 && c.r > 0)) { c.t = m.t; c.e = m.e; } }

// Armies of ten, in two ranks on the west edge (mirrored on the east), on open flat sand.
const ranks = [[2, 7, 'archer'], [2, 9, 'wizard'], [2, 11, 'archer'], [2, 13, 'ogre'], [2, 15, 'scout'],
  [4, 8, 'soldier'], [4, 10, 'ogre'], [4, 12, 'soldier'], [4, 14, 'soldier'], [4, 16, 'scout']];
data.spawns = [0, 1].map((t) => ranks.map(([col, row, cls]) => { const h = at(col, row); return t ? { ...mir(h), cls } : { ...h, cls }; }));
for (const list of data.spawns) for (const s of list) {
  const c = cell(s); c.t = 'grass'; c.e = 0;
  for (const [dq, dr] of DIRS) { const n = cell({ q: s.q + dq, r: s.r + dr }); if (n) { if (n.t !== 'grass' && n.t !== 'forest') n.t = 'grass'; n.e = Math.min(n.e, 1); } }
}

data.name = 'sandsea';
data.objectives = [origin, ring, mir(ring), well, mir(well)];
const lair = at(12, 17);
data.wild = [{ ...lair, cls: 'worm' }, { ...mir(lair), cls: 'worm' }, { ...ring, cls: 'spider' }, { ...mir(ring), cls: 'spider' }];
for (const w of data.wild) { const c = cell(w); if (c.t === 'rock' || c.t === 'water') c.t = 'grass'; }

const map = mapFromData(data);
console.log('cells', data.cells.length, 'problem:', mapProblem(map));
const f0 = E.distanceField(map, map.spawns[0]), f1 = E.distanceField(map, map.spawns[1]);
console.log('objective costs blue/red:', JSON.stringify(data.objectives.map((o) => [f0.get(key(o.q, o.r)), f1.get(key(o.q, o.r))])));
const lost = data.cells.filter((c) => c.t !== 'rock' && !f0.has(key(c.q, c.r)));
console.log('blue to red spawn:', Math.min(...map.spawns[1].map((s) => f0.get(key(s.q, s.r)))), 'unreachable ground:', lost.length, lost.slice(0, 6).map((c) => `${c.q},${c.r},e${c.e}`).join(' '));
const count = {}; for (const c of data.cells) count[c.t] = (count[c.t] || 0) + 1; console.log(JSON.stringify(count));
const G = { grass: '.', forest: 'f', ruins: '#', water: '~', rock: 'X', spikes: '^', stalactites: 'v' };
const sp = new Map(); map.spawns.forEach((l, t) => l.forEach((s) => sp.set(key(s.q, s.r), 'BR'[t])));
const ob = new Set(data.objectives.map((o) => key(o.q, o.r))), wd = new Set(data.wild.map((o) => key(o.q, o.r)));
for (let row = 0; row < ROWS; row++) {
  let ln = row % 2 ? ' ' : '';
  for (let col = 0; col < COLS; col++) { const h = at(col, row), c = cell(h), k = key(h.q, h.r); if (!c) { ln += '  '; continue; } ln += (sp.get(k) || (wd.has(k) ? 'W' : ob.has(k) ? '*' : G[c.t])) + (c.e || ' '); }
  console.log(ln);
}
const g = E.createGame(map, { dragons: 'both' });
console.log('units', g.units.length, 'all fit', g.units.every((u) => E.fits(g, u)), 'rounds', g.maxRounds,
  'symmetric', data.cells.every((c) => { const m = cell(mir(c)); return m && m.t === c.t && m.e === c.e; }));
console.log('wild:', g.units.filter((u) => u.team === 2).map((u) => `${u.cls}@${u.q},${u.r}`).join(' '));
// Settings added later in the map editor, kept here so this script reproduces the saved map.
data.ceiling = false;
data.biome = "desert";
data.art = "portrait";
// Keep the painted background the saved map points at (repaint it in the editor if the terrain changed).
{ const fs = await import('node:fs'); const old = fs.existsSync(root + 'maps/sandsea.json') ? JSON.parse(fs.readFileSync(root + 'maps/sandsea.json', 'utf8')) : {};
  if (old.version !== undefined) data.version = old.version; if (old.backdrop) data.backdrop = old.backdrop;
  fs.writeFileSync(process.env.OUT || root + 'maps/sandsea.json', JSON.stringify(data)); }
