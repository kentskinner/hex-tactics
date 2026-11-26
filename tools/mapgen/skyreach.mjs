// "skyreach": an asymmetric siege up a mountainside in the snow (23 x 15). Blue starts in the valley
// in the south-west and must climb — by the switchback road, or by the goat path past the yeti's
// den — to an abbey on the summit in the north-east, which Red holds from above.
//   node tools/mapgen/skyreach.mjs [rounds] [attackers] [defenders]
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/^[/]([A-Za-z]:)/, '$1');
const { rectBoard, mapFromData, mapProblem } = await import(pathToFileURL(root + 'src/mapgen.js').href);
const E = await import(pathToFileURL(root + 'src/engine.js').href);
const { key, dist, hexRound } = await import(pathToFileURL(root + 'src/hex.js').href);
const [rounds = 20, nAtt = 10, nDef = 6] = process.argv.slice(2).map(Number);

const COLS = 23, ROWS = 15, r0 = 7, c0 = 11;
const data = rectBoard(COLS, ROWS);
const cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
const at = (col, row) => ({ q: col - c0 - Math.floor((row - r0 - ((row - r0) & 1)) / 2), r: row - r0 });
const cell = (col, row) => { const h = at(col, row); return cells.get(key(h.q, h.r)); };
const set = (list, fn) => { for (const [col, row] of list) { const c = cell(col, row); if (c) fn(c); } };
const line = (a, b) => { const p = at(...a), q = at(...b), n = dist(p, q), out = []; for (let i = 0; i <= n; i++) out.push(hexRound(p.q + (q.q - p.q) * (i / Math.max(1, n)) + 1e-6, p.r + (q.r - p.r) * (i / Math.max(1, n)) + 2e-6)); return out; };
const colRow = new Map(); for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) colRow.set(cell(col, row), [col, row]);
for (const c of data.cells) { c.t = 'grass'; c.e = 0; }

// The slope: up from the south-west corner to the north-east, in four terraces.
for (const [c, [col, row]] of colRow) {
  const t = (col + (row & 1 ? 0.5 : 0)) / 22 * 0.62 + (14 - row) / 14 * 0.38;
  c.e = Math.max(0, Math.min(3, Math.round(t * 3.7 - 0.35 + 0.25 * Math.sin(col * 1.3 + row * 0.9))));
}
// Crags along the terrace edges, broken by gaps: the ways up.
for (const [c, [col, row]] of colRow) {
  const up = [[1, 0], [0, -1], [1, -1]].some(([dq, dr]) => { const n = cells.get(key(c.q + dq, c.r + dr)); return n && n.e > c.e; });
  if (up && c.e >= 1 && ((col * 5 + row * 3) % 9) < 7) c.t = 'rock';
}
// Pine woods on the lower slopes; a frozen tarn and the beck that runs out of it; ice pinnacles on the goat path.
for (const [col, row, rad] of [[3, 9, 1], [6, 12, 1], [8, 7, 1], [2, 5, 1], [11, 12, 1], [5, 3, 0], [10, 3, 0], [14, 9, 0], [16, 13, 0]]) {
  for (const c of data.cells) if (dist(c, at(col, row)) <= rad && c.t === 'grass') c.t = 'forest';
}
set([[5, 6], [6, 6], [5, 7]], (c) => { c.t = 'water'; });
for (const h of line([5, 7], [3, 11])) { const c = cells.get(key(h.q, h.r)); if (c) c.t = 'water'; }
set([[3, 12], [2, 13], [2, 14]], (c) => { c.t = 'water'; });
set([[13, 11], [14, 12], [16, 10], [12, 8]], (c) => { c.t = 'spikes'; });
// The yeti's den, half-way up the goat path.
set([[15, 11]], (c) => { c.t = 'ruins'; });
set([[14, 11], [15, 10], [16, 11], [15, 12]], (c) => { if (c.t === 'rock') c.t = 'grass'; });
// The switchback road from the valley to the abbey gate. It clears the crags it crosses.
const way = [[0, 13], [5, 13], [9, 11], [7, 8], [10, 6], [14, 7], [16, 5], [18, 4]];
for (let i = 1; i < way.length; i++) for (const h of line(way[i - 1], way[i])) { const c = cells.get(key(h.q, h.r)); if (c) c.t = 'road'; }
// The abbey on the summit: a bell tower, a long hall, a cell block, and a broken wall facing the climb.
for (const c of data.cells) if (dist(c, at(19, 3)) <= 2) { c.e = 3; if (c.t === 'rock' || c.t === 'forest') c.t = 'grass'; }
set([[20, 2]], (c) => { c.t = 'tower'; });
set([[18, 2], [19, 2], [20, 4], [21, 4], [21, 3]], (c) => { c.t = 'house'; });
set([[17, 3], [17, 5], [18, 5], [16, 4]], (c) => { if (c.t !== 'road') c.t = 'ruins'; });
set([[19, 3], [19, 4]], (c) => { c.t = 'road'; });
// A bridge where the road crosses the beck.
for (const c of data.cells) if (c.t === 'road' && [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]].filter(([dq, dr]) => cells.get(key(c.q + dq, c.r + dr))?.t === 'water').length >= 2) c.t = 'ruins';

const attackers = [[1, 12, 'soldier'], [1, 14, 'ogre'], [2, 12, 'soldier'], [0, 12, 'archer'], [1, 11, 'wizard'], [3, 13, 'scout'], [0, 14, 'cleric'], [2, 11, 'archer'], [3, 14, 'soldier'], [0, 11, 'catapult'], [4, 12, 'scout'], [4, 14, 'ogre']].slice(0, nAtt);
const defenders = [[17, 4, 'archer'], [18, 5, 'archer'], [18, 3, 'soldier'], [19, 4, 'wizard'], [18, 4, 'soldier'], [20, 3, 'cleric'], [16, 5, 'scout'], [20, 5, 'ogre']].slice(0, nDef);
const mk = (list) => list.map(([col, row, cls]) => ({ ...at(col, row), cls }));
data.spawns = [mk(attackers), mk(defenders)];
for (const s of data.spawns[0]) { const c = cells.get(key(s.q, s.r)); if (c.t !== 'road') c.t = 'grass'; c.e = 0; }
for (const s of data.spawns[1]) { const c = cells.get(key(s.q, s.r)); if (c.t === 'rock' || c.t === 'house' || c.t === 'tower') c.t = 'grass'; }

data.name = 'skyreach';
data.biome = 'snow';
data.art = 'portrait';
data.objectives = [at(19, 3)];
data.siege = { defender: 1, target: 2, rounds };
data.wild = [{ ...at(15, 11), cls: 'troll' }];
const map = mapFromData(data);
console.log('cells', data.cells.length, 'problem:', mapProblem(map), 'siege', JSON.stringify(data.siege), 'armies', attackers.length, 'v', defenders.length);
const f0 = E.distanceField(map, map.spawns[0]);
console.log('travel to the abbey:', f0.get(key(data.objectives[0].q, data.objectives[0].r)), 'unreachable ground:', data.cells.filter((c) => !E.impassable(c) && !f0.has(key(c.q, c.r))).length,
  'yeti to nearest defender', Math.min(...data.spawns[1].map((p) => dist(p, data.wild[0]))));
const G = { grass: '.', forest: 'f', ruins: '#', water: '~', rock: 'X', spikes: '^', house: 'H', road: '=', tower: 'T' };
const sp = new Map(); map.spawns.forEach((l, t) => l.forEach((s) => sp.set(key(s.q, s.r), t ? 'r' : 'B'))); sp.set(key(data.wild[0].q, data.wild[0].r), 'Y');
if (!process.env.QUIET) for (let row = 0; row < ROWS; row++) {
  let ln = row % 2 ? ' ' : '';
  for (let col = 0; col < COLS; col++) { const c = cell(col, row), k = key(c.q, c.r); ln += (sp.get(k) || G[c.t]) + (c.e || ' '); }
  console.log(ln);
}
const g = E.createGame(map);
console.log('mode', g.mode, 'rounds', g.maxRounds, 'all fit', g.units.every((u) => E.fits(g, u)), 'units', g.units.length);
// Settings added later in the map editor, kept here so this script reproduces the saved map.
data.ceiling = false;
// Keep the painted background the saved map points at (repaint it in the editor if the terrain changed).
{ const fs = await import('node:fs'); const old = fs.existsSync(root + 'maps/skyreach.json') ? JSON.parse(fs.readFileSync(root + 'maps/skyreach.json', 'utf8')) : {};
  if (old.version !== undefined) data.version = old.version; if (old.backdrop) data.backdrop = old.backdrop;
  fs.writeFileSync(process.env.OUT || root + 'maps/skyreach.json', JSON.stringify(data)); }
