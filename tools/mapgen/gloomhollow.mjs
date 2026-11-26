// "gloomhollow": a cave. Solid rock with passages carved out: a chamber for each army, a wide
// main hall from each into a central cavern, and two long one-hex tunnels (north and south) that
// run the whole width, each with a small junction room and a spur down into the cavern.
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/^[/]([A-Za-z]:)/, '$1');
const { rectBoard, mapFromData, mapProblem } = await import(pathToFileURL(root + 'src/mapgen.js').href);
const E = await import(pathToFileURL(root + 'src/engine.js').href);
const { dist, key } = await import(pathToFileURL(root + 'src/hex.js').href);

const COLS = 19, ROWS = 13, r0 = 6, c0 = 9;
const data = rectBoard(COLS, ROWS);
const cells = new Map(data.cells.map((c) => [key(c.q, c.r), c]));
const at = (col, row) => ({ q: col - c0 - Math.floor((row - r0 - ((row - r0) & 1)) / 2), r: row - r0 });
const both = (h, fn) => { for (const p of [h, { q: -h.q, r: -h.r }]) { const c = cells.get(key(p.q, p.r)); if (c) fn(c); } };
const origin = { q: 0, r: 0 };
const set = (list, fn) => { for (const [col, row] of list) both(at(col, row), fn); };
const span = (c0_, c1, r0_, r1) => { const out = []; for (let r = r0_; r <= r1; r++) for (let c = c0_; c <= c1; c++) out.push([c, r]); return out; };
const floor = (c) => { c.t = 'grass'; c.e = 0; };

for (const c of data.cells) { c.t = 'rock'; c.e = 0; }
// Central cavern.
for (const c of data.cells) if (dist(c, origin) <= 3) floor(c);
// Army chambers (the east one comes from the mirror), slightly rounded.
set(span(0, 4, 3, 9), floor);
set([[0, 3], [4, 3], [4, 9]], (c) => { c.t = 'rock'; });
// Main hall, three wide: room for an ogre, and for a dragon to squeeze along.
set(span(5, 5, 5, 7), floor);
// North tunnel across the whole width (the mirror makes the south one), with links into both chambers.
set(span(3, 15, 1, 1), floor);
set([[3, 2], [15, 2]], floor);
// Junction room and the spur into the cavern.
set([[8, 2], [9, 2]], floor);

// Inside the cavern: a raised dais with broken pillars, a pool, fungus.
for (const c of data.cells) if (dist(c, origin) <= 1) { c.t = 'ruins'; c.e = 1; }
set([[7, 4], [8, 4], [7, 5]], (c) => { c.t = 'water'; });
set([[11, 4], [10, 3], [6, 6]], (c) => { c.t = 'forest'; });

// Rubble for cover at the hall mouths and in the chambers; a ledge at the back of each chamber.
set([[5, 5], [3, 6]], (c) => { c.t = 'ruins'; });
set([[1, 3], [2, 3], [1, 9], [2, 9]], (c) => { c.e = 1; });
// Fungus in the tunnels: places to hide under fog.
set([[5, 1], [12, 1], [3, 2], [2, 8]], (c) => { c.t = 'forest'; });
// A puddle in each tunnel slows the run to the junction.
set([[6, 1]], (c) => { c.t = 'water'; });

for (const c of data.cells) if (!cells.has(key(-c.q, -c.r))) { c.t = 'rock'; c.e = 0; }   // keep it exactly symmetric
// Armies start at the back of their chambers, leaving the middle clear.
data.spawns = [0, 1].map((t) => [4, 5, 6, 7, 8].map((row) => { const h = at(row === 7 ? 2 : row === 4 || row === 8 ? 1 : 0, row); return t ? { q: -h.q, r: -h.r } : h; }));
for (const list of data.spawns) for (const s of list) floor(cells.get(key(s.q, s.r)));

data.name = 'gloomhollow';
data.ceiling = true;
const junction = at(9, 1);
data.objectives = [{ q: 0, r: 0 }, junction, { q: -junction.q, r: -junction.r }];
const map = mapFromData(data);
console.log('problem:', mapProblem(map), 'ceiling:', map.ceiling);
const f0 = E.distanceField(map, map.spawns[0]), f1 = E.distanceField(map, map.spawns[1]);
console.log('objective costs blue/red:', data.objectives.map((o) => [f0.get(key(o.q, o.r)), f1.get(key(o.q, o.r))]));
console.log('blue to red spawn:', Math.min(...map.spawns[1].map((s) => f0.get(key(s.q, s.r)))));
const unreachable = data.cells.filter((c) => c.t !== 'rock' && !f0.has(key(c.q, c.r))).length;
const count = {}; for (const c of data.cells) count[c.t] = (count[c.t] || 0) + 1; console.log(count, 'unreachable floor:', unreachable);
const G = { grass: '.', forest: 'f', ruins: '#', water: '~', rock: 'X' };
const sp = new Map(); map.spawns.forEach((l, t) => l.forEach((s) => sp.set(key(s.q, s.r), 'BR'[t])));
const ob = new Set(data.objectives.map((o) => key(o.q, o.r)));
for (let row = 0; row < ROWS; row++) {
  let line = row % 2 ? ' ' : '';
  for (let col = 0; col < COLS; col++) { const h = at(col, row), c = cells.get(key(h.q, h.r)); line += (sp.get(key(h.q, h.r)) || (ob.has(key(h.q, h.r)) ? '*' : G[c.t])) + (c.e || ' '); }
  console.log(line);
}
const g = E.createGame(map, { dragons: 'both' });
for (const d of g.units.filter((u) => u.cls === 'dragon')) {
  // How far can it get in ten turns of flying? (reach with a huge move budget)
  const spots = new Set(); const seen = new Set([E.posKey({ q: d.q, r: d.r, o: 0 })]); let frontier = [{ ...d }];
  for (let turn = 0; turn < 12; turn++) {
    const next = [];
    for (const p of frontier) for (const n of E.reachable({ ...g, units: [p] }, p).values()) {
      const k = E.posKey(n); if (!n.stop || seen.has(k)) continue; seen.add(k); spots.add(k); next.push({ ...d, q: n.q, r: n.r });
    }
    frontier = next;
  }
  console.log('dragon team', d.team, 'at', d.q, d.r, 'fits', E.fits(g, d), 'positions it can ever reach:', seen.size, 'reaches centre:', seen.has('0,0,0'));
}
console.log('ogres fit:', g.units.filter((u) => u.cls === 'ogre').map((u) => [u.q, u.r, E.fits(g, u), [...E.reachable(g, u).values()].length]));
// Settings added later in the map editor, kept here so this script reproduces the saved map.
data.biome = "cave";
data.art = "portrait";
data.monsters = ["spider","bat","worm"];
data.wild = [{"q":0,"r":0,"cls":"troll"},{"q":3,"r":-5,"cls":"spider"},{"q":-3,"r":5,"cls":"spider"}];
for (const [q, r, t, e] of [[2,-3,"spikes",0],[-4,-2,"spikes",0],[2,-1,"spikes",0],[-2,1,"spikes",0],[4,2,"spikes",0],[-2,3,"spikes",0]]) { const c = data.cells.find((c) => c.q === q && c.r === r); c.t = t; c.e = e; }   // set by hand in the editor afterwards
// Keep the painted background the saved map points at (repaint it in the editor if the terrain changed).
{ const fs = await import('node:fs'); const old = fs.existsSync(root + 'maps/gloomhollow.json') ? JSON.parse(fs.readFileSync(root + 'maps/gloomhollow.json', 'utf8')) : {};
  if (old.version !== undefined) data.version = old.version; if (old.backdrop) data.backdrop = old.backdrop;
  fs.writeFileSync(process.env.OUT || root + 'maps/gloomhollow.json', JSON.stringify(data)); }
