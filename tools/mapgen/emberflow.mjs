// "emberflow": a lava tube (23 x 15, ceiling). One broad tunnel runs east-west between the armies,
// and a river of lava cuts across it from the north wall to the south. It can be crossed on foot
// in three places only: a wide basalt bridge in the middle and a narrow stone span to the north and
// south. A one-hex side tunnel along each wall arches over the lava too. Flyers cross anywhere.
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
const origin = { q: 0, r: 0 };
const floor = (c) => { if (c.t === 'rock') { c.t = 'grass'; c.e = 0; } };
const path = (a, b) => { const p = at(...a), q = at(...b), n = dist(p, q), out = []; for (let i = 0; i <= n; i++) out.push(hexRound(p.q + (q.q - p.q) * (i / Math.max(1, n)) + 1e-6, p.r + (q.r - p.r) * (i / Math.max(1, n)) + 2e-6)); return out; };
const line = (a, b, wide = 0, fn = floor) => { for (const h of path(a, b)) for (const c of data.cells) if (dist(c, h) <= wide) both(c, fn); };
const span = (c1, c2, r1, r2) => { const out = []; for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push([c, r]); return out; };

for (const c of data.cells) { c.t = 'rock'; c.e = 0; }
// Army hall (west; mirrored east) and the main tube, seven hexes high.
set(span(1, 4, 4, 10), floor);
set([[1, 4], [1, 10]], (c) => { c.t = 'rock'; });
line([5, 7], [11, 7], 5);
// Side tunnel along the north wall (the mirror runs along the south wall), linked into both halls.

// Pillars of rock left standing in the tube.
set([[6, 4], [7, 4], [7, 11], [5, 2], [6, 12], [13, 3]], (c) => { c.t = 'rock'; });

// The lava river: down from the north wall, through the middle, out through the south wall.
const river = [...path([8, 0], [9, 3]), ...path([9, 3], [11, 7])];
for (const h of river) { both(h, (c) => { c.t = 'lava'; c.e = 0; }); both({ q: h.q + 1, r: h.r }, (c) => { c.t = 'lava'; c.e = 0; }); }
// Lava pools off the main flow.
set([[5, 10], [6, 10], [13, 4]], (c) => { if (c.t !== 'rock') c.t = 'lava'; });

// Crossings. The basalt bridge in the middle: broad enough for an ogre.
for (const c of data.cells) if (dist(c, origin) <= 1) { c.t = 'ruins'; c.e = 0; }
both({ q: -2, r: 0 }, floor); both({ q: -2, r: 1 }, (c) => { if (c.t === 'lava') c.t = 'grass'; });
// The north span (mirror: south span): one hex wide.
const northSpan = [at(9, 4), at(10, 4)].filter((h) => cell(h).t === 'lava');
const lavaRow = (row) => data.cells.filter((c) => c.t === 'lava' && c.r === row - r0 && c.q + c.r / 2 < 0.5).sort((a, b) => a.q - b.q);
const spanRow = 3, spanCells = lavaRow(spanRow);
for (const c of spanCells) both(c, (x) => { x.t = 'grass'; x.e = 0; });
// The side tunnel's arch over the lava.


// Cover and colour: rubble, fungus, stalagmites, and stalactites over part of the lava so flyers can't cross just anywhere.
set([[5, 6], [12, 9]], (c) => { if (c.t === 'grass') c.t = 'ruins'; });
set([[6, 7], [12, 5], [7, 2], [3, 9], [8, 12]], (c) => { if (c.t === 'grass') c.t = 'forest'; });
set([[8, 5], [13, 5], [4, 4]], (c) => { if (c.t === 'grass') c.t = 'spikes'; });
set([[8, 4], [8, 6], [12, 4]], (c) => { if (c.t === 'grass') c.t = 'grass'; });
// A ledge at the back of each hall.
set(span(1, 1, 5, 9), (c) => { if (c.t !== 'rock') c.e = 1; });

// Drop cells with no mirror image; make the rest exactly symmetric (west half is the master).
data.cells = data.cells.filter((c) => cells.has(key(-c.q, -c.r)));
cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
for (const c of data.cells) { const m = cell(mir(c)); if (c.q > 0 || (c.q === 0 && c.r > 0)) { c.t = m.t; c.e = m.e; } }

data.spawns = [0, 1].map((t) => [5, 6, 7, 8, 9].map((row) => { const h = at(row === 7 ? 3 : 2, row); return t ? mir(h) : h; }));
for (const list of data.spawns) for (const s of list) { const c = cell(s); c.t = 'grass'; }
data.name = 'emberflow';
data.ceiling = true;
data.monsters = ['spider', 'bat', 'worm'];
const ns = spanCells[0] ? { q: spanCells[0].q, r: spanCells[0].r } : at(9, 4);
data.objectives = [origin, ns, mir(ns)];
data.wild = [{ ...ns, cls: 'spider' }, { ...mir(ns), cls: 'spider' }];

const map = mapFromData(data);
console.log('cells', data.cells.length, 'problem:', mapProblem(map), 'span cells', spanCells.length);
const f0 = E.distanceField(map, map.spawns[0]), f1 = E.distanceField(map, map.spawns[1]);
console.log('objective costs blue/red:', JSON.stringify(data.objectives.map((o) => [f0.get(key(o.q, o.r)), f1.get(key(o.q, o.r))])));
console.log('blue to red spawn:', Math.min(...map.spawns[1].map((s) => f0.get(key(s.q, s.r)))), 'unreachable floor:', data.cells.filter((c) => !E.impassable(c) && !f0.has(key(c.q, c.r))).length);
const count = {}; for (const c of data.cells) count[c.t] = (count[c.t] || 0) + 1; console.log(JSON.stringify(count));
const G = { grass: '.', forest: 'f', ruins: '#', water: '~', rock: ' ', spikes: '^', stalactites: 'v', lava: '%' };
const sp = new Map(); map.spawns.forEach((l, t) => l.forEach((s) => sp.set(key(s.q, s.r), 'BR'[t])));
const ob = new Set(data.objectives.map((o) => key(o.q, o.r))), wd = new Set(data.wild.map((o) => key(o.q, o.r)));
for (let row = 0; row < ROWS; row++) {
  let ln = row % 2 ? ' ' : '';
  for (let col = 0; col < COLS; col++) { const h = at(col, row), c = cell(h), k = key(h.q, h.r); if (!c) { ln += '  '; continue; } ln += (sp.get(k) || (wd.has(k) ? 'S' : ob.has(k) ? '*' : G[c.t])) + (c.e || ' '); }
  console.log('|' + ln + '|');
}
const g = E.createGame(map, { dragons: 'both' });
console.log('units', g.units.length, 'all fit', g.units.every((u) => E.fits(g, u)), 'rounds', g.maxRounds,
  'symmetric', data.cells.every((c) => { const m = cell(mir(c)); return m && m.t === c.t && m.e === c.e; }));
function roam(u, goal) { const seen = new Set([E.posKey({ q: u.q, r: u.r, o: u.o })]); let fr = [{ ...u }];
  for (let t = 1; t <= 20; t++) { const nx = []; for (const p of fr) for (const n of E.reachable({ ...g, units: [p] }, p).values()) { const k = E.posKey(n); if (!n.stop || seen.has(k)) continue; seen.add(k); if (E.footprint(u, n).some((c) => c.q === goal.q && c.r === goal.r)) return t; nx.push({ ...u, q: n.q, r: n.r, o: n.o }); } fr = nx; } return Infinity; }
const foe = g.units.find((x) => x.cls === 'archer' && x.team === 1);
for (const cls of ['dragon', 'ogre', 'worm', 'bat', 'scout', 'soldier']) { const u = g.units.find((x) => x.cls === cls && x.team === 0);
  console.log(cls.padEnd(8), 'turns to: centre', roam(u, origin), ' north span', roam(u, ns), ' enemy archer', roam(u, foe)); }
// Settings added later in the map editor, kept here so this script reproduces the saved map.
data.biome = "cave";
// Keep the painted background the saved map points at (repaint it in the editor if the terrain changed).
{ const fs = await import('node:fs'); const old = fs.existsSync(root + 'maps/emberflow.json') ? JSON.parse(fs.readFileSync(root + 'maps/emberflow.json', 'utf8')) : {};
  if (old.version !== undefined) data.version = old.version; if (old.backdrop) data.backdrop = old.backdrop;
  fs.writeFileSync(process.env.OUT || root + 'maps/emberflow.json', JSON.stringify(data)); }
