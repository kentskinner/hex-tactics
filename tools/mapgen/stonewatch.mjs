// "stonewatch": an asymmetric siege (23 x 15, meadow). Red holds a hill fort on the east side: a
// plateau two levels high with sheer sides, a two-hex gate ramp facing west behind a moat, and a
// one-hex postern on the south. Blue attacks from the west with a larger army and must hold the
// keep at the end of two of its turns before the round limit.
//   node tools/mapgen/stonewatch.mjs [rounds] [attackers] [defenders]
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/^[/]([A-Za-z]:)/, '$1');
const { rectBoard, mapFromData, mapProblem } = await import(pathToFileURL(root + 'src/mapgen.js').href);
const E = await import(pathToFileURL(root + 'src/engine.js').href);
const { dist, key } = await import(pathToFileURL(root + 'src/hex.js').href);
const [rounds = 20, nAtt = 14, nDef = 6] = process.argv.slice(2).map(Number);

const COLS = 23, ROWS = 15, r0 = 7, c0 = 11;
const data = rectBoard(COLS, ROWS);
const cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
const at = (col, row) => ({ q: col - c0 - Math.floor((row - r0 - ((row - r0) & 1)) / 2), r: row - r0 });
const cell = (col, row) => { const h = at(col, row); return cells.get(key(h.q, h.r)); };
const set = (list, fn) => { for (const [col, row] of list) { const c = cell(col, row); if (c) fn(c); } };
const span = (c1, c2, r1, r2) => { const out = []; for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push([c, r]); return out; };
for (const c of data.cells) { c.t = 'grass'; c.e = 0; }

// The fort: a plateau with sheer sides.
set(span(15, 21, 3, 11), (c) => { c.e = 2; });
set([[15, 3], [15, 11], [21, 3], [21, 11]], (c) => { c.e = 0; });
set(span(22, 22, 0, 14), (c) => { c.t = 'rock'; });                       // cliffs behind it
set([[21, 2], [21, 12], [20, 2], [20, 12]], (c) => { c.t = 'rock'; });
// Gate ramp (two hexes, so ogres can use it) and the postern (one hex).
set([[14, 7], [14, 8]], (c) => { c.e = 1; });
set([[17, 12]], (c) => { c.e = 1; });
// Battlements along the west and south rims: heavy cover for whoever stands there.
set([[15, 5], [15, 6], [15, 9], [15, 10], [16, 11], [18, 11], [16, 3]], (c) => { c.t = 'ruins'; });
// The keep, one level higher again, at the back.
set([[19, 7]], (c) => { c.t = 'ruins'; c.e = 3; });
set([[19, 6], [20, 7], [19, 8]], (c) => { c.t = 'ruins'; });
// Moat in front of the west wall, broken at the gate.
set([[13, 4], [13, 5], [14, 5], [14, 6], [14, 9], [14, 10], [13, 10], [13, 11]], (c) => { c.t = 'water'; });

// The approach: woods to hide in, a knoll for the attacker's archers, rocks, a ruined farm.
for (const [col, row, rad] of [[6, 3, 1], [9, 11, 1], [4, 12, 1], [10, 5, 1], [11, 13, 1], [8, 0, 1]]) {
  for (const c of data.cells) if (dist(c, at(col, row)) <= rad && c.t === 'grass' && c.e === 0) c.t = 'forest';
}
for (const c of data.cells) { const d = dist(c, at(9, 8)); if (d <= 1 && c.t === 'grass') c.e = d === 0 ? 2 : 1; }
set([[7, 6], [5, 9], [11, 2], [12, 12], [3, 1], [12, 8]], (c) => { if (c.t === 'grass' && c.e === 0) c.t = 'rock'; });
set([[6, 8], [7, 8]], (c) => { if (c.t === 'grass') c.t = 'ruins'; });
set([[16, 13], [17, 14], [13, 1], [14, 2]], (c) => { if (c.t === 'grass' && c.e === 0) c.t = 'forest'; });

// Armies. Blue (attacker), in the west.
const attackers = [[0, 6, 'catapult'], [0, 8, 'catapult'], [1, 5, 'soldier'], [1, 7, 'ogre'], [1, 9, 'soldier'], [2, 4, 'archer'], [2, 6, 'wizard'], [2, 8, 'archer'], [2, 10, 'scout'],
  [3, 5, 'scout'], [3, 9, 'ogre'], [3, 7, 'soldier'], [1, 3, 'archer'], [1, 11, 'soldier']].slice(0, nAtt);
// Red (defender), on the walls and by the gate.
const defenders = [[15, 6, 'archer'], [15, 9, 'archer'], [16, 7, 'soldier'], [17, 7, 'wizard'], [18, 9, 'ogre'], [19, 5, 'catapult'], [16, 8, 'soldier'], [18, 11, 'archer'], [18, 5, 'scout']].slice(0, nDef);
const mk = (list) => list.map(([col, row, cls]) => ({ ...at(col, row), cls }));
data.spawns = [mk(attackers), mk(defenders)];
for (const s of data.spawns[0]) { const c = cells.get(key(s.q, s.r)); c.t = 'grass'; c.e = 0; }

data.name = 'stonewatch';
data.biome = 'meadow';
data.objectives = [at(19, 7)];
data.siege = { defender: 1, target: 2, rounds };
const map = mapFromData(data);
console.log('cells', data.cells.length, 'problem:', mapProblem(map), 'siege', JSON.stringify(data.siege), 'armies', nAtt, 'v', nDef);
const f0 = E.distanceField(map, map.spawns[0]);
console.log('attacker travel to the keep:', f0.get(key(data.objectives[0].q, data.objectives[0].r)), 'unreachable ground:', data.cells.filter((c) => !E.impassable(c) && !f0.has(key(c.q, c.r))).length);
const G = { grass: '.', forest: 'f', ruins: '#', water: '~', rock: 'X' };
const sp = new Map(); map.spawns.forEach((l, t) => l.forEach((s) => sp.set(key(s.q, s.r), (t ? s.cls[0] : s.cls[0].toUpperCase()))));
if (!process.env.QUIET) for (let row = 0; row < ROWS; row++) {
  let ln = row % 2 ? ' ' : '';
  for (let col = 0; col < COLS; col++) { const h = at(col, row), c = cells.get(key(h.q, h.r)), k = key(h.q, h.r); ln += (sp.get(k) || (k === key(data.objectives[0].q, data.objectives[0].r) ? '*' : G[c.t])) + (c.e || ' '); }
  console.log(ln);
}
const g = E.createGame(map);
console.log('mode', g.mode, 'defender', g.defender, 'owners', g.owners, 'target', g.target, 'rounds', g.maxRounds, 'all fit', g.units.every((u) => E.fits(g, u)), 'units', g.units.length);
// Settings added later in the map editor, kept here so this script reproduces the saved map.
data.ceiling = false;
// Keep the painted background the saved map points at (repaint it in the editor if the terrain changed).
{ const fs = await import('node:fs'); const old = fs.existsSync(root + 'maps/stonewatch.json') ? JSON.parse(fs.readFileSync(root + 'maps/stonewatch.json', 'utf8')) : {};
  if (old.version !== undefined) data.version = old.version; if (old.backdrop) data.backdrop = old.backdrop;
  fs.writeFileSync(process.env.OUT || root + 'maps/stonewatch.json', JSON.stringify(data)); }
