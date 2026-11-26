// "frostmere": a frozen lake with a ruined island fort in the middle, pine woods and ridges around it.
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/^[/]([A-Za-z]:)/, '$1');
const { rectBoard, mapFromData, mapProblem } = await import(pathToFileURL(root + 'src/mapgen.js').href);
const E = await import(pathToFileURL(root + 'src/engine.js').href);
const { dist, key } = await import(pathToFileURL(root + 'src/hex.js').href);

const COLS = 17, ROWS = 13, r0 = 6, c0 = 8;
const data = rectBoard(COLS, ROWS);
const cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
const at = (col, row) => ({ q: col - c0 - Math.floor((row - r0 - ((row - r0) & 1)) / 2), r: row - r0 });
const both = (h, fn) => { for (const p of [h, { q: -h.q, r: -h.r }]) { const c = cells.get(key(p.q, p.r)); if (c) fn(c); } };
const origin = { q: 0, r: 0 };

// The lake: everything within 3 of the centre, slightly ragged; the island fort inside it.
for (const c of data.cells) {
  const d = dist(c, origin);
  if (d <= 3 && !(d === 3 && (c.q === 3 || c.q === -3 || c.r === 3 || c.r === -3) && (c.q + c.r) % 2)) c.t = 'water';
}
for (const c of data.cells) if (dist(c, origin) <= 1) { c.t = 'ruins'; c.e = 0; }
cells.get(key(0, 0)).e = 1;                                   // the keep's raised centre
// Two causeways onto the island, from the west and the east.
for (const h of [{ q: -2, r: 0 }, { q: -3, r: 0 }]) both(h, (c) => { c.t = 'ruins'; });

// Ridges north-west / south-east, with a cliff face toward the lake and a gentle back slope.
for (const [col, row, e] of [[3, 1, 2], [4, 1, 2], [4, 2, 2], [3, 2, 1], [2, 1, 1], [5, 1, 1], [3, 0, 1], [4, 0, 1]]) both(at(col, row), (c) => { c.e = e; });
// Low rises south-west / north-east.
for (const [col, row] of [[3, 10], [4, 10], [3, 11], [4, 11]]) both(at(col, row), (c) => { c.e = 1; });
// Pine woods.
for (const [col, row] of [[0, 0], [1, 0], [0, 1], [1, 2], [6, 0], [7, 0], [6, 1], [2, 5], [3, 6], [2, 7], [5, 11], [6, 12], [6, 11], [0, 11], [0, 12], [1, 12]]) both(at(col, row), (c) => { if (c.t === 'grass') c.t = 'forest'; });
// Boulders.
for (const [col, row] of [[5, 3], [2, 9], [6, 9], [4, 5], [7, 2]]) both(at(col, row), (c) => { if (c.t === 'grass') c.t = 'rock'; });
// Spawns stay on open flat ground.
for (const list of data.spawns) for (const s of list) { const c = cells.get(key(s.q, s.r)); c.t = 'grass'; c.e = 0; }

data.name = 'frostmere';
const map = mapFromData(data);
console.log('problem:', mapProblem(map));
const start = map.spawns[0][0], goal = map.spawns[1][0];
console.log('travel cost blue->red spawn:', E.distanceField(map, [start]).get(key(goal.q, goal.r)));
const count = {}; for (const c of data.cells) count[c.t] = (count[c.t] || 0) + 1; console.log(count);
// Settings added later in the map editor, kept here so this script reproduces the saved map.
data.objectives = [{"q":0,"r":0},{"q":3,"r":-6},{"q":-3,"r":6}];
data.ceiling = false;
data.biome = "snow";
data.art = "portrait";
// Keep the painted background the saved map points at (repaint it in the editor if the terrain changed).
{ const fs = await import('node:fs'); const old = fs.existsSync(root + 'maps/frostmere.json') ? JSON.parse(fs.readFileSync(root + 'maps/frostmere.json', 'utf8')) : {};
  if (old.version !== undefined) data.version = old.version; if (old.backdrop) data.backdrop = old.backdrop;
  fs.writeFileSync(process.env.OUT || root + 'maps/frostmere.json', JSON.stringify(data)); }
