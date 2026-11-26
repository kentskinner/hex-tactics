// "goblinwarren": an asymmetric raid (23 x 15, cave). Four heroes (Blue) come in by the west
// entrance and must clear out a goblin colony (Red) before the round limit: a guard room, a
// fungus cavern with a pool to the north, a sleeping den to the south, and the great hall in the
// east where the chief's ogre waits.
//   node tools/mapgen/goblinwarren.mjs [rounds] [goblins]
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/^[/]([A-Za-z]:)/, '$1');
const { rectBoard, mapFromData, mapProblem } = await import(pathToFileURL(root + 'src/mapgen.js').href);
const E = await import(pathToFileURL(root + 'src/engine.js').href);
const { key, dist } = await import(pathToFileURL(root + 'src/hex.js').href);
const [rounds = 24, nGob = 14] = process.argv.slice(2).map(Number);

const COLS = 23, ROWS = 15, r0 = 7, c0 = 11;
const data = rectBoard(COLS, ROWS);
const cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
const at = (col, row) => ({ q: col - c0 - Math.floor((row - r0 - ((row - r0) & 1)) / 2), r: row - r0 });
const cell = (col, row) => { const h = at(col, row); return cells.get(key(h.q, h.r)); };
const set = (list, fn) => { for (const [col, row] of list) { const c = cell(col, row); if (c) fn(c); } };
const span = (c1, c2, r1, r2) => { const out = []; for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push([c, r]); return out; };
for (const c of data.cells) { c.t = 'rock'; c.e = 0; }
const dig = (list) => set(list, (c) => { c.t = 'grass'; });

dig(span(0, 3, 6, 8)); dig([[2, 5], [2, 9]]);                                 // the entrance cave
dig(span(4, 5, 7, 8));                                                        // the way in
dig(span(6, 9, 5, 9)); dig([[7, 4], [8, 10]]);                                // guard room
dig(span(10, 12, 6, 9));                                                      // main tunnel: wide enough for the dragon to come out
dig(span(13, 19, 4, 10)); dig(span(14, 18, 3, 3)); dig(span(14, 18, 11, 11)); // great hall
dig(span(20, 21, 6, 8));                                                      // the chief's hoard
dig([[8, 4], [8, 3], [9, 3]]); dig(span(8, 13, 1, 2)); dig(span(10, 12, 3, 3)); dig([[13, 3]]);      // fungus cavern, north
dig([[8, 11], [9, 11]]); dig(span(7, 12, 12, 13)); dig(span(9, 11, 11, 11)); dig([[13, 12], [13, 11]]);   // sleeping den, south
dig([[5, 5], [5, 4], [6, 3], [7, 2]]);
dig([[2, 10], [2, 11], [3, 11], [2, 12], [3, 12], [3, 13], [4, 13], [4, 12], [5, 13], [6, 13]]);   // the spider's hole: a back way to the den that the goblins shun                                        // a crawlway round the guard room: one hex wide

set([[10, 1], [11, 1], [11, 2]], (c) => { c.t = 'water'; });                  // the pool
set([[9, 2], [13, 2], [12, 3], [7, 6], [14, 4], [14, 10], [10, 13], [4, 12]], (c) => { if (c.t === 'grass') c.t = 'spikes'; });   // stalagmites
set([[7, 8], [9, 6], [11, 8], [15, 6], [15, 8], [9, 12], [12, 12], [20, 7], [3, 7], [3, 11]], (c) => { if (c.t === 'grass') c.t = 'ruins'; });               // rubble, barricades, the hoard
set([[18, 6], [18, 7], [18, 8], [19, 6], [19, 7], [19, 8]], (c) => { c.e = 1; });   // the chief's dais
set([[19, 7]], (c) => { c.t = 'ruins'; });                                    // and his throne
set([[12, 5], [12, 10]], (c) => { c.t = 'rock'; });

const heroes = [[1, 6, 'soldier'], [1, 8, 'cleric'], [0, 7, 'wizard'], [1, 7, 'archer']];
const colony = [[17, 7, 'dragon'], [14, 7, 'ogre'],
  [8, 6, 'goblin'], [8, 8, 'goblin'], [9, 7, 'goblin'],                        // guards
  [16, 4, 'goblin'], [16, 10, 'goblin'], [13, 6, 'goblin'],                     // the chief's own
  [9, 13, 'goblin'], [11, 12, 'goblin'], [10, 11, 'goblin'],                   // the den
  [10, 2, 'goblin'], [12, 2, 'goblin'],                                        // by the pool
  [14, 5, 'goblin'], [14, 9, 'goblin'], [8, 12, 'goblin']].slice(0, nGob + 2);
data.spawns = [heroes.map(([col, row, cls]) => ({ ...at(col, row), cls, hero: true })), colony.map(([col, row, cls]) => ({ ...at(col, row), cls }))];
for (const s of data.spawns.flat()) { const c = cells.get(key(s.q, s.r)); if (c.t !== 'grass' && c.t !== 'ruins') c.t = 'grass'; }

data.name = 'goblinwarren';
data.biome = 'cave';
data.art = 'portrait';
data.ceiling = true;
data.objectives = [];
data.raid = { defender: 1, rounds };
data.wild = [{ ...at(3, 12), cls: 'spider' }];
console.log('spider to nearest goblin', Math.min(...data.spawns[1].map((p) => dist(p, data.wild[0]))), 'to nearest hero', Math.min(...data.spawns[0].map((p) => dist(p, data.wild[0]))));
const map = mapFromData(data);
console.log('cells', data.cells.length, 'problem:', mapProblem(map), 'raid', JSON.stringify(data.raid), 'goblins', colony.length - 2);
const f0 = E.distanceField(map, map.spawns[0]);
console.log('unreachable ground:', data.cells.filter((c) => !E.impassable(c) && !f0.has(key(c.q, c.r))).length, 'furthest:', Math.max(...f0.values()));
const G = { grass: '.', ruins: '#', water: '~', rock: ' ', spikes: '^' };
const sp = new Map(); sp.set(key(data.wild[0].q, data.wild[0].r), 'X'); map.spawns.forEach((l, t) => l.forEach((s) => sp.set(key(s.q, s.r), (t ? s.cls[0] : s.cls[0].toUpperCase()))));
if (!process.env.QUIET) for (let row = 0; row < ROWS; row++) {
  let ln = row % 2 ? ' ' : '';
  for (let col = 0; col < COLS; col++) { const h = at(col, row), c = cells.get(key(h.q, h.r)), k = key(h.q, h.r); ln += (sp.get(k) || G[c.t]) + (c.e || ' '); }
  console.log(ln);
}
const g = E.createGame(map);
console.log('mode', g.mode, 'defender', g.defender, 'rounds', g.maxRounds, 'all fit', g.units.every((u) => E.fits(g, u)), 'units', g.units.length, 'hero hp', g.units.filter((u) => u.hero).map((u) => u.hp).join(','));
// Keep the painted background the saved map points at (repaint it in the editor if the terrain changed).
{ const fs = await import('node:fs'); const old = fs.existsSync(root + 'maps/goblinwarren.json') ? JSON.parse(fs.readFileSync(root + 'maps/goblinwarren.json', 'utf8')) : {};
  if (old.version !== undefined) data.version = old.version; if (old.backdrop) data.backdrop = old.backdrop;
  fs.writeFileSync(process.env.OUT || root + 'maps/goblinwarren.json', JSON.stringify(data)); }
