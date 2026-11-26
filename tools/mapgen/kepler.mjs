// "kepler": a science-fiction skirmish on an alien world (23 x 15). Blue's marines hold a prefab
// outpost in the west — modules, a landing pad, cargo — and Red's aliens come out of the fronded,
// acid-pooled badlands in the east. Different armies, tuned to an even fight.
//   node tools/mapgen/kepler.mjs [stalkers] [marines]
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/^[/]([A-Za-z]:)/, '$1');
const { rectBoard, mapFromData, mapProblem } = await import(pathToFileURL(root + 'src/mapgen.js').href);
const E = await import(pathToFileURL(root + 'src/engine.js').href);
const { key, dist } = await import(pathToFileURL(root + 'src/hex.js').href);
const [nStalk = 6, nMar = 5] = process.argv.slice(2).map(Number);

const COLS = 23, ROWS = 15, r0 = 7, c0 = 11;
const data = rectBoard(COLS, ROWS);
const cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
const at = (col, row) => ({ q: col - c0 - Math.floor((row - r0 - ((row - r0) & 1)) / 2), r: row - r0 });
const cell = (col, row) => { const h = at(col, row); return cells.get(key(h.q, h.r)); };
const set = (list, fn) => { for (const [col, row] of list) { const c = cell(col, row); if (c) fn(c); } };
const disc = (col, row, rad) => data.cells.filter((c) => dist(c, at(col, row)) <= rad);
for (const c of data.cells) { c.t = 'grass'; c.e = 0; }

// Ground: a mesa in the middle, low ridges north-west and south-east.
for (const [col, row, h, rad] of [[11, 7, 2.4, 2.6], [6, 1, 1.6, 2.2], [16, 13, 1.6, 2.2], [15, 2, 1.4, 2], [7, 12, 1.4, 2]]) {
  for (const c of data.cells) c.e = Math.max(c.e, Math.max(0, Math.min(2, Math.round(h * (1 - dist(c, at(col, row)) / rad)))));
}
// The outpost: habitat modules (a long one, a hub of three, two singles), a landing pad, cargo.
set([[3, 4], [4, 4], [2, 9], [3, 9], [3, 10], [5, 6], [5, 11]], (c) => { c.t = 'house'; c.e = 0; });
set([[2, 6], [3, 6], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7], [3, 8], [4, 5]], (c) => { c.t = 'road'; c.e = 0; });
set([[6, 5], [6, 9], [7, 8], [4, 12], [1, 3]], (c) => { if (c.t === 'grass') { c.t = 'ruins'; c.e = Math.min(c.e, 1); } });
// A crashed lander on the mesa, and wreckage strewn east of it.
set([[11, 7], [12, 6]], (c) => { c.t = 'ruins'; });
set([[14, 8], [10, 4], [12, 11]], (c) => { if (c.t === 'grass') c.t = 'ruins'; });
// The badlands: acid pools, crystal fields, rock, stands of fronds.
set([[16, 5], [17, 5], [17, 6], [15, 10], [16, 10], [9, 10], [9, 3], [20, 12], [20, 2]], (c) => { c.t = 'water'; c.e = 0; });
set([[13, 3], [14, 3], [13, 12], [9, 7], [8, 6], [18, 8], [19, 8]], (c) => { if (c.t === 'grass') c.t = 'spikes'; });
set([[10, 1], [12, 13], [8, 9], [14, 6], [15, 7], [1, 12], [21, 7], [7, 3], [17, 11], [5, 14], [18, 0]], (c) => { if (c.t === 'grass') c.t = 'rock'; });
for (const [col, row, rad] of [[19, 4, 1], [18, 11, 1], [21, 9, 1], [16, 0, 1], [14, 14, 0], [12, 2, 0], [8, 13, 0], [1, 0, 0]]) {
  for (const c of disc(col, row, rad)) if (c.t === 'grass') c.t = 'forest';
}

const blue = [[4, 6, 'mech'], [5, 5, 'marine'], [5, 8, 'marine'], [4, 9, 'marine'], [4, 8, 'sniper'], [6, 6, 'drone'], [4, 10, 'marine'], [5, 9, 'marine'], [6, 8, 'marine']]
  .filter(([, , cls], i, all) => cls !== 'marine' || all.slice(0, i).filter((x) => x[2] === 'marine').length < nMar);
const red = [[19, 7, 'brute'], [20, 5, 'spitter'], [20, 9, 'spitter'], [18, 6, 'stalker'], [18, 9, 'stalker'], [19, 3, 'stalker'], [19, 11, 'stalker'], [17, 7, 'stalker'], [20, 7, 'stalker'], [17, 4, 'stalker'], [17, 10, 'stalker']]
  .filter(([, , cls], i, all) => cls !== 'stalker' || all.slice(0, i).filter((x) => x[2] === 'stalker').length < nStalk);
const mk = (list) => list.map(([col, row, cls]) => ({ ...at(col, row), cls }));
data.spawns = [mk(blue), mk(red)];
for (const s of data.spawns.flat()) { const c = cells.get(key(s.q, s.r)); if (c.t !== 'road') c.t = 'grass'; c.e = Math.min(c.e, 1); }

data.name = 'kepler';
data.biome = 'alien';
data.scenario = true;
data.objectives = [at(11, 7), at(6, 7), at(17, 8)];
const map = mapFromData(data);
console.log('cells', data.cells.length, 'problem:', mapProblem(map), 'armies', blue.length, 'v', red.length);
const f0 = E.distanceField(map, map.spawns[0]);
console.log('blue to red:', Math.min(...map.spawns[1].map((s) => f0.get(key(s.q, s.r)))), 'unreachable ground:', data.cells.filter((c) => !E.impassable(c) && !f0.has(key(c.q, c.r))).length);
const G = { grass: '.', forest: 'f', ruins: '#', water: '~', rock: 'X', spikes: '^', house: 'H', road: '=' };
const sp = new Map(); map.spawns.forEach((l, t) => l.forEach((s) => sp.set(key(s.q, s.r), t ? s.cls[1] : s.cls[0].toUpperCase())));
if (!process.env.QUIET) for (let row = 0; row < ROWS; row++) {
  let ln = row % 2 ? ' ' : '';
  for (let col = 0; col < COLS; col++) { const h = at(col, row), c = cells.get(key(h.q, h.r)), k = key(h.q, h.r); ln += (sp.get(k) || G[c.t]) + (c.e || ' '); }
  console.log(ln);
}
const g = E.createGame(map);
console.log('mode', g.mode, 'rounds', g.maxRounds, 'all fit', g.units.every((u) => E.fits(g, u)), 'units', g.units.length);
// Settings added later in the map editor, kept here so this script reproduces the saved map.
data.ceiling = false;
// Keep the painted background the saved map points at (repaint it in the editor if the terrain changed).
{ const fs = await import('node:fs'); const old = fs.existsSync(root + 'maps/kepler.json') ? JSON.parse(fs.readFileSync(root + 'maps/kepler.json', 'utf8')) : {};
  if (old.version !== undefined) data.version = old.version; if (old.backdrop) data.backdrop = old.backdrop;
  fs.writeFileSync(process.env.OUT || root + 'maps/kepler.json', JSON.stringify(data)); }
