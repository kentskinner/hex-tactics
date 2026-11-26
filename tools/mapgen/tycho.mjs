// "tycho": a vast alien world (37 x 23). The humans' base — modules, a comms tower, a landing field —
// is in the west; the aliens' nesting ground is in the east; between them lie mesas, acid lakes,
// crystal fields, fronded hollows, and in the very middle a crashed starship ringed by acid.
// The ground is the same for both (a half-turn copy), with the base's buildings answered by
// nest mounds; the armies are different.
//   node tools/mapgen/tycho.mjs [stalkers] [marines]
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/^[/]([A-Za-z]:)/, '$1');
const { rectBoard, mapFromData, mapProblem } = await import(pathToFileURL(root + 'src/mapgen.js').href);
const E = await import(pathToFileURL(root + 'src/engine.js').href);
const { dist, key, DIRS, hexRound } = await import(pathToFileURL(root + 'src/hex.js').href);
const [nStalk = 11, nMar = 6] = process.argv.slice(2).map(Number);

const COLS = 37, ROWS = 23, r0 = 11, c0 = 18;
const data = rectBoard(COLS, ROWS);
const cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
const at = (col, row) => ({ q: col - c0 - Math.floor((row - r0 - ((row - r0) & 1)) / 2), r: row - r0 });
const cell = (h) => cells.get(key(h.q, h.r));
const set = (list, fn) => { for (const [col, row] of list) { const c = cell(at(col, row)); if (c) fn(c); } };
const disc = (col, row, rad) => data.cells.filter((c) => dist(c, at(col, row)) <= rad);
const line = (a, b) => { const p = at(...a), q = at(...b), n = dist(p, q), out = []; for (let i = 0; i <= n; i++) out.push(hexRound(p.q + (q.q - p.q) * (i / Math.max(1, n)) + 1e-6, p.r + (q.r - p.r) * (i / Math.max(1, n)) + 2e-6)); return out; };
const origin = { q: 0, r: 0 };
for (const c of data.cells) { c.t = 'grass'; c.e = 0; }

// ---- The west half is the master copy. ----
// Mesas.
for (const [col, row, h, rad] of [[10, 5, 3.3, 4], [9, 17, 2.8, 3.6], [15, 1, 2.2, 3], [3, 2, 1.8, 2.6], [15, 21, 2, 2.8], [2, 20, 1.6, 2.4]]) {
  for (const c of data.cells) c.e = Math.max(c.e, Math.max(0, Math.min(3, Math.round(h * (1 - dist(c, at(col, row)) / rad)))));
}
// Acid: a lake below the northern mesa, pools in the south, and most of a ring round the crash site.
for (const [col, row, rad] of [[13, 9, 1], [6, 20, 1]]) for (const c of disc(col, row, rad)) { c.t = 'water'; c.e = 0; }
set([[12, 14], [13, 14], [12, 15], [7, 6], [1, 16]], (c) => { c.t = 'water'; c.e = 0; });
for (const c of data.cells) { const d = dist(c, origin); if (d === 3 && c.q + 2 * c.r < 0 && Math.abs(c.r) !== 3 - (c.q > 0)) { c.t = 'water'; c.e = 0; } if (d <= 2) c.e = Math.min(c.e, 1); }
// Fronded hollows, crystal fields, rock.
for (const [col, row, rad] of [[6, 11, 0], [8, 13, 1], [12, 12, 1], [16, 6, 1], [5, 5, 1], [14, 18, 1], [11, 21, 1], [17, 15, 0], [9, 9, 0], [1, 7, 0]]) {
  for (const c of disc(col, row, rad)) if (c.t === 'grass') c.t = 'forest';
}
set([[11, 11], [12, 10], [10, 14], [15, 13], [16, 12], [7, 2], [8, 3], [13, 5], [4, 17], [5, 18], [16, 17]], (c) => { if (c.t === 'grass') c.t = 'spikes'; });
set([[9, 12], [14, 7], [13, 16], [7, 8], [6, 15], [11, 2], [16, 9], [3, 6], [17, 19], [12, 19], [0, 3], [10, 20], [15, 4]], (c) => { if (c.t === 'grass') c.t = 'rock'; });
// Wreckage thrown clear of the ship.
set([[14, 11], [15, 9], [13, 12], [16, 14], [10, 8], [9, 15]], (c) => { if (c.t === 'grass') c.t = 'ruins'; });
// The base: a long module, a hub of three, three singles, a comms tower, cargo, and the road out.
set([[2, 9], [3, 9], [2, 13], [3, 13], [3, 14], [5, 8], [5, 15], [1, 11]], (c) => { c.t = 'house'; c.e = 0; });
set([[4, 12]], (c) => { c.t = 'tower'; c.e = 0; });
set([[6, 9], [6, 13], [4, 16], [7, 11]], (c) => { if (c.t === 'grass' || c.t === 'forest') { c.t = 'ruins'; c.e = 0; } });
for (const h of [...line([2, 10], [3, 12]), ...line([2, 11], [4, 11]), ...line([4, 11], [9, 11]), ...line([9, 11], [13, 11]), ...line([13, 11], [15, 11])]) {
  const c = cell(h); if (c && c.t !== 'water' && c.t !== 'house' && c.t !== 'tower') { c.t = 'road'; c.e = Math.min(c.e, 1); }
}
// A research post on the northern mesa.
set([[11, 4]], (c) => { c.t = 'house'; });
set([[12, 4], [11, 5]], (c) => { c.t = 'ruins'; });

// ---- The east half: a half-turn copy, with buildings answered by nest mounds. ----
for (const c of data.cells) {
  const m = cells.get(key(-c.q, -c.r));
  if (!m) { c.drop = true; continue; }
  if (c.q > 0 || (c.q === 0 && c.r > 0)) { c.e = m.e; c.t = m.t === 'house' ? 'ruins' : m.t === 'tower' ? 'spikes' : m.t === 'road' ? 'grass' : m.t; }
}
data.cells = data.cells.filter((c) => !c.drop);
for (const [k, c] of [...cells]) if (c.drop) cells.delete(k);
// The crashed starship.
for (const c of data.cells) if (dist(c, origin) <= 1) { c.t = 'ruins'; c.e = 1; }
set([[18, 9], [19, 13], [16, 11], [20, 11]], (c) => { if (c.t !== 'water') { c.t = 'ruins'; } });
// Fronds thick around the nest.
for (const [col, row, rad] of [[33, 9, 1], [33, 14, 1], [31, 11, 0], [35, 12, 0]]) for (const c of disc(col, row, rad)) if (c.t === 'grass' || c.t === 'ruins') c.t = 'forest';

const pick = (list, cls, n) => list.filter(([, , k], i, all) => k !== cls || all.slice(0, i).filter((x) => x[2] === cls).length < n);
const blue = pick([[5, 11, 'mech'], [5, 13, 'mech'], [6, 10, 'marine'], [6, 12, 'marine'], [7, 12, 'marine'], [4, 10, 'sniper'], [4, 14, 'sniper'], [7, 10, 'drone'], [7, 13, 'drone'],
  [5, 10, 'marine'], [5, 12, 'marine'], [6, 14, 'marine'], [4, 13, 'marine'], [3, 11, 'marine']], 'marine', nMar);
const red = pick([[31, 10, 'brute'], [31, 13, 'brute'], [33, 11, 'spitter'], [32, 8, 'spitter'], [32, 15, 'spitter'], [30, 11, 'stalker'], [30, 12, 'stalker'], [29, 10, 'stalker'], [29, 13, 'stalker'],
  [30, 9, 'stalker'], [30, 14, 'stalker'], [31, 12, 'stalker'], [29, 11, 'stalker'], [29, 12, 'stalker'], [31, 8, 'stalker'], [31, 15, 'stalker'], [28, 11, 'stalker']], 'stalker', nStalk);
const mk = (list) => list.map(([col, row, cls]) => ({ ...at(col, row), cls }));
data.spawns = [mk(blue), mk(red)];
for (const s of data.spawns.flat()) {
  const c = cell(s); if (c.t !== 'road') c.t = 'grass'; c.e = Math.min(c.e, 1);
  for (const [dq, dr] of DIRS) { const n = cell({ q: s.q + dq, r: s.r + dr }); if (n) n.e = Math.min(n.e, c.e + 1); }
}

data.name = 'tycho';
data.biome = 'alien';
data.scenario = true;
const post = at(12, 5);
data.objectives = [origin, post, { q: -post.q, r: -post.r }];
const map = mapFromData(data);
console.log('cells', data.cells.length, 'problem:', mapProblem(map), 'armies', blue.length, 'v', red.length);
const f0 = E.distanceField(map, map.spawns[0]), f1 = E.distanceField(map, map.spawns[1]);
console.log('objective costs blue/red:', JSON.stringify(data.objectives.map((o) => [f0.get(key(o.q, o.r)), f1.get(key(o.q, o.r))])));
console.log('blue to red:', Math.min(...map.spawns[1].map((s) => f0.get(key(s.q, s.r)))), 'unreachable ground:', data.cells.filter((c) => !E.impassable(c) && !f0.has(key(c.q, c.r))).length);
const count = {}; for (const c of data.cells) count[c.t] = (count[c.t] || 0) + 1; console.log(JSON.stringify(count));
const G = { grass: '.', forest: 'f', ruins: '#', water: '~', rock: 'X', spikes: '^', house: 'H', road: '=', tower: 'T' };
const sp = new Map(); map.spawns.forEach((l, t) => l.forEach((s) => sp.set(key(s.q, s.r), t ? s.cls[1] : s.cls[0].toUpperCase())));
if (!process.env.QUIET) for (let row = 0; row < ROWS; row++) {
  let ln = row % 2 ? ' ' : '';
  for (let col = 0; col < COLS; col++) { const h = at(col, row), c = cell(h); if (!c) { ln += '  '; continue; } ln += (sp.get(key(h.q, h.r)) || G[c.t]) + (c.e || ' '); }
  console.log(ln);
}
const g = E.createGame(map);
console.log('mode', g.mode, 'rounds', g.maxRounds, 'all fit', g.units.every((u) => E.fits(g, u)), 'units', g.units.length);
// Settings added later in the map editor, kept here so this script reproduces the saved map.
data.ceiling = false;
// Keep the painted background the saved map points at (repaint it in the editor if the terrain changed).
{ const fs = await import('node:fs'); const old = fs.existsSync(root + 'maps/tycho.json') ? JSON.parse(fs.readFileSync(root + 'maps/tycho.json', 'utf8')) : {};
  if (old.version !== undefined) data.version = old.version; if (old.backdrop) data.backdrop = old.backdrop;
  fs.writeFileSync(process.env.OUT || root + 'maps/tycho.json', JSON.stringify(data)); }
