// "sunspire": a desert canyon. A cliff-sided temple mesa in the middle that can only be climbed
// by two ramps (north and south), an oasis with a well toward each side, watch ledges in the
// other two corners, and rock spires that pinch the direct east-west road.
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/^[/]([A-Za-z]:)/, '$1');
const { rectBoard, mapFromData, mapProblem } = await import(pathToFileURL(root + 'src/mapgen.js').href);
const E = await import(pathToFileURL(root + 'src/engine.js').href);
const { dist, key, DIRS } = await import(pathToFileURL(root + 'src/hex.js').href);

const COLS = 17, ROWS = 13, r0 = 6, c0 = 8;
const data = rectBoard(COLS, ROWS);
const cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
const at = (col, row) => ({ q: col - c0 - Math.floor((row - r0 - ((row - r0) & 1)) / 2), r: row - r0 });
const both = (h, fn) => { for (const p of [h, { q: -h.q, r: -h.r }]) { const c = cells.get(key(p.q, p.r)); if (c) fn(c); } };
const origin = { q: 0, r: 0 };
const nb = (h, i) => ({ q: h.q + DIRS[i][0], r: h.r + DIRS[i][1] });

// The temple mesa: two levels up, sheer on every side.
for (const c of data.cells) {
  const d = dist(c, origin);
  if (d <= 2) c.e = 2;
  if (d <= 1) c.t = 'ruins';
}
cells.get(key(0, 0)).e = 3;                                   // the spire itself
// Ramps: north and south only, so both armies have to go around to climb.
for (const h of [{ q: 1, r: -3 }, { q: 2, r: -3 }]) both(h, (c) => { c.e = 1; });
// Fallen blocks on the mesa rim facing each army: cover for whoever gets up there first.
both({ q: -2, r: 0 }, (c) => { c.t = 'ruins'; });

// Oases: a well (ruins) with water on one side and palms on the other. North-west and south-east.
const well = at(4, 2);
both(well, (c) => { c.t = 'ruins'; });
for (const i of [3, 4, 5]) both(nb(well, i), (c) => { c.t = 'water'; });
for (const i of [0, 1, 2]) both(nb(well, i), (c) => { c.t = 'forest'; });
both(nb(nb(well, 4), 4), (c) => { c.t = 'water'; });
both(nb(nb(well, 1), 0), (c) => { c.t = 'forest'; });

// Watch ledges, south-west and north-east: a two-level shelf with a broken tower on top.
for (const [col, row, e] of [[3, 10, 2], [4, 10, 2], [3, 11, 2], [2, 10, 1], [4, 11, 1], [3, 9, 1], [4, 9, 1], [2, 11, 1], [5, 10, 1]]) both(at(col, row), (c) => { c.e = e; });
both(at(3, 10), (c) => { c.t = 'ruins'; });

// Rock spires: a gate on the direct road, and loose ones around the mesa foot.
for (const [col, row] of [[5, 5], [5, 7], [6, 3], [7, 10], [1, 6], [8, 1], [6, 12]]) both(at(col, row), (c) => { if (c.t === 'grass' && c.e === 0) c.t = 'rock'; });
// Low dunes that break up sight lines on the flanks.
for (const [col, row] of [[1, 3], [2, 3], [8, 11], [9, 11]]) both(at(col, row), (c) => { if (c.t === 'grass' && c.e === 0) c.e = 1; });
// Scrub.
for (const [col, row] of [[0, 0], [1, 0], [7, 0], [0, 8], [1, 8], [5, 12], [6, 6]]) both(at(col, row), (c) => { if (c.t === 'grass' && c.e === 0) c.t = 'forest'; });
// Spawns stay on open flat ground.
for (const list of data.spawns) for (const s of list) { const c = cells.get(key(s.q, s.r)); c.t = 'grass'; c.e = 0; }

data.name = 'sunspire';
data.objectives = [{ q: 0, r: 0 }, well, { q: -well.q, r: -well.r }];
const map = mapFromData(data);
console.log('problem:', mapProblem(map));
const start = map.spawns[0][0], goal = map.spawns[1][0];
const field = E.distanceField(map, [start]);
console.log('travel cost blue->red spawn:', field.get(key(goal.q, goal.r)), ' to spire:', field.get('0,0'), ' red to spire:', E.distanceField(map, [goal]).get('0,0'));
for (const t of [0, 1]) console.log('team', t, 'to wells:', data.objectives.slice(1).map((o) => Math.min(...map.spawns[t].map((s) => E.distanceField(map, [s]).get(key(o.q, o.r))))));
const count = {}; for (const c of data.cells) count[c.t] = (count[c.t] || 0) + 1; console.log(count);
const G = { grass: '.', forest: 'f', ruins: '#', water: '~', rock: 'X' };
const sp = new Map(); map.spawns.forEach((l, t) => l.forEach((s) => sp.set(key(s.q, s.r), 'BR'[t])));
for (let row = 0; row < ROWS; row++) {
  let line = row % 2 ? ' ' : '';
  for (let col = 0; col < COLS; col++) { const h = at(col, row), c = cells.get(key(h.q, h.r)); line += c ? (sp.get(key(h.q, h.r)) || G[c.t]) + (c.e || ' ') : '  '; }
  console.log(line);
}
const g = E.createGame(map, { dragons: 'both' });
console.log('dragons:', g.units.filter((u) => u.cls === 'dragon').map((u) => [u.q, u.r, E.fits(g, u)]), 'ogres fit:', g.units.filter((u) => u.cls === 'ogre').every((u) => E.fits(g, u)));
// Settings added later in the map editor, kept here so this script reproduces the saved map.
data.biome = "desert";
// Keep the painted background the saved map points at (repaint it in the editor if the terrain changed).
{ const fs = await import('node:fs'); const old = fs.existsSync(root + 'maps/sunspire.json') ? JSON.parse(fs.readFileSync(root + 'maps/sunspire.json', 'utf8')) : {};
  if (old.version !== undefined) data.version = old.version; if (old.backdrop) data.backdrop = old.backdrop;
  fs.writeFileSync(process.env.OUT || root + 'maps/sunspire.json', JSON.stringify(data)); }
