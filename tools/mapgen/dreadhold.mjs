// "dreadhold": a vast asymmetric dungeon raid (37 x 23). A party of adventurers (Blue) comes in by
// the west door and must clear the whole place out before the round limit. Guard room, barracks and
// flooded crypt in the west; a great hall cut by a lava channel in the middle, with an armoury north
// of it and a troll's den south; then the inner ward, a treasure vault, and the warlord's throne
// room at the far east. Narrow back ways run round the north (armoury to ward) and the south
// (crypt, den, vault, throne room's back door).
//   node tools/mapgen/dreadhold.mjs [rounds] [goblins] [heroes] [warlord is a hero: 1/0]
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/^[/]([A-Za-z]:)/, '$1');
const { rectBoard, mapFromData, mapProblem } = await import(pathToFileURL(root + 'src/mapgen.js').href);
const E = await import(pathToFileURL(root + 'src/engine.js').href);
const { key, dist } = await import(pathToFileURL(root + 'src/hex.js').href);
const [rounds = 30, nGob = 12, nHero = 6, lord = 1] = process.argv.slice(2).map(Number);

const COLS = 37, ROWS = 23, r0 = 11, c0 = 18;
const data = rectBoard(COLS, ROWS);
const cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
const at = (col, row) => ({ q: col - c0 - Math.floor((row - r0 - ((row - r0) & 1)) / 2), r: row - r0 });
const cell = (col, row) => { const h = at(col, row); return cells.get(key(h.q, h.r)); };
const set = (list, fn) => { for (const [col, row] of list) { const c = cell(col, row); if (c) fn(c); } };
const span = (c1, c2, r1, r2) => { const out = []; for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push([c, r]); return out; };
for (const c of data.cells) { c.t = 'rock'; c.e = 0; }
const dig = (list) => set(list, (c) => { c.t = 'grass'; });

dig(span(1, 4, 9, 13));                                     // entry hall
dig(span(5, 6, 11, 12));                                    // the way in
dig(span(7, 11, 8, 14));                                    // guard room
dig(span(9, 9, 6, 7)); dig(span(6, 12, 2, 5));              // door north, barracks
dig(span(9, 9, 15, 16)); dig(span(6, 12, 17, 20));          // door south, the flooded crypt
dig(span(12, 14, 11, 12));                                  // the main way, two wide
dig(span(15, 21, 6, 16));                                   // great hall
dig(span(13, 14, 3, 3)); dig(span(15, 21, 1, 3));           // barracks' back door, the armoury
dig(span(19, 19, 4, 5));                                    // armoury down to the hall
dig(span(13, 15, 19, 19)); dig(span(16, 22, 18, 21));       // crypt's back door, the troll's den
dig(span(20, 20, 17, 17));                                  // den up to the hall
dig(span(22, 24, 11, 12));                                  // on east
dig(span(25, 29, 8, 14));                                   // inner ward
dig(span(22, 27, 2, 2)); dig(span(27, 27, 3, 7));           // the north back way: one hex wide, armoury to ward
dig(span(23, 24, 19, 19)); dig(span(25, 30, 17, 20));       // den on to the treasure vault
dig(span(28, 28, 15, 16));                                  // vault up to the ward
dig(span(30, 30, 11, 12));                                  // the throne room's doors
dig(span(31, 35, 6, 16));                                   // throne room
dig([[31, 17], [31, 18]]);                                  // and its back door from the vault

set(span(18, 18, 6, 16), (c) => { c.t = 'lava'; });         // the lava channel across the hall...
set([[18, 8], [18, 11], [18, 14]], (c) => { c.t = 'ruins'; });   // ...and its three bridges
set([[8, 9], [10, 9], [8, 13], [10, 13], [16, 8], [16, 14], [20, 8], [20, 14], [26, 9], [28, 9], [26, 13], [28, 13], [32, 8], [32, 14], [34, 7], [34, 15]], (c) => { c.t = 'spikes'; });   // pillars
set([[3, 10], [9, 11], [11, 10], [7, 3], [9, 2], [11, 4], [15, 11], [20, 10], [20, 12], [16, 2], [18, 1], [20, 2], [27, 11], [24, 11],
  [26, 18], [28, 19], [29, 17], [27, 20], [18, 20], [21, 19], [32, 11]], (c) => { c.t = 'ruins'; });   // barricades, bunks, racks, chests
set([[7, 18], [8, 18], [8, 19], [10, 18], [11, 19], [10, 20]], (c) => { c.t = 'water'; });   // the flooded crypt
set([[6, 20], [12, 17], [12, 20], [6, 17]], (c) => { c.t = 'ruins'; });                      // tombs
set([[32, 6], [33, 6], [32, 16], [33, 16]], (c) => { c.t = 'lava'; });                       // fire pits in the throne room's corners
set(span(33, 35, 9, 13), (c) => { c.e = 1; });                                               // the dais
set([[35, 11]], (c) => { c.t = 'ruins'; c.e = 1; });                                         // the throne

const heroes = [[3, 11, 'soldier'], [3, 12, 'soldier'], [2, 11, 'cleric'], [1, 11, 'wizard'], [2, 12, 'archer'], [2, 10, 'scout']].slice(0, nHero);
const garrison = [
  [33, 11, 'ogre', !!lord], [34, 10, 'wizard'], [33, 9, 'archer'], [33, 13, 'archer'],          // the warlord and his guard
  [26, 11, 'ogre'],                                                                          // inner ward
  [20, 9, 'archer'], [20, 13, 'archer'],                                                     // great hall, far bank
  [9, 10, 'goblin'], [9, 12, 'goblin'],                                                     // guard room
  [8, 3, 'goblin'], [10, 3, 'goblin'],                                                       // barracks
  [16, 10, 'goblin'], [16, 12, 'goblin'],                                                    // great hall
  [18, 2, 'goblin'],                                                                         // armoury
  [28, 10, 'goblin'], [28, 12, 'goblin'],                                                    // inner ward
  [27, 18, 'goblin'],                                                                        // vault
  [32, 10, 'goblin'], [32, 12, 'goblin'],                                                    // throne room
  [10, 11, 'goblin'], [19, 11, 'goblin'], [28, 18, 'goblin'], [17, 2, 'goblin'], [17, 7, 'goblin'], [17, 15, 'goblin'], [10, 5, 'goblin'], [26, 10, 'goblin']]
  .filter(([, , cls], i, all) => cls !== 'goblin' || all.slice(0, i).filter((x) => x[2] === 'goblin').length < nGob);
data.spawns = [heroes.map(([col, row, cls]) => ({ ...at(col, row), cls, hero: true })), garrison.map(([col, row, cls, hero]) => ({ ...at(col, row), cls, ...(hero ? { hero: true } : {}) }))];
for (const s of data.spawns.flat()) { const c = cells.get(key(s.q, s.r)); if (c.t !== 'grass') c.t = 'grass'; }

data.name = 'dreadhold';
data.biome = 'dungeon';
data.ceiling = true;
data.objectives = [];
data.raid = { defender: 1, rounds };
data.wild = [{ ...at(19, 20), cls: 'troll' }, { ...at(9, 19), cls: 'spider' }];
for (const w of data.wild) { const c = cells.get(key(w.q, w.r)); c.t = 'grass'; }
const map = mapFromData(data);
console.log('cells', data.cells.length, 'problem:', mapProblem(map), 'raid', JSON.stringify(data.raid), 'heroes', heroes.length, 'garrison', garrison.length);
const f0 = E.distanceField(map, map.spawns[0]);
console.log('unreachable ground:', data.cells.filter((c) => !E.impassable(c) && !f0.has(key(c.q, c.r))).length, 'furthest:', Math.max(...f0.values()),
  'floor hexes:', data.cells.filter((c) => !E.impassable(c)).length, 'to the throne:', f0.get(key(at(35, 11).q, at(35, 11).r)));
const G = { grass: '.', ruins: '#', water: '~', rock: ' ', spikes: '^', lava: '%' };
const sp = new Map(); map.spawns.forEach((l, t) => l.forEach((s) => sp.set(key(s.q, s.r), t ? s.cls[0] : s.cls[0].toUpperCase()))); data.wild.forEach((w) => sp.set(key(w.q, w.r), 'X'));
if (!process.env.QUIET) for (let row = 0; row < ROWS; row++) {
  let ln = row % 2 ? ' ' : '';
  for (let col = 0; col < COLS; col++) { const c = cell(col, row); if (!c) { ln += '  '; continue; } const k = key(c.q, c.r); ln += (sp.get(k) || G[c.t]) + (c.e || ' '); }
  console.log(ln);
}
const g = E.createGame(map);
console.log('mode', g.mode, 'defender', g.defender, 'rounds', g.maxRounds, 'all fit', g.units.every((u) => E.fits(g, u)), 'units', g.units.length,
  'hero hp', g.units.filter((u) => u.hero).map((u) => u.cls + ' ' + u.hp).join(', '));
// Keep the painted background the saved map points at (repaint it in the editor if the terrain changed).
{ const fs = await import('node:fs'); const old = fs.existsSync(root + 'maps/dreadhold.json') ? JSON.parse(fs.readFileSync(root + 'maps/dreadhold.json', 'utf8')) : {};
  if (old.version !== undefined) data.version = old.version; if (old.backdrop) data.backdrop = old.backdrop;
  fs.writeFileSync(process.env.OUT || root + 'maps/dreadhold.json', JSON.stringify(data)); }
