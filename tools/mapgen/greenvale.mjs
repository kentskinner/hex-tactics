// "greenvale": a vast meadow valley (37 x 23). A river winds north-south through the middle, crossed
// by a ruined town at the centre and a broken bridge in the north and south. Wooded hills on both
// banks, two rings of standing stones with a troll in each, and armies of ten.
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/^[/]([A-Za-z]:)/, '$1');
const { rectBoard, mapFromData, mapProblem } = await import(pathToFileURL(root + 'src/mapgen.js').href);
const E = await import(pathToFileURL(root + 'src/engine.js').href);
const { dist, key, DIRS, hexRound } = await import(pathToFileURL(root + 'src/hex.js').href);

const COLS = 37, ROWS = 23, r0 = 11, c0 = 18;
const data = rectBoard(COLS, ROWS);
const cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
const at = (col, row) => ({ q: col - c0 - Math.floor((row - r0 - ((row - r0) & 1)) / 2), r: row - r0 });
const cell = (h) => cells.get(key(h.q, h.r));
const both = (h, fn) => { for (const p of [h, { q: -h.q, r: -h.r }]) { const c = cell(p); if (c) fn(c); } };
const set = (list, fn) => { for (const [col, row] of list) both(at(col, row), fn); };
const disc = (col, row, rad) => { const o = at(col, row); return data.cells.filter((c) => dist(c, o) <= rad); };
const origin = { q: 0, r: 0 };

// Hills (west bank; the mirror gives the east bank).
const hills = [[8, 6, 3.4, 4.2], [12, 16, 2.6, 3.4], [4, 19, 2.2, 3], [14, 1, 2.2, 3], [3, 2, 1.8, 2.6]];
for (const c of data.cells) {
  let v = 0;
  for (const [col, row, h, rad] of hills) for (const o of [at(col, row), { q: -at(col, row).q, r: -at(col, row).r }]) v = Math.max(v, h * (1 - dist(c, o) / rad));
  c.e = Math.max(0, Math.min(3, Math.round(v)));
}
// The river: a slow S through the middle, two hexes wide, always on low ground.
const riverCol = (row) => 18 + Math.round(3.2 * Math.sin((r0 - row) / 11 * Math.PI * 1.15));
for (let row = 0; row <= r0; row++) for (const dc of [0, 1]) both(at(riverCol(row) + dc, row), (c) => { c.t = 'water'; c.e = 0; });
// Low banks.
for (const c of data.cells) if (c.t === 'water') for (const [dq, dr] of DIRS) { const n = cell({ q: c.q + dq, r: c.r + dr }); if (n && n.t !== 'water') n.e = Math.min(n.e, 1); }

// Woods.
const woods = [[5, 11, 2], [10, 10, 1], [15, 6, 2], [9, 20, 2], [2, 6, 1], [14, 12, 1], [6, 15, 1], [11, 3, 1], [16, 19, 1]];
for (const [col, row, rad] of woods) for (const c of disc(col, row, rad)) both(c, (x) => { if (x.t === 'grass' && (rad < 2 || (((x.q * 7 + x.r * 13) % 5) + 5) % 5 !== 0)) x.t = 'forest'; });
// Rock outcrops.
set([[7, 9], [13, 8], [3, 14], [10, 13], [16, 15], [6, 1], [12, 21], [1, 20], [15, 10]], (c) => { if (c.t === 'grass') c.t = 'rock'; });

// The town at the centre: broken walls on both banks and a bridge of rubble across the river.
for (const c of data.cells) { const d = dist(c, origin); if (d <= 3) { c.e = 0; if (c.t === 'forest' || c.t === 'rock') c.t = 'grass'; } }
for (const c of data.cells) if (dist(c, origin) <= 1) { c.t = 'ruins'; c.e = 1; }
set([[15, 10], [16, 12], [15, 12], [16, 9]], (c) => { c.t = 'ruins'; c.e = 0; });
// North bridge (the mirror is the south bridge): rubble across the water, a gatehouse on the west bank.
const bridgeRow = 4, bc = riverCol(bridgeRow);
set([[bc, bridgeRow], [bc + 1, bridgeRow]], (c) => { c.t = 'ruins'; c.e = 0; });
set([[bc - 1, bridgeRow], [bc + 2, bridgeRow]], (c) => { c.t = 'grass'; c.e = 0; });
set([[bc - 2, bridgeRow - 1]], (c) => { c.t = 'ruins'; });

// Standing stones: a ring around an old altar, on the way to the north bridge (mirrored in the south-east).
const circle = at(11, 7);
both(circle, (c) => { c.t = 'ruins'; });
for (const [dq, dr] of DIRS) both({ q: circle.q + dq, r: circle.r + dr }, (c) => { if (c.t !== 'water') c.t = 'grass'; });
for (const c of [...data.cells]) if (dist(c, circle) === 2 && (((c.q - circle.q) + 2 * (c.r - circle.r)) % 2 + 2) % 2 === 0) both(c, (x) => { if (x.t !== 'water') x.t = 'spikes'; });

// Roads: the high road from the west edge to the town (mirrored: on to the east edge), with a
// branch up to the north bridge and another down to the south one.
const line = (p, q) => { const n = dist(p, q), out = []; for (let i = 0; i <= n; i++) out.push(hexRound(p.q + (q.q - p.q) * (i / Math.max(1, n)) + 1e-6, p.r + (q.r - p.r) * (i / Math.max(1, n)) + 2e-6)); return out; };
const pave = (hexes) => { for (const h of hexes) both(h, (c) => { if (c.t === 'grass' || c.t === 'forest' || c.t === 'rock') c.t = 'road'; }); };
pave([...line(at(0, 12), at(6, 11)), ...line(at(6, 11), at(11, 12)), ...line(at(11, 12), at(16, 11))]);
const fork = at(11, 12), nbWest = at(bc - 1, bridgeRow), southBridge = { q: -at(bc, bridgeRow).q, r: -at(bc, bridgeRow).r };
pave([...line(fork, at(13, 8)), ...line(at(13, 8), nbWest)]);
pave([...line(fork, at(12, 16)), ...line(at(12, 16), { q: southBridge.q - 2, r: southBridge.r })]);

// A village on the high road, half-way from the edge to the town (mirrored on the east bank): a
// long hall north of the road, a manor south of it, two cottages and a garden wall.
const green = at(8, 11);
for (const c of [...data.cells]) if (dist(c, green) <= 2) both(c, (x) => { if (x.t === 'forest' || x.t === 'rock') x.t = 'grass'; x.e = Math.min(x.e, 1); });
set([[7, 10], [8, 10], [7, 13], [8, 13], [8, 14], [9, 9], [10, 14]], (c) => { if (c.t !== 'road' && c.t !== 'water') c.t = 'house'; });
set([[9, 12]], (c) => { if (c.t === 'grass') c.t = 'ruins'; });

// Armies of ten, in two ranks on the west edge (mirrored on the east).
const ranks = [[2, 7, 'archer'], [2, 9, 'wizard'], [2, 11, 'archer'], [2, 13, 'ogre'], [2, 15, 'scout'],
  [4, 8, 'soldier'], [4, 10, 'ogre'], [4, 12, 'soldier'], [4, 14, 'soldier'], [4, 16, 'scout']];
data.spawns = [0, 1].map((t) => ranks.map(([col, row, cls]) => { const h = at(col, row); return t ? { q: -h.q, r: -h.r, cls } : { q: h.q, r: h.r, cls }; }));
for (const list of data.spawns) for (const s of list) {
  const c = cell(s); if (c.t !== 'road') c.t = 'grass'; c.e = Math.min(c.e, 1);
  for (const [dq, dr] of DIRS) { const n = cell({ q: s.q + dq, r: s.r + dr }); if (n && (n.t === 'rock' || n.t === 'water' || n.t === 'spikes')) n.t = 'grass'; if (n) n.e = Math.min(n.e, c.e + 1); }
}
// Keep it exactly symmetric: the west half is the master copy.
for (const c of data.cells) {
  const m = cells.get(key(-c.q, -c.r));
  if (!m) c.drop = true; else if (c.q > 0 || (c.q === 0 && c.r > 0)) { c.t = m.t; c.e = m.e; }
}

data.cells = data.cells.filter((c) => !c.drop);
for (const c of [...cells.values()]) if (c.drop) cells.delete(key(c.q, c.r));
data.name = 'greenvale';
data.biome = 'meadow';
const nb = at(bc, bridgeRow);
data.objectives = [{ q: 0, r: 0 }, nb, { q: -nb.q, r: -nb.r }];
data.wild = [{ ...circle, cls: 'troll' }, { q: -circle.q, r: -circle.r, cls: 'troll' }];
const map = mapFromData(data);
console.log('cells', data.cells.length, 'problem:', mapProblem(map));
const f0 = E.distanceField(map, map.spawns[0]), f1 = E.distanceField(map, map.spawns[1]);
console.log('objective costs blue/red:', data.objectives.map((o) => [f0.get(key(o.q, o.r)), f1.get(key(o.q, o.r))]));
console.log('blue to red spawn:', Math.min(...map.spawns[1].map((s) => f0.get(key(s.q, s.r)))), 'unreachable:', data.cells.filter((c) => c.t !== 'rock' && !f0.has(key(c.q, c.r))).length);
const count = {}; for (const c of data.cells) count[c.t] = (count[c.t] || 0) + 1; console.log(count);
const G = { road: '=', grass: '.', forest: 'f', ruins: '#', water: '~', rock: 'X', spikes: '^', house: 'H' };
const sp = new Map(); map.spawns.forEach((l, t) => l.forEach((s) => sp.set(key(s.q, s.r), 'BR'[t])));
const ob = new Set(data.objectives.map((o) => key(o.q, o.r))), wd = new Set(data.wild.map((o) => key(o.q, o.r)));
for (let row = 0; row < ROWS; row++) {
  let line = row % 2 ? ' ' : '';
  for (let col = 0; col < COLS; col++) { const h = at(col, row), c = cell(h), k = key(h.q, h.r); if (!c) { line += '  '; continue; } line += (sp.get(k) || (wd.has(k) ? 'T' : ob.has(k) ? '*' : G[c.t])) + (c.e || ' '); }
  console.log(line);
}
const g = E.createGame(map, { dragons: 'both' });
console.log('units', g.units.length, 'all fit', g.units.every((u) => E.fits(g, u)), 'rounds', g.maxRounds,
  'symmetric', data.cells.every((c) => { const m = cells.get(key(-c.q, -c.r)); return m && m.t === c.t && m.e === c.e; }));
// Settings added later in the map editor, kept here so this script reproduces the saved map.
data.ceiling = false;
// Keep the painted background the saved map points at (repaint it in the editor if the terrain changed).
{ const fs = await import('node:fs'); const old = fs.existsSync(root + 'maps/greenvale.json') ? JSON.parse(fs.readFileSync(root + 'maps/greenvale.json', 'utf8')) : {};
  if (old.version !== undefined) data.version = old.version; if (old.backdrop) data.backdrop = old.backdrop;
  fs.writeFileSync(process.env.OUT || root + 'maps/greenvale.json', JSON.stringify(data)); }
