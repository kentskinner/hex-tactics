// "gullrock": a stretch of coast in the manner of a hand-drawn fantasy atlas (27 x 17, meadow).
// Wooded hills in the north; a coast road joining two fishing hamlets, each behind a stream; a
// headland in the middle with a lighthouse on its height; and to the south the tidal flats —
// shallows anyone can wade, slowly and in the open — with sandbars, sea stacks and a wreck.
// Mirrored left to right, so both sides get the same ground.
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/^[/]([A-Za-z]:)/, '$1');
const { rectBoard, mapFromData, mapProblem } = await import(pathToFileURL(root + 'src/mapgen.js').href);
const E = await import(pathToFileURL(root + 'src/engine.js').href);
const { key, dist } = await import(pathToFileURL(root + 'src/hex.js').href);

const COLS = 27, ROWS = 17, r0 = 8, c0 = 13;
const data = rectBoard(COLS, ROWS);
const cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
const at = (col, row) => ({ q: col - c0 - Math.floor((row - r0 - ((row - r0) & 1)) / 2), r: row - r0 });
const cell = (col, row) => { if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null; const h = at(col, row); return cells.get(key(h.q, h.r)); };
const mcol = (col, row) => (row & 1 ? COLS - 2 - col : COLS - 1 - col);          // the mirror image of a column in that row
const both = (col, row, fn) => { for (const c of new Set([cell(col, row), cell(mcol(col, row), row)])) if (c) fn(c); };
const set = (list, fn) => { for (const [col, row] of list) both(col, row, fn); };
const colRow = new Map(); for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) { const c = cell(col, row); if (c) colRow.set(c, [col, row]); }
for (const c of data.cells) { c.t = 'grass'; c.e = 0; }

// The sea: everything south of a wavering shoreline is tidal shallows, except the headland.
const shore = (col) => 11.2 + 1.1 * Math.sin(col * 0.75) + 0.6 * Math.sin(col * 0.31 + 1);
for (const [c, [col, row]] of colRow) {
  const x = Math.min(col, mcol(col, row));                                        // measured on the west half, mirrored
  const head = Math.abs(col + (row & 1 ? 0.5 : 0) - 13) <= (row <= 12 ? 2.6 : row === 13 ? 1.6 : -1);   // the headland
  if (row > shore(x) && !head) c.t = 'water';
}
// Hills: the northern downs, and the height the lighthouse stands on.
for (const [col, row, h, rad] of [[4, 1, 2.3, 3], [10, 0, 1.8, 2.6], [1, 5, 1.4, 2.2], [13, 2, 1.6, 2.4], [13, 12, 2.2, 3]]) {
  for (const [c, [cc, rr]] of colRow) {
    const d = Math.min(dist(c, at(col, row)), dist(c, at(mcol(col, row), row)));
    if (c.t !== 'water') c.e = Math.max(c.e, Math.max(0, Math.min(col === 13 && row === 12 ? 2 : 3, Math.round(h * (1 - d / rad)))));
  }
}
// Two streams run down from the downs to the sea, one on each side.
const stream = [[7, 0], [7, 1], [8, 2], [8, 3], [8, 4], [8, 5], [9, 6], [9, 7], [9, 8], [8, 9], [8, 10], [8, 11]];
set(stream, (c) => { c.t = 'water'; c.e = 0; });
for (const [col, row] of stream) for (const d of [-1, 1]) both(col + d, row, (c) => { c.e = Math.min(c.e, 1); });
// The coast road, hamlet to hamlet, over a bridge at each stream and through the crossroads below the lighthouse.
const road = []; for (let col = 0; col <= 13; col++) road.push([col, col < 5 ? 8 : col < 9 ? 7 : 8]);
set(road, (c) => { if (c.t !== 'water') { c.t = 'road'; c.e = Math.min(c.e, 1); } });
set([[9, 7]], (c) => { c.t = 'ruins'; c.e = 0; });                               // the bridge
set([[8, 3]], (c) => { c.t = 'grass'; c.e = 0; });                               // a ford higher up
set([[13, 9], [13, 10], [13, 11]], (c) => { c.t = 'road'; });                              // the track up to the light
// The hamlets: cottages, a long boathouse, a hall of three, drying racks and walls.
set([[3, 6], [4, 6], [2, 9], [3, 9], [3, 10], [5, 9], [6, 5], [1, 7]], (c) => { if (c.t !== 'water' && c.t !== 'road') { c.t = 'house'; c.e = 0; } });
set([[5, 6], [4, 10], [6, 9]], (c) => { if (c.t === 'grass') c.t = 'ruins'; });
// The lighthouse on the height, with its walled yard.
set([[13, 12]], (c) => { c.t = 'tower'; c.e = 2; });
set([[12, 12], [12, 11]], (c) => { if (c.t !== 'water') c.t = 'ruins'; });
// Out on the flats: sandbars, sea stacks, and the wreck.
set([[5, 13], [6, 13], [6, 14], [10, 15], [10, 14]], (c) => { c.t = 'grass'; c.e = 0; });
set([[3, 14], [8, 15], [11, 12], [1, 12]], (c) => { c.t = 'rock'; });
set([[9, 13], [9, 14], [13, 15]], (c) => { c.t = 'ruins'; c.e = 0; });
// Woods and outcrops inland.
for (const [col, row, rad] of [[2, 2, 1], [6, 2, 1], [11, 4, 1], [1, 4, 0], [11, 6, 0], [5, 4, 0], [12, 1, 0], [10, 10, 0], [6, 10, 0]]) {
  for (const [c] of colRow) if (Math.min(dist(c, at(col, row)), dist(c, at(mcol(col, row), row))) <= rad && c.t === 'grass') c.t = 'forest';
}
set([[4, 3], [10, 2], [12, 6], [7, 9], [0, 10]], (c) => { if (c.t === 'grass') c.t = 'rock'; });

// Armies of seven by each hamlet.
const army = [[2, 7, 'ogre'], [4, 8, 'soldier'], [4, 7, 'soldier'], [3, 7, 'archer'], [2, 8, 'wizard'], [5, 8, 'scout'], [3, 8, 'cleric']];
data.spawns = [army.map(([col, row, cls]) => ({ ...at(col, row), cls })), army.map(([col, row, cls]) => ({ ...at(mcol(col, row), row), cls }))];
for (const s of data.spawns.flat()) { const c = cells.get(key(s.q, s.r)); if (c.t !== 'road') c.t = 'grass'; c.e = 0; }

data.name = 'gullrock';
data.biome = 'meadow';
data.objectives = [at(13, 12), at(13, 8), at(13, 15)];
const map = mapFromData(data);
console.log('cells', data.cells.length, 'problem:', mapProblem(map));
const f0 = E.distanceField(map, map.spawns[0]), f1 = E.distanceField(map, map.spawns[1]);
console.log('objective costs blue/red:', JSON.stringify(data.objectives.map((o) => [f0.get(key(o.q, o.r)), f1.get(key(o.q, o.r))])));
console.log('blue to red:', Math.min(...map.spawns[1].map((s) => f0.get(key(s.q, s.r)))), 'unreachable ground:', data.cells.filter((c) => !E.impassable(c) && !f0.has(key(c.q, c.r))).length);
const count = {}; for (const c of data.cells) count[c.t] = (count[c.t] || 0) + 1; console.log(JSON.stringify(count));
const G = { grass: '.', forest: 'f', ruins: '#', water: '~', rock: 'X', house: 'H', road: '=', tower: 'T' };
const sp = new Map(); map.spawns.forEach((l, t) => l.forEach((s) => sp.set(key(s.q, s.r), 'BR'[t])));
const ob = new Set(data.objectives.map((o) => key(o.q, o.r)));
for (let row = 0; row < ROWS; row++) {
  let ln = row % 2 ? ' ' : '';
  for (let col = 0; col < COLS; col++) { const c = cell(col, row), k = key(c.q, c.r); ln += (sp.get(k) || (ob.has(k) && c.t !== 'house' ? '*' : G[c.t])) + (c.e || ' '); }
  console.log(ln);
}
const g = E.createGame(map, { dragons: 'both' });
console.log('units', g.units.length, 'all fit', g.units.every((u) => E.fits(g, u)), 'rounds', g.maxRounds);
// Settings added later in the map editor, kept here so this script reproduces the saved map.
data.ceiling = false;
// Keep the painted background the saved map points at (repaint it in the editor if the terrain changed).
{ const fs = await import('node:fs'); const old = fs.existsSync(root + 'maps/gullrock.json') ? JSON.parse(fs.readFileSync(root + 'maps/gullrock.json', 'utf8')) : {};
  if (old.version !== undefined) data.version = old.version; if (old.backdrop) data.backdrop = old.backdrop;
  fs.writeFileSync(process.env.OUT || root + 'maps/gullrock.json', JSON.stringify(data)); }
