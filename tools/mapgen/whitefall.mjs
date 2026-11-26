// "whitefall": a vast snowfield (37 x 23). A ruined keep on a hill at the centre, a frozen lake with
// an island shrine on each side, a watchtower in the north and the south each held by a neutral
// ogre, mountain ridges along two edges, belts of pine, and two cairn rings with a troll in each.
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
const path = (a, b) => { const p = at(...a), q = at(...b), n = dist(p, q), out = []; for (let i = 0; i <= n; i++) out.push(hexRound(p.q + (q.q - p.q) * (i / Math.max(1, n)) + 1e-6, p.r + (q.r - p.r) * (i / Math.max(1, n)) + 2e-6)); return out; };
const origin = { q: 0, r: 0 };
for (const c of data.cells) { c.t = 'grass'; c.e = 0; }

// Hills: gentle cones you can walk up. [col, row, height, radius] — the first is the keep's hill.
const hills = [[18, 11, 3.4, 4.5], [7, 4, 2.4, 3.2], [13, 19, 2.2, 3], [3, 18, 1.8, 2.6], [15, 8, 1.4, 2.2]];
for (const c of data.cells) {
  let v = 0;
  for (const [col, row, h, rad] of hills) for (const o of [at(col, row), mir(at(col, row))]) v = Math.max(v, h * (1 - dist(c, o) / rad));
  c.e = Math.max(0, Math.min(3, Math.round(v)));
}
// Mountain ridge along the north edge in the west (mirrored: south edge in the east): sheer rock with one pass.
for (const h of path([9, 1], [16, 0])) both(h, (c) => { c.t = 'rock'; c.e = 2; });
for (const h of path([10, 2], [14, 1])) both(h, (c) => { if (c.t !== 'rock') { c.e = 2; } });
set([[12, 1], [12, 0]], (c) => { c.t = 'grass'; c.e = 1; });

// A frozen lake on each side, with an island shrine; a frozen stream runs from it to the map edge.
const lake = at(11, 13);
for (const c of [...data.cells]) { const d = dist(c, lake); if (d <= 3) both(c, (x) => { x.e = 0; if (d <= 2) x.t = 'water'; }); }
both(lake, (c) => { c.t = 'ruins'; });
for (const h of path([9, 15], [6, 22])) both(h, (c) => { c.t = 'water'; c.e = 0; });
// A causeway of packed snow out to the island from the east shore.
both({ q: lake.q + 1, r: lake.r }, (c) => { c.t = 'grass'; }); both({ q: lake.q + 2, r: lake.r }, (c) => { c.t = 'grass'; });

// The keep: broken walls crowning the central hill.
for (const c of data.cells) if (dist(c, origin) <= 1) c.t = 'ruins';
set([[16, 10], [16, 12], [17, 9]], (c) => { if (c.t === 'grass') c.t = 'ruins'; });

// Watchtowers north and south of the keep, on a rise.
const tower = at(20, 3);
for (const c of [...data.cells]) if (dist(c, tower) <= 1) both(c, (x) => { x.e = Math.max(x.e, 1); if (x.t === 'rock') x.t = 'grass'; });
both(tower, (c) => { c.t = 'ruins'; c.e = 2; });

// Cairn rings: standing stones around an altar.
const ring = at(8, 9);
for (const c of [...data.cells]) if (dist(c, ring) <= 2) both(c, (x) => { if (x.t !== 'water') x.t = 'grass'; x.e = Math.min(x.e, 1); });
both(ring, (c) => { c.t = 'ruins'; });
for (const c of [...data.cells]) if (dist(c, ring) === 2 && (((c.q - ring.q) - (c.r - ring.r)) % 2 + 2) % 2 === 0) both(c, (x) => { x.t = 'spikes'; });

// Pine belts and rock outcrops.
const woods = [[5, 12, 2], [14, 16, 1], [9, 19, 2], [15, 4, 2], [3, 6, 1], [13, 10, 1], [6, 16, 1], [17, 20, 1], [10, 6, 1], [2, 21, 1]];
for (const [col, row, rad] of woods) for (const c of near(col, row, rad)) both(c, (x) => { if (x.t === 'grass' && (rad < 2 || (((x.q * 5 + x.r * 11) % 6) + 6) % 6 !== 0)) x.t = 'forest'; });
set([[6, 9], [12, 8], [4, 15], [16, 14], [8, 21], [14, 6], [2, 3], [17, 17], [10, 11], [5, 1], [16, 2]], (c) => { if (c.t === 'grass') c.t = 'rock'; });

// Drop cells with no mirror image; make the rest exactly symmetric (west half is the master).
data.cells = data.cells.filter((c) => cells.has(key(-c.q, -c.r)));
cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
for (const c of data.cells) { const m = cell(mir(c)); if (c.q > 0 || (c.q === 0 && c.r > 0)) { c.t = m.t; c.e = m.e; } }

// Armies of ten on the west edge (mirrored on the east), on open snow.
const ranks = [[2, 7, 'archer'], [2, 9, 'wizard'], [2, 11, 'archer'], [2, 13, 'ogre'], [2, 15, 'scout'],
  [4, 8, 'soldier'], [4, 10, 'ogre'], [4, 12, 'soldier'], [4, 14, 'soldier'], [4, 16, 'scout']];
data.spawns = [0, 1].map((t) => ranks.map(([col, row, cls]) => { const h = at(col, row); return t ? { ...mir(h), cls } : { ...h, cls }; }));
for (const list of data.spawns) for (const s of list) {
  const c = cell(s); c.t = 'grass'; c.e = Math.min(c.e, 1);
  for (const [dq, dr] of DIRS) { const n = cell({ q: s.q + dq, r: s.r + dr }); if (n) { if (n.t !== 'grass' && n.t !== 'forest') n.t = 'grass'; n.e = Math.min(n.e, c.e + 1); } }
}

data.name = 'whitefall';
data.objectives = [origin, tower, mir(tower), lake, mir(lake)];
data.wild = [{ ...ring, cls: 'troll' }, { ...mir(ring), cls: 'troll' }, { ...tower, cls: 'ogre' }, { ...mir(tower), cls: 'ogre' }];

const map = mapFromData(data);
console.log('cells', data.cells.length, 'problem:', mapProblem(map));
const f0 = E.distanceField(map, map.spawns[0]), f1 = E.distanceField(map, map.spawns[1]);
console.log('objective costs blue/red:', JSON.stringify(data.objectives.map((o) => [f0.get(key(o.q, o.r)), f1.get(key(o.q, o.r))])));
const lost = data.cells.filter((c) => !E.impassable(c) && !f0.has(key(c.q, c.r)));
console.log('blue to red spawn:', Math.min(...map.spawns[1].map((s) => f0.get(key(s.q, s.r)))), 'unreachable ground:', lost.length, lost.slice(0, 6).map((c) => `${c.q},${c.r},e${c.e}`).join(' '));
const count = {}; for (const c of data.cells) count[c.t] = (count[c.t] || 0) + 1; console.log(JSON.stringify(count));
const G = { grass: '.', forest: 'f', ruins: '#', water: '~', rock: 'X', spikes: '^' };
const sp = new Map(); map.spawns.forEach((l, t) => l.forEach((s) => sp.set(key(s.q, s.r), 'BR'[t])));
const ob = new Set(data.objectives.map((o) => key(o.q, o.r))), wd = new Map(data.wild.map((o) => [key(o.q, o.r), o.cls[0].toUpperCase()]));
for (let row = 0; row < ROWS; row++) {
  let ln = row % 2 ? ' ' : '';
  for (let col = 0; col < COLS; col++) { const h = at(col, row), c = cell(h), k = key(h.q, h.r); if (!c) { ln += '  '; continue; } ln += (sp.get(k) || wd.get(k) || (ob.has(k) ? '*' : G[c.t])) + (c.e || ' '); }
  console.log(ln);
}
const g = E.createGame(map, { dragons: 'both' });
console.log('units', g.units.length, 'all fit', g.units.every((u) => E.fits(g, u)), 'rounds', g.maxRounds,
  'symmetric', data.cells.every((c) => { const m = cell(mir(c)); return m && m.t === c.t && m.e === c.e; }));
console.log('wild:', g.units.filter((u) => u.team === 2).map((u) => `${u.cls}@${u.q},${u.r}`).join(' '));
// Settings added later in the map editor, kept here so this script reproduces the saved map.
data.ceiling = false;
data.biome = "snow";
data.art = "portrait";
// Keep the painted background the saved map points at (repaint it in the editor if the terrain changed).
{ const fs = await import('node:fs'); const old = fs.existsSync(root + 'maps/whitefall.json') ? JSON.parse(fs.readFileSync(root + 'maps/whitefall.json', 'utf8')) : {};
  if (old.version !== undefined) data.version = old.version; if (old.backdrop) data.backdrop = old.backdrop;
  fs.writeFileSync(process.env.OUT || root + 'maps/whitefall.json', JSON.stringify(data)); }
