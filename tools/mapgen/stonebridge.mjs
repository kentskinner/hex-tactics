import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
const root = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/^[/]([A-Za-z]:)/, '$1');
const { rectBoard, mapFromData, mapProblem } = await import(pathToFileURL(root + 'src/mapgen.js').href);
const E = await import(pathToFileURL(root + 'src/engine.js').href);
const { dist, key } = await import(pathToFileURL(root + 'src/hex.js').href);

const COLS = 17, ROWS = 13, r0 = 6, c0 = 8;
const data = rectBoard(COLS, ROWS);
const cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
const at = (col, row) => ({ q: col - c0 - Math.floor((row - r0 - ((row - r0) & 1)) / 2), r: row - r0 });
// Apply to a hex and its mirror image through the centre, so both sides get the same ground.
const both = (h, fn) => { for (const p of [h, { q: -h.q, r: -h.r }]) { const c = cells.get(key(p.q, p.r)); if (c) fn(c); } };
const around = (col, row, radius, fn) => { const o = at(col, row); for (const c of data.cells) { const d = dist(c, o); if (d <= radius) both(c, (x) => fn(x, d)); } };

// West hill: a climbable cone. (Mirrors to the south-east.)
around(4, 2, 2, (c, d) => { c.e = Math.max(c.e, 3 - d); });
// South-west mesa: flat top with cliffs, one ramp on its west side. (Mirrors to the north-east.)
around(5, 10, 1, (c) => { c.e = 2; });
both(at(3, 10), (c) => { c.e = 1; });
both(at(4, 9), (c) => { c.e = Math.max(c.e, 1); });
// Woods.
for (const [c, r] of [[1, 0], [2, 0], [2, 1], [3, 0], [0, 1], [5, 5], [6, 5], [5, 6], [1, 11], [2, 11], [2, 12], [1, 12], [3, 12], [6, 2]]) both(at(c, r), (x) => { x.t = 'forest'; });
// Ruined gatehouse on the west bank, and rocks.
for (const [c, r] of [[6, 7], [6, 8], [5, 8]]) both(at(c, r), (x) => { x.t = 'ruins'; });
for (const [c, r] of [[3, 5], [6, 0], [3, 8], [7, 11], [5, 3]]) both(at(c, r), (x) => { x.t = 'rock'; });
// River down the middle, with an old stone causeway at the centre and a shallow gap to the north.
const river = { 0: [8, 9], 1: [8], 2: [8], 3: [7, 8], 4: [7], 5: [7, 8], 6: [8], 7: [8, 9], 8: [9], 9: [8, 9], 10: [8], 11: [8], 12: [7, 8] };
for (const [row, cols] of Object.entries(river)) for (const col of cols) { const c = cells.get(key(at(col, +row).q, at(col, +row).r)); c.t = 'water'; c.e = 0; }
for (const h of [at(8, 6), at(7, 6), at(9, 6)]) { const c = cells.get(key(h.q, h.r)); c.t = 'ruins'; c.e = 0; }
// Spawns: keep them on open flat ground.
for (const list of data.spawns) for (const s of list) { const c = cells.get(key(s.q, s.r)); c.t = 'grass'; c.e = 0; }

data.name = 'stonebridge';
const map = mapFromData(data);
console.log('problem:', mapProblem(map));
// Reachability between the two sides.
const start = map.spawns[0][0], goal = map.spawns[1][0];
const field = E.distanceField(map, [start]);
console.log('travel cost blue->red spawn:', field.get(key(goal.q, goal.r)));
const count = {}; for (const c of data.cells) count[c.t] = (count[c.t] || 0) + 1; console.log(count);
mkdirSync(root + 'maps', { recursive: true });
// Settings added later in the map editor, kept here so this script reproduces the saved map.
data.objectives = [{"q":0,"r":0},{"q":-2,"r":-4},{"q":2,"r":4}];
data.biome = "meadow";
data.art = "portrait";
// Keep the painted background the saved map points at (repaint it in the editor if the terrain changed).
{ const fs = await import('node:fs'); const old = fs.existsSync(root + 'maps/stonebridge.json') ? JSON.parse(fs.readFileSync(root + 'maps/stonebridge.json', 'utf8')) : {};
  if (old.version !== undefined) data.version = old.version; if (old.backdrop) data.backdrop = old.backdrop;
  fs.writeFileSync(process.env.OUT || root + 'maps/stonebridge.json', JSON.stringify(data)); }
