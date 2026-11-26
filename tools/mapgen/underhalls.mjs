// "underhalls": a vast dungeon (37 x 23). Two war parties come in by doors at opposite ends and fight
// through the halls for the throne room in the middle. Each side has an entry hall, a pillared hub,
// a barracks wing and a flooded crypt wing; the wings lead round to two side chambers, north and
// south of the throne room, each with a troll in it. The main way is two hexes wide, so ogres can
// use it; the wings narrow to single doors. A half-turn copy of itself, so the fight is even.
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/^[/]([A-Za-z]:)/, '$1');
const { rectBoard, mapFromData, mapProblem } = await import(pathToFileURL(root + 'src/mapgen.js').href);
const E = await import(pathToFileURL(root + 'src/engine.js').href);
const { key, dist } = await import(pathToFileURL(root + 'src/hex.js').href);

const COLS = 37, ROWS = 23, r0 = 11, c0 = 18;
const data = rectBoard(COLS, ROWS);
const cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
const at = (col, row) => ({ q: col - c0 - Math.floor((row - r0 - ((row - r0) & 1)) / 2), r: row - r0 });
const both = (h, fn) => { for (const p of [h, { q: -h.q, r: -h.r }]) { const c = cells.get(key(p.q, p.r)); if (c) fn(c); } };
const set = (list, fn) => { for (const [col, row] of list) both(at(col, row), fn); };
const span = (c1, c2, r1, r2) => { const out = []; for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push([c, r]); return out; };
const origin = { q: 0, r: 0 };
for (const c of data.cells) { c.t = 'rock'; c.e = 0; }
const dig = (list) => set(list, (c) => { c.t = 'grass'; });

// The west side (the east is its half-turn copy).
dig(span(1, 5, 9, 13));                                            // entry hall
dig(span(6, 8, 11, 12));                                           // the main way, two wide
dig(span(9, 13, 8, 14));                                           // the hub
dig(span(14, 15, 10, 11));                                         // on to the throne room
dig(span(10, 11, 6, 7)); dig(span(7, 13, 2, 5));                   // north: a door, the barracks
dig(span(14, 15, 3, 3));                                           // a narrow way east to the north chamber
dig(span(10, 10, 15, 16)); dig(span(7, 13, 17, 20));               // south: a door, the crypt
dig(span(14, 15, 19, 19));                                         // a narrow way east to the south chamber
dig(span(3, 3, 6, 8)); dig(span(3, 6, 4, 5));                      // a side passage from the entry hall up to the barracks
// The middle.
for (const c of data.cells) if (dist(c, origin) <= 3) c.t = 'grass'; // the throne room
dig(span(16, 20, 1, 4));                                           // the north chamber (its copy is the south chamber)
dig(span(18, 18, 5, 7));                                           // down from it to the throne room

// Furnishings.
set([[10, 10], [12, 10], [10, 13], [12, 13]], (c) => { c.t = 'spikes'; });                       // hub pillars
set([[2, 10], [4, 12], [11, 11], [8, 3], [12, 4], [9, 2], [14, 10]], (c) => { c.t = 'ruins'; });   // barricades, bunks
set([[8, 18], [9, 18], [9, 19], [10, 19], [11, 18], [12, 19]], (c) => { c.t = 'water'; });         // the flooded crypt
set([[7, 20], [13, 17], [10, 20], [13, 20]], (c) => { c.t = 'ruins'; });                           // tombs
set([[17, 2], [19, 3]], (c) => { c.t = 'ruins'; }); set([[16, 4], [20, 1]], (c) => { c.t = 'spikes'; });   // the side chambers
for (const c of data.cells) {                                      // the throne room: lava pits either side of the dais, pillars round it
  const d = dist(c, origin);
  if (d === 0) { c.t = 'ruins'; c.e = 1; } else if (d === 1) c.e = 1;
  if (d === 2 && c.r === 0) c.t = 'grass';
  if (d === 2 && (c.q === 2 && c.r === -2 || c.q === -2 && c.r === 2)) c.t = 'spikes';
  if (d === 2 && (c.q === 0 && Math.abs(c.r) === 2)) c.t = 'lava';
  if (d === 3 && (c.q === 3 && c.r === -3 || c.q === -3 && c.r === 3 || c.q === -3 && c.r === 0 || c.q === 3 && c.r === 0)) c.t = 'grass';
}
for (const c of data.cells) if (dist(c, origin) === 2 && c.t === 'lava') for (const [dq, dr] of [[1, 0], [-1, 0]]) { const n = cells.get(key(c.q + dq, c.r + dr)); if (n && dist(n, origin) === 2) n.t = 'lava'; }

// Drop cells with no copy and make the rest an exact half-turn copy (west is the master).
data.cells = data.cells.filter((c) => cells.has(key(-c.q, -c.r)));
for (const [k, c] of [...cells]) if (!cells.has(key(-c.q, -c.r))) cells.delete(k);
for (const c of data.cells) { const m = cells.get(key(-c.q, -c.r)); if (c.q > 0 || (c.q === 0 && c.r > 0)) { c.t = m.t; c.e = m.e; } }

const army = [[4, 11, 'ogre'], [5, 10, 'soldier'], [5, 12, 'soldier'], [4, 9, 'soldier'], [3, 10, 'archer'], [3, 12, 'archer'], [2, 11, 'wizard'], [2, 12, 'cleric'], [5, 13, 'scout'], [4, 13, 'scout']];
data.spawns = [0, 1].map((t) => army.map(([col, row, cls]) => { const h = at(col, row); return t ? { q: -h.q, r: -h.r, cls } : { ...h, cls }; }));
for (const s of data.spawns.flat()) { const c = cells.get(key(s.q, s.r)); c.t = 'grass'; c.e = 0; }

data.name = 'underhalls';
data.biome = 'dungeon';
data.art = 'portrait';
data.ceiling = true;
data.scenario = true;                                              // no room for dragons down here
const north = at(18, 3), crypt = at(11, 19);
data.objectives = [origin, north, { q: -north.q, r: -north.r }];
data.wild = [{ ...north, cls: 'troll' }, { q: -north.q, r: -north.r, cls: 'troll' }, { ...crypt, cls: 'spider' }, { q: -crypt.q, r: -crypt.r, cls: 'spider' }];
for (const w of data.wild) { const c = cells.get(key(w.q, w.r)); if (c.t !== 'grass') c.t = 'grass'; }
const map = mapFromData(data);
console.log('cells', data.cells.length, 'problem:', mapProblem(map));
const f0 = E.distanceField(map, map.spawns[0]), f1 = E.distanceField(map, map.spawns[1]);
console.log('objective costs blue/red:', JSON.stringify(data.objectives.map((o) => [f0.get(key(o.q, o.r)), f1.get(key(o.q, o.r))])));
console.log('blue to red:', Math.min(...map.spawns[1].map((s) => f0.get(key(s.q, s.r)))), 'unreachable ground:', data.cells.filter((c) => !E.impassable(c) && !f0.has(key(c.q, c.r))).length,
  'floor hexes:', data.cells.filter((c) => !E.impassable(c)).length);
const G = { grass: '.', ruins: '#', water: '~', rock: ' ', spikes: '^', lava: '%' };
const sp = new Map(); map.spawns.forEach((l, t) => l.forEach((s) => sp.set(key(s.q, s.r), 'BR'[t]))); data.wild.forEach((w) => sp.set(key(w.q, w.r), w.cls[0].toUpperCase()));
for (let row = 0; row < ROWS; row++) {
  let ln = row % 2 ? ' ' : '';
  for (let col = 0; col < COLS; col++) { const h = at(col, row), c = cells.get(key(h.q, h.r)); if (!c) { ln += '  '; continue; } ln += (sp.get(key(h.q, h.r)) || G[c.t]) + (c.e || ' '); }
  console.log(ln);
}
const g = E.createGame(map);
const ogre = g.units.find((u) => u.cls === 'ogre' && u.team === 0);
console.log('mode', g.mode, 'rounds', g.maxRounds, 'all fit', g.units.every((u) => E.fits(g, u)), 'units', g.units.length, 'ogre placed', JSON.stringify(E.footprint(ogre)));
// Can the ogre get from its start to the throne room?
{ const seen = new Set([E.posKey({ q: ogre.q, r: ogre.r, o: ogre.o })]); let fr = [{ ...ogre }], turns = Infinity;
  for (let t = 1; t <= 30 && turns === Infinity; t++) { const nx = []; for (const p of fr) for (const n of E.reachable({ ...g, units: [p] }, p).values()) { const k = E.posKey(n); if (!n.stop || seen.has(k)) continue; seen.add(k); if (E.footprint(ogre, n).some((c) => dist(c, origin) <= 1)) turns = t; nx.push({ ...ogre, q: n.q, r: n.r, o: n.o }); } fr = nx; }
  console.log('ogre turns to the dais:', turns); }
// Keep the painted background the saved map points at (repaint it in the editor if the terrain changed).
{ const fs = await import('node:fs'); const old = fs.existsSync(root + 'maps/underhalls.json') ? JSON.parse(fs.readFileSync(root + 'maps/underhalls.json', 'utf8')) : {};
  if (old.version !== undefined) data.version = old.version; if (old.backdrop) data.backdrop = old.backdrop;
  fs.writeFileSync(process.env.OUT || root + 'maps/underhalls.json', JSON.stringify(data)); }
