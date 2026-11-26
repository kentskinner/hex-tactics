// "deepreach": a vast cave (37 x 23, ceiling). Solid rock with:
//   - an army hall at each end, and a three-wide gallery from each into the great cavern;
//   - the great cavern in the middle, with a ring lake around an island of old stonework;
//   - a fungus grotto (north-west / south-east) and a troll den (south-west / north-east), each
//     linked to its army hall and to the great cavern by one-hex tunnels;
//   - a long one-hex tunnel along the north wall and another along the south, each with a
//     junction room and a spur down into the great cavern.
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/^[/]([A-Za-z]:)/, '$1');
const { rectBoard, mapFromData, mapProblem } = await import(pathToFileURL(root + 'src/mapgen.js').href);
const E = await import(pathToFileURL(root + 'src/engine.js').href);
const { dist, key, DIRS, hexRound } = await import(pathToFileURL(root + 'src/hex.js').href);

const COLS = 37, ROWS = 23, r0 = 11, c0 = 18;
const data = rectBoard(COLS, ROWS);
let cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
const at = (col, row) => ({ q: col - c0 - Math.floor((row - r0 - ((row - r0) & 1)) / 2), r: row - r0 });
const cell = (h) => cells.get(key(h.q, h.r));
const both = (h, fn) => { for (const p of [h, { q: -h.q, r: -h.r }]) { const c = cell(p); if (c) fn(c); } };
const set = (list, fn) => { for (const [col, row] of list) both(at(col, row), fn); };
const origin = { q: 0, r: 0 };
const floor = (c) => { if (c.t === 'rock') { c.t = 'grass'; c.e = 0; } };
const disc = (col, row, rad, fn = floor) => { const o = at(col, row); for (const c of data.cells) if (dist(c, o) <= rad) both(c, fn); };
const line = (a, b, wide = 0, fn = floor) => {
  const p = at(...a), q = at(...b), n = dist(p, q);
  for (let i = 0; i <= n; i++) {
    const h = hexRound(p.q + (q.q - p.q) * (i / Math.max(1, n)) + 1e-6, p.r + (q.r - p.r) * (i / Math.max(1, n)) + 2e-6);
    for (const c of data.cells) if (dist(c, h) <= wide) both(c, fn);
  }
};
const span = (c1, c2, r1, r2) => { const out = []; for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push([c, r]); return out; };

for (const c of data.cells) { c.t = 'rock'; c.e = 0; }

// Army hall (west; the mirror is the east one), a little rounded.
set(span(1, 6, 7, 15), floor);
set([[1, 7], [6, 7], [1, 15], [6, 15]], (c) => { c.t = 'rock'; });
// Gallery into the great cavern: three wide, kept clear for ogres and dragons.
line([6, 11], [13, 11], 1);
// The great cavern.
disc(18, 11, 6);
// Fungus grotto (NW) and troll den (SW).
disc(10, 4, 2); disc(12, 4, 1);
disc(9, 18, 2); disc(11, 18, 1);
// One-hex tunnels: hall <-> grotto <-> cavern, hall <-> den <-> cavern.
line([5, 7], [8, 5]); line([12, 5], [15, 8]);
line([5, 15], [7, 17]); line([11, 17], [14, 14]);
// The long north tunnel (the mirror is the south one), from the grotto to the far den, with a junction room and a spur.
line([11, 2], [11, 1]); line([11, 1], [26, 1]); line([26, 1], [27, 2]);
disc(18, 2, 1);
line([18, 3], [18, 5]);

// ---- inside ----
// Great cavern: an island of old stonework inside a ring lake, with four causeways.
for (const c of data.cells) {
  const d = dist(c, origin);
  if (d <= 1) { c.t = 'ruins'; c.e = 1; }
  else if (d === 3 && c.t !== 'rock') c.t = 'water';
}
for (const [dq, dr] of [[3, 0], [-3, 0], [0, 3], [0, -3], [3, -3], [-3, 3]]) { const c = cell({ q: dq, r: dr }); if (dq !== 3 || dr !== -3) c.t = 'grass'; }
// Stalagmite thickets on the cavern's north-west and south-east shores, stalactites over the other two.
set([[14, 8], [15, 7], [14, 9], [13, 13], [21, 6]], (c) => { if (c.t === 'grass') c.t = 'spikes'; });
set([[15, 15], [16, 16], [14, 14], [22, 8]], (c) => { if (c.t === 'grass') c.t = 'grass'; });
// Fallen pillars where the galleries open into the cavern, and glowing fungus on the shores.
set([[13, 10], [13, 12]], (c) => { c.t = 'ruins'; });
set([[16, 6], [17, 6], [20, 5], [12, 10], [16, 13]], (c) => { if (c.t === 'grass') c.t = 'forest'; });

// Grotto: thick with fungus around a pool, stalactites over the way in from the hall.
set([[9, 3], [10, 3], [11, 5], [9, 5], [12, 4], [10, 5]], (c) => { if (c.t === 'grass') c.t = 'forest'; });
set([[10, 4]], (c) => { c.t = 'ruins'; });
set([[11, 3], [11, 4]], (c) => { if (c.t === 'grass') c.t = 'water'; });
set([[7, 6]], (c) => { if (c.t === 'grass') c.t = 'grass'; });
// Den: a raised shelf ringed with stalagmites.
for (const c of [...data.cells]) if (dist(c, at(9, 18)) <= 1) both(c, (x) => { if (x.t !== 'rock') x.e = 1; });
set([[8, 17], [10, 19], [11, 18], [8, 20]], (c) => { if (c.t === 'grass') c.t = 'spikes'; });
set([[9, 18]], (c) => { c.t = 'ruins'; });
// Tunnels: fungus to hide in, a pool to slow the run, stalactites that keep bats out of a stretch.
set([[14, 1], [22, 1], [18, 4]], (c) => { if (c.t === 'grass') c.t = 'forest'; });
set([[16, 1]], (c) => { if (c.t === 'grass') c.t = 'water'; });
set([[20, 1], [13, 6]], (c) => { if (c.t === 'grass') c.t = 'grass'; });
// Halls: a ledge along the back wall, rubble, a few stalagmites in the corners.
set(span(1, 1, 9, 13), (c) => { if (c.t !== 'rock') c.e = 1; });
set([[5, 9], [5, 13]], (c) => { c.t = 'ruins'; });
set([[2, 7], [2, 15]], (c) => { if (c.t === 'grass') c.t = 'spikes'; });

// Drop cells whose mirror image is off the board, and make the rest exactly symmetric.
data.cells = data.cells.filter((c) => cells.has(key(-c.q, -c.r)));
cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
for (const c of data.cells) { const m = cell({ q: -c.q, r: -c.r }); if (c.q > 0 || (c.q === 0 && c.r > 0)) { c.t = m.t; c.e = m.e; } }

// Armies of ten at the back of each hall.
const ranks = [[2, 8, 'archer'], [2, 10, 'wizard'], [2, 12, 'archer'], [2, 14, 'scout'], [3, 9, 'ogre'],
  [3, 13, 'ogre'], [4, 8, 'soldier'], [4, 11, 'soldier'], [4, 14, 'soldier'], [5, 11, 'scout']];
data.spawns = [0, 1].map((t) => ranks.map(([col, row, cls]) => { const h = at(col, row); return t ? { q: -h.q, r: -h.r, cls } : { q: h.q, r: h.r, cls }; }));
for (const list of data.spawns) for (const s of list) { const c = cell(s); if (c.t !== 'grass') c.t = 'grass'; }

data.name = 'deepreach';
data.ceiling = true;
data.monsters = ['spider', 'bat', 'worm'];
const mir = (h) => ({ q: -h.q, r: -h.r });
const junction = at(18, 2), grotto = at(10, 4), den = at(9, 18);
data.objectives = [origin, junction, mir(junction), grotto, mir(grotto)];
data.wild = [{ ...den, cls: 'troll' }, { ...mir(den), cls: 'troll' }, { ...junction, cls: 'spider' }, { ...mir(junction), cls: 'spider' }];

const map = mapFromData(data);
console.log('cells', data.cells.length, 'problem:', mapProblem(map));
const f0 = E.distanceField(map, map.spawns[0]), f1 = E.distanceField(map, map.spawns[1]);
console.log('objective costs blue/red:', JSON.stringify(data.objectives.map((o) => [f0.get(key(o.q, o.r)), f1.get(key(o.q, o.r))])));
console.log('blue to red spawn:', Math.min(...map.spawns[1].map((s) => f0.get(key(s.q, s.r)))), 'unreachable floor:', data.cells.filter((c) => c.t !== 'rock' && !f0.has(key(c.q, c.r))).length);
const count = {}; for (const c of data.cells) count[c.t] = (count[c.t] || 0) + 1; console.log(JSON.stringify(count));
const G = { grass: '.', forest: 'f', ruins: '#', water: '~', rock: ' ', spikes: '^', stalactites: 'v' };
const sp = new Map(); map.spawns.forEach((l, t) => l.forEach((s) => sp.set(key(s.q, s.r), 'BR'[t])));
const ob = new Set(data.objectives.map((o) => key(o.q, o.r))), wd = new Set(data.wild.map((o) => key(o.q, o.r)));
for (let row = 0; row < ROWS; row++) {
  let ln = row % 2 ? ' ' : '';
  for (let col = 0; col < COLS; col++) { const h = at(col, row), c = cell(h), k = key(h.q, h.r); if (!c) { ln += '  '; continue; } ln += (sp.get(k) || (wd.has(k) ? 'T' : ob.has(k) ? '*' : G[c.t])) + (c.e || (c.t === 'rock' ? ' ' : ' ')); }
  console.log('|' + ln + '|');
}
const g = E.createGame(map, { dragons: 'both' });
console.log('units', g.units.length, 'all fit', g.units.every((u) => E.fits(g, u)), 'rounds', g.maxRounds,
  'symmetric', data.cells.every((c) => { const m = cell({ q: -c.q, r: -c.r }); return m && m.t === c.t && m.e === c.e; }));
function roam(u, goal) { const seen = new Set([E.posKey({ q: u.q, r: u.r, o: u.o })]); let fr = [{ ...u }];
  for (let t = 1; t <= 20; t++) { const nx = []; for (const p of fr) for (const n of E.reachable({ ...g, units: [p] }, p).values()) { const k = E.posKey(n); if (!n.stop || seen.has(k)) continue; seen.add(k); if (E.footprint(u, n).some((c) => c.q === goal.q && c.r === goal.r)) return t; nx.push({ ...u, q: n.q, r: n.r, o: n.o }); } fr = nx; } return Infinity; }
const foe = g.units.find((x) => x.cls === 'archer' && x.team === 1);
for (const cls of ['dragon', 'ogre', 'worm', 'bat', 'scout', 'soldier']) { const u = g.units.find((x) => x.cls === cls && x.team === 0);
  console.log(cls.padEnd(8), 'turns to: centre', roam(u, origin), ' north junction', roam(u, junction), ' grotto', roam(u, grotto), ' den', roam(u, den), ' enemy archer', roam(u, foe)); }
// Settings added later in the map editor, kept here so this script reproduces the saved map.
data.biome = "cave";
// Keep the painted background the saved map points at (repaint it in the editor if the terrain changed).
{ const fs = await import('node:fs'); const old = fs.existsSync(root + 'maps/deepreach.json') ? JSON.parse(fs.readFileSync(root + 'maps/deepreach.json', 'utf8')) : {};
  if (old.version !== undefined) data.version = old.version; if (old.backdrop) data.backdrop = old.backdrop;
  fs.writeFileSync(process.env.OUT || root + 'maps/deepreach.json', JSON.stringify(data)); }
