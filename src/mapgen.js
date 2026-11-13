// Seeded, point-symmetric map generator: the map looks the same from both teams' side,
// so AI-vs-AI results aren't skewed by terrain luck.

import { DIRS, key, dist } from './hex.js';
import { stepCost } from './engine.js';

export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateMap(seed = 1, radius = 6) {
  for (let attempt = 0; ; attempt++) {
    const map = build(seed * 1000 + attempt, radius);
    if (connected(map) || attempt > 50) { map.seed = seed; return map; }
  }
}

// ---- Map files ----
// Plain-JSON form of a map, as saved in maps/<name>.json:
//   { version: 1, name, cells: [{q, r, t, e}], spawns: [[{q, r, cls?}], [...]],
//     objectives: [{q, r}],          control points for the "hold" mode (optional)
//     wild: [{q, r, cls}],                   neutral monsters and where they lair (optional)
//     monsters: ['spider', 'bat', 'worm'],   extra units each side gets on this map (optional)
//     ceiling: true,                 a cave: flyers can't cross rock (optional)
//     backdrop: { image: 'file.png', hexPx, ox, oy } | null }
// Boards can be any shape: a hex exists if it is in `cells`.

export function mapFromData(d) {
  const cells = {};
  for (const c of d.cells) cells[key(c.q, c.r)] = { q: c.q, r: c.r, t: c.t, e: c.e };
  const spawns = [0, 1].map((t) => (d.spawns?.[t] || []).map((s) => ({ ...s })));
  const objectives = (d.objectives || []).map(({ q, r }) => ({ q, r }));
  return { cells, spawns, objectives, ceiling: !!d.ceiling, monsters: Array.isArray(d.monsters) ? d.monsters.slice() : null,
    wild: (d.wild || []).map((w) => ({ ...w })), losCache: new Map(), seed: d.name || 'custom', name: d.name || null };
}

export function mapToData(map, name = null, backdrop = null) {
  return {
    version: 1,
    name,
    cells: Object.values(map.cells).map(({ q, r, t, e }) => ({ q, r, t, e })),
    spawns: map.spawns.map((list) => list.map((s) => ({ ...s }))),
    objectives: (map.objectives || []).map(({ q, r }) => ({ q, r })),
    ceiling: !!map.ceiling,
    ...(map.monsters ? { monsters: map.monsters.slice() } : {}),
    ...(map.wild?.length ? { wild: map.wild.map(({ q, r, cls }) => ({ q, r, cls })) } : {}),
    backdrop,
  };
}

// Why a map can't be played, or null if it can.
export function mapProblem(map) {
  for (const t of [0, 1]) {
    if (!map.spawns[t].length) return `${t ? 'Red' : 'Blue'} has no spawn points`;
    for (const s of map.spawns[t]) {
      const c = map.cells[key(s.q, s.r)];
      if (!c || c.t === 'rock') return `A ${t ? 'Red' : 'Blue'} spawn is not on a passable hex`;
    }
  }
  return null;
}

// Blank rectangular board (rows of hexes, odd rows shifted right), centred on hex 0,0,
// with up to five spawns down the second column from each side.
export function rectBoard(cols, rows) {
  const r0 = Math.floor(rows / 2), c0 = Math.floor(cols / 2);
  const at = (col, row) => ({ q: col - c0 - Math.floor((row - r0 - ((row - r0) & 1)) / 2), r: row - r0 });
  const cells = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) cells.push({ ...at(col, row), t: 'grass', e: 0 });
  const n = Math.min(5, rows), first = r0 - Math.floor(n / 2);
  const spawns = [[], []];
  for (let i = 0; i < n; i++) {
    spawns[0].push(at(Math.min(1, cols - 1), first + i));
    spawns[1].push(at(Math.max(cols - 2, 0), first + i));
  }
  return { version: 1, name: null, cells, spawns, backdrop: null };
}

function build(seed, R) {
  const rnd = makeRng(seed);
  const ri = (n) => Math.floor(rnd() * n);
  const cells = {}, list = [];
  for (let q = -R; q <= R; q++) {
    for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
      const c = { q, r, t: 'grass', e: 0 };
      cells[key(q, r)] = c;
      list.push(c);
    }
  }
  const pick = () => list[ri(list.length)];
  const mirror = (c) => cells[key(-c.q, -c.r)];
  const set = (c, t) => { c.t = t; mirror(c).t = t; };
  const step = (c) => {
    const nb = DIRS.map(([dq, dr]) => cells[key(c.q + dq, c.r + dr)]).filter(Boolean);
    return nb[ri(nb.length)];
  };

  // Bigger boards get proportionally more of everything (radius 6 is the standard size).
  const scale = Math.max(1, Math.round((R * R) / 36));
  const times = (fn) => { for (let k = 0; k < scale; k++) fn(); };
  // Hills: a few cones, each mirrored.
  const hills = [];
  times(() => { for (let i = 0, n = 3 + ri(2); i < n; i++) {
    const c = pick(), h = 1.4 + rnd() * 2.2, rad = 1.8 + rnd() * 2;
    hills.push({ q: c.q, r: c.r, h, rad }, { q: -c.q, r: -c.r, h, rad });
  } });
  for (const c of list) {
    let v = 0;
    for (const hl of hills) v = Math.max(v, hl.h * (1 - dist(c, hl) / hl.rad));
    c.e = Math.max(0, Math.min(3, Math.round(v)));
  }

  // Water: short meandering streams on low ground.
  times(() => { for (let i = 0; i < 2; i++) {
    let c = pick();
    for (let j = 0, len = 3 + ri(4); j < len; j++) { if (c.e === 0) set(c, 'water'); c = step(c); }
  } });
  // Forest clumps, then scattered rocks and ruins.
  times(() => { for (let i = 0; i < 4; i++) {
    let c = pick();
    for (let j = 0, len = 2 + ri(4); j < len; j++) { if (c.t === 'grass') set(c, 'forest'); c = step(c); }
  } });
  times(() => { for (let i = 0, n = 4 + ri(3); i < n; i++) { const c = pick(); if (c.t === 'grass') set(c, 'rock'); } });
  times(() => { for (let i = 0, n = 4 + ri(2); i < n; i++) { const c = pick(); if (c.t === 'grass') set(c, 'ruins'); } });

  // Spawns: a column near the left edge for team 0, mirrored for team 1. Keep them clear.
  const spawn0 = [];
  for (let r = -2; r <= 2; r++) spawn0.push({ q: Math.max(-R, -R - r) + 1, r });
  const spawn1 = spawn0.map((s) => ({ q: -s.q, r: -s.r }));
  for (const s of [...spawn0, ...spawn1]) {
    const c = cells[key(s.q, s.r)];
    c.t = 'grass'; c.e = 0;
    for (const [dq, dr] of DIRS) {
      const n = cells[key(s.q + dq, s.r + dr)];
      if (!n) continue;
      if (n.t === 'rock' || n.t === 'water') n.t = 'grass';
      n.e = Math.min(n.e, 1);
    }
  }
  return { radius: R, cells, spawns: [spawn0, spawn1], losCache: new Map() };
}

function connected(map) {
  const start = map.spawns[0][0], goal = map.spawns[1][0];
  const seen = new Set([key(start.q, start.r)]);
  const open = [start];
  while (open.length) {
    const cur = open.pop();
    if (cur.q === goal.q && cur.r === goal.r) return true;
    const cc = map.cells[key(cur.q, cur.r)];
    for (const [dq, dr] of DIRS) {
      const q = cur.q + dq, r = cur.r + dr, k = key(q, r);
      if (seen.has(k) || stepCost(cc, map.cells[k]) === Infinity) continue;
      seen.add(k);
      open.push({ q, r });
    }
  }
  return false;
}
