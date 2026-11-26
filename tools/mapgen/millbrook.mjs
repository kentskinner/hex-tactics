// "millbrook": a village astride a stream (23 x 15, meadow). A road runs east-west through it and
// over a stone bridge at the centre; houses line the road on both banks, with a farm further out
// on each side. The stream can also be forded north and south of the village.
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/^[/]([A-Za-z]:)/, '$1');
const { rectBoard, mapFromData, mapProblem } = await import(pathToFileURL(root + 'src/mapgen.js').href);
const E = await import(pathToFileURL(root + 'src/engine.js').href);
const { dist, key, DIRS, hexRound } = await import(pathToFileURL(root + 'src/hex.js').href);

const COLS = 23, ROWS = 15, r0 = 7, c0 = 11;
const data = rectBoard(COLS, ROWS);
let cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
const at = (col, row) => ({ q: col - c0 - Math.floor((row - r0 - ((row - r0) & 1)) / 2), r: row - r0 });
const cell = (h) => cells.get(key(h.q, h.r));
const mir = (h) => ({ q: -h.q, r: -h.r });
const both = (h, fn) => { for (const p of [h, mir(h)]) { const c = cell(p); if (c) fn(c); } };
const set = (list, fn) => { for (const [col, row] of list) both(at(col, row), fn); };
const path = (a, b) => { const p = at(...a), q = at(...b), n = dist(p, q), out = []; for (let i = 0; i <= n; i++) out.push(hexRound(p.q + (q.q - p.q) * (i / Math.max(1, n)) + 1e-6, p.r + (q.r - p.r) * (i / Math.max(1, n)) + 2e-6)); return out; };
const origin = { q: 0, r: 0 };
for (const c of data.cells) { c.t = 'grass'; c.e = 0; }

// Low hills on the outskirts.
for (const [col, row, h, rad] of [[4, 2, 2.2, 2.6], [5, 12, 1.6, 2.2], [15, 1, 1.4, 2]]) {
  for (const c of data.cells) for (const o of [at(col, row), mir(at(col, row))]) c.e = Math.max(c.e, Math.max(0, Math.min(3, Math.round(h * (1 - dist(c, o) / rad)))));
}
// The stream, north to south through the middle.
for (const h of [...path([13, 0], [12, 4]), ...path([12, 4], [11, 7])]) both(h, (c) => { c.t = 'water'; c.e = 0; });
// The bridge, and a ford above and below the village.
both(origin, (c) => { c.t = 'ruins'; });
const ford = path([13, 0], [12, 4])[2];
both(ford, (c) => { c.t = 'grass'; });
// Keep the road (rows 6-8) and the stream banks level.
for (const c of data.cells) { const row = c.r + r0; if (row >= 6 && row <= 8) c.e = 0; if (c.t === 'water') for (const [dq, dr] of DIRS) { const n = cell({ q: c.q + dq, r: c.r + dr }); if (n) n.e = Math.min(n.e, 1); } }

// The village: houses north and south of the road on the west bank (mirrored on the east), a farm further out.
const houses = [[7, 5], [8, 5], [9, 5], [10, 4], [7, 9], [8, 9], [9, 9], [8, 10], [4, 8], [5, 5]];
set(houses, (c) => { if (c.t !== 'water') { c.t = 'house'; c.e = 0; } });
// Garden walls and a well: a little cover in the lanes.
set([[9, 6], [6, 8]], (c) => { if (c.t === 'grass') c.t = 'ruins'; });
// The road through the village and over the bridge, with a lane up to each row of houses and to the farms.
set([[3, 7], [4, 7], [5, 7], [6, 7], [7, 7], [8, 7], [9, 7], [10, 7], [8, 6], [8, 8], [5, 6]], (c) => { if (c.t === 'grass') c.t = 'road'; });
// ...and on out of the village to the map edge, bending south-west (north-east on the far side).
for (const h of [...path([3, 7], [2, 9]), ...path([2, 9], [0, 10])]) both(h, (c) => { c.t = 'road'; c.e = 0; });
// Orchards and woods, rocks.
for (const [col, row, rad] of [[3, 5, 1], [6, 12, 1], [10, 12, 1], [2, 10, 1], [9, 1, 1], [6, 2, 0], [10, 10, 0]]) {
  for (const c of data.cells) if (dist(c, at(col, row)) <= rad) both(c, (x) => { if (x.t === 'grass') x.t = 'forest'; });
}
set([[5, 9], [7, 2], [3, 13], [10, 13], [1, 1]], (c) => { if (c.t === 'grass' && c.e === 0) c.t = 'rock'; });

// Drop cells with no mirror image; make the rest exactly symmetric (west half is the master).
data.cells = data.cells.filter((c) => cells.has(key(-c.q, -c.r)));
cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
for (const c of data.cells) { const m = cell(mir(c)); if (c.q > 0 || (c.q === 0 && c.r > 0)) { c.t = m.t; c.e = m.e; } }

data.spawns = [0, 1].map((t) => [5, 6, 7, 8, 9].map((row) => { const h = at(row === 7 ? 2 : 1, row); return t ? mir(h) : h; }));
for (const list of data.spawns) for (const s of list) { const c = cell(s); if (c.t !== 'road') c.t = 'grass'; c.e = 0; }
data.name = 'millbrook';
data.biome = 'meadow';
data.objectives = [origin, { q: ford.q, r: ford.r }, mir(ford)];

const map = mapFromData(data);
console.log('cells', data.cells.length, 'problem:', mapProblem(map));
const f0 = E.distanceField(map, map.spawns[0]), f1 = E.distanceField(map, map.spawns[1]);
console.log('objective costs blue/red:', JSON.stringify(data.objectives.map((o) => [f0.get(key(o.q, o.r)), f1.get(key(o.q, o.r))])));
console.log('blue to red spawn:', Math.min(...map.spawns[1].map((s) => f0.get(key(s.q, s.r)))), 'unreachable ground:', data.cells.filter((c) => !E.impassable(c) && !f0.has(key(c.q, c.r))).length);
const count = {}; for (const c of data.cells) count[c.t] = (count[c.t] || 0) + 1; console.log(JSON.stringify(count));
const G = { road: '=', grass: '.', forest: 'f', ruins: '#', water: '~', rock: 'X', house: 'H' };
const sp = new Map(); map.spawns.forEach((l, t) => l.forEach((s) => sp.set(key(s.q, s.r), 'BR'[t])));
const ob = new Set(data.objectives.map((o) => key(o.q, o.r)));
for (let row = 0; row < ROWS; row++) {
  let ln = row % 2 ? ' ' : '';
  for (let col = 0; col < COLS; col++) { const h = at(col, row), c = cell(h), k = key(h.q, h.r); if (!c) { ln += '  '; continue; } ln += (sp.get(k) || (ob.has(k) ? '*' : G[c.t])) + (c.e || ' '); }
  console.log(ln);
}
const g = E.createGame(map, { dragons: 'both' });
console.log('units', g.units.length, 'all fit', g.units.every((u) => E.fits(g, u)), 'rounds', g.maxRounds,
  'symmetric', data.cells.every((c) => { const m = cell(mir(c)); return m && m.t === c.t && m.e === c.e; }));
function roam(u, goal) { const seen = new Set([E.posKey({ q: u.q, r: u.r, o: u.o })]); let fr = [{ ...u }];
  for (let t = 1; t <= 20; t++) { const nx = []; for (const p of fr) for (const n of E.reachable({ ...g, units: [p] }, p).values()) { const k = E.posKey(n); if (!n.stop || seen.has(k)) continue; seen.add(k); if (E.footprint(u, n).some((c) => c.q === goal.q && c.r === goal.r)) return t; nx.push({ ...u, q: n.q, r: n.r, o: n.o }); } fr = nx; } return Infinity; }
for (const cls of ['dragon', 'ogre', 'soldier']) { const u = g.units.find((x) => x.cls === cls && x.team === 0); console.log(cls, 'turns to the bridge', roam(u, origin)); }
// Rule checks on this map: sight through a house, standing in one.
const hs = data.cells.filter((c) => c.t === 'house');
const h0 = hs[0];
console.log('houses', hs.length, 'soldier fits in a house', E.fits({ map, units: [] }, { id: 99, cls: 'soldier' }, h0), 'ogre fits', E.fits({ map, units: [] }, { id: 99, cls: 'ogre' }, { q: h0.q, r: h0.r, o: 0 }));
const row5 = [at(6, 5), at(10, 5)];
console.log('sight through the row of houses blocked:', !E.los(map, row5[0], row5[1]), ' sight along the road clear:', E.los(map, at(5, 7), at(9, 7)) || 'blocked by the well');
// Settings added later in the map editor, kept here so this script reproduces the saved map.
data.ceiling = false;
// Keep the painted background the saved map points at (repaint it in the editor if the terrain changed).
{ const fs = await import('node:fs'); const old = fs.existsSync(root + 'maps/millbrook.json') ? JSON.parse(fs.readFileSync(root + 'maps/millbrook.json', 'utf8')) : {};
  if (old.version !== undefined) data.version = old.version; if (old.backdrop) data.backdrop = old.backdrop;
  fs.writeFileSync(process.env.OUT || root + 'maps/millbrook.json', JSON.stringify(data)); }
