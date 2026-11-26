// "blackvault": a dungeon (23 x 15). Rooms and corridors cut square into the rock. A party of heroes
// (Blue) comes in by the west door and must break into the vault at the far end and hold it; the
// dungeon's garrison (Red) defends. From the guard room the ways on are the great hall — cut in
// two by a channel of lava with two bridges — a barracks with a narrow back passage round to the
// vault's rear door, and a flooded crypt with something living in it.
//   node tools/mapgen/blackvault.mjs [rounds] [goblins] [heroes]
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/^[/]([A-Za-z]:)/, '$1');
const { rectBoard, mapFromData, mapProblem } = await import(pathToFileURL(root + 'src/mapgen.js').href);
const E = await import(pathToFileURL(root + 'src/engine.js').href);
const { key, dist } = await import(pathToFileURL(root + 'src/hex.js').href);
const [rounds = 20, nGob = 10, nHero = 4] = process.argv.slice(2).map(Number);

const COLS = 23, ROWS = 15, r0 = 7, c0 = 11;
const data = rectBoard(COLS, ROWS);
const cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
const at = (col, row) => ({ q: col - c0 - Math.floor((row - r0 - ((row - r0) & 1)) / 2), r: row - r0 });
const cell = (col, row) => { const h = at(col, row); return cells.get(key(h.q, h.r)); };
const set = (list, fn) => { for (const [col, row] of list) { const c = cell(col, row); if (c) fn(c); } };
const span = (c1, c2, r1, r2) => { const out = []; for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push([c, r]); return out; };
for (const c of data.cells) { c.t = 'rock'; c.e = 0; }
const dig = (list) => set(list, (c) => { c.t = 'grass'; });

dig(span(1, 4, 5, 9));                                   // entry hall
dig(span(5, 6, 7, 7));                                   // corridor
dig(span(7, 10, 5, 9));                                  // guard room
dig([[8, 4], [8, 3]]); dig(span(6, 11, 1, 2));           // door north, barracks
dig(span(12, 18, 1, 1)); dig([[19, 1], [19, 2], [19, 3], [20, 4], [20, 5]]);      // the back passage: one hex wide, round to the vault's rear door
dig([[9, 10]]); dig(span(7, 12, 11, 13));                // door south, the crypt
dig([[13, 12], [14, 11]]);                               // a crawl from the crypt up into the great hall
dig(span(11, 12, 7, 7));                                 // corridor east
dig(span(13, 17, 4, 10));                                // great hall
dig([[18, 7]]); dig(span(19, 21, 6, 8));                 // vault door, the vault

set(span(15, 15, 4, 10), (c) => { c.t = 'lava'; });      // the lava channel across the hall...
set([[15, 5], [15, 9]], (c) => { c.t = 'ruins'; });      // ...and its two bridges
set([[8, 6], [8, 8], [13, 5], [13, 9], [17, 5], [17, 9]], (c) => { c.t = 'spikes'; });     // pillars
set([[3, 6], [9, 7], [10, 1], [7, 2], [16, 7], [14, 7], [19, 7], [21, 6], [21, 8]], (c) => { c.t = 'ruins'; });      // barricades, bunks, chests
set([[8, 12], [9, 12], [10, 12], [9, 13], [11, 13]], (c) => { c.t = 'water'; });                                      // the flooded crypt
set([[7, 11], [12, 11], [12, 13]], (c) => { c.t = 'ruins'; });                                                         // tombs
set([[19, 6], [19, 7], [19, 8], [20, 6], [20, 7], [20, 8], [21, 6], [21, 7], [21, 8]], (c) => { c.e = 1; });           // the vault stands a step up
set([[18, 7]], (c) => { c.e = 0; });

const heroes = [[2, 6, 'soldier'], [2, 8, 'cleric'], [1, 7, 'wizard'], [2, 7, 'archer'], [3, 8, 'scout'], [3, 5, 'soldier']].slice(0, nHero);
const garrison = [[20, 7, 'wizard'], [16, 6, 'archer'], [16, 8, 'archer'], [14, 6, 'ogre'],
  [9, 6, 'goblin'], [9, 8, 'goblin'], [10, 7, 'goblin'], [8, 2, 'goblin'], [10, 2, 'goblin'], [13, 7, 'goblin'], [17, 7, 'goblin'], [19, 6, 'goblin'], [14, 9, 'goblin'], [6, 1, 'goblin']]
  .filter(([, , cls], i, all) => cls !== 'goblin' || all.slice(0, i).filter((x) => x[2] === 'goblin').length < nGob);
data.spawns = [heroes.map(([col, row, cls]) => ({ ...at(col, row), cls, hero: true })), garrison.map(([col, row, cls]) => ({ ...at(col, row), cls }))];
for (const s of data.spawns.flat()) { const c = cells.get(key(s.q, s.r)); if (c.t !== 'grass' && c.t !== 'ruins') c.t = 'grass'; }

data.name = 'blackvault';
data.biome = 'dungeon';
data.art = 'portrait';
data.ceiling = true;
data.objectives = [at(20, 7)];
data.siege = { defender: 1, target: 2, rounds };
data.wild = [{ ...at(10, 13), cls: 'troll' }];
const map = mapFromData(data);
console.log('cells', data.cells.length, 'problem:', mapProblem(map), 'siege', JSON.stringify(data.siege), 'heroes', heroes.length, 'garrison', garrison.length);
const f0 = E.distanceField(map, map.spawns[0]);
console.log('travel to the vault:', f0.get(key(data.objectives[0].q, data.objectives[0].r)), 'unreachable ground:', data.cells.filter((c) => !E.impassable(c) && !f0.has(key(c.q, c.r))).length,
  'troll to nearest defender', Math.min(...data.spawns[1].map((p) => dist(p, data.wild[0]))));
const G = { grass: '.', ruins: '#', water: '~', rock: ' ', spikes: '^', lava: '%' };
const sp = new Map(); map.spawns.forEach((l, t) => l.forEach((s) => sp.set(key(s.q, s.r), t ? s.cls[0] : s.cls[0].toUpperCase()))); sp.set(key(data.wild[0].q, data.wild[0].r), 'T');
if (!process.env.QUIET) for (let row = 0; row < ROWS; row++) {
  let ln = row % 2 ? ' ' : '';
  for (let col = 0; col < COLS; col++) { const c = cell(col, row), k = key(c.q, c.r); ln += (sp.get(k) || G[c.t]) + (c.e || ' '); }
  console.log(ln);
}
const g = E.createGame(map);
console.log('mode', g.mode, 'rounds', g.maxRounds, 'all fit', g.units.every((u) => E.fits(g, u)), 'units', g.units.length);
// Keep the painted background the saved map points at (repaint it in the editor if the terrain changed).
{ const fs = await import('node:fs'); const old = fs.existsSync(root + 'maps/blackvault.json') ? JSON.parse(fs.readFileSync(root + 'maps/blackvault.json', 'utf8')) : {};
  if (old.version !== undefined) data.version = old.version; if (old.backdrop) data.backdrop = old.backdrop;
  fs.writeFileSync(process.env.OUT || root + 'maps/blackvault.json', JSON.stringify(data)); }
