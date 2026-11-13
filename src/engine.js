// Rules engine. No DOM, no randomness: the same code runs in the browser and in Node,
// and every action has a deterministic outcome (which keeps search-based AIs simple).
//
// State shape (plain data, cheap to clone):
//   { map, units: [{id, team, cls, q, r, hp, moved, acted}], turn: 0|1, round, winner, maxRounds }
// team 2 (WILD) is neutral monsters: they belong to neither player, attack both, and take their
// own phase after the second player's turn — see "Neutral monsters" below.
// A unit's position is its anchor hex (q, r); creatures bigger than one hex also have an
// orientation `o` and occupy a footprint of several hexes — see "Creature sizes" below.
// map is immutable and shared between clones. Dead units are removed from `units`.
// winner is null while playing, then 0, 1 or 'draw'.
//
// Actions:
//   {type:'move',   unit, q, r, o?} once per unit per turn, before acting (o: orientation, big creatures only)
//   {type:'attack', unit, target}   ends the unit's turn
//   {type:'cast',   unit, spell, q, r}   a spell aimed at a hex; ends the unit's turn
//   {type:'wait',   unit}           ends the unit's turn
//   {type:'endTurn'}

import { DIRS, key, dist, hexRound } from './hex.js';

export const TERRAIN = {
  grass:  { name: 'Grass',  cost: 1, cover: 0 },
  forest: { name: 'Forest', cost: 2, cover: 1 },          // difficult, light cover
  ruins:  { name: 'Ruins',  cost: 1, cover: 2 },          // heavy cover
  water:  { name: 'Water',  cost: 2, cover: -1 },         // difficult, exposed, weakens attacks
  // narrow: only one-hex creatures fit between them. Big ones can't stand there (flyers and burrowers may pass).
  spikes: { name: 'Stalagmites', cost: 2, cover: 1, narrow: true },
  // low: spikes hang from the roof. Walkers pass underneath as on open ground; flyers can't get through.
  stalactites: { name: 'Stalactites', cost: 1, cover: 0, low: true },
  rock:   { name: 'Rock',   cost: Infinity, cover: 0 },   // impassable, blocks line of sight
};

export const CLASSES = {
  soldier: { name: 'Soldier', glyph: 'S', hp: 14, atk: 5, move: 3, rmin: 1, rmax: 1, sight: 4 },     // melee classes exert a zone of control
  archer:  { name: 'Archer',  glyph: 'A', hp: 9,  atk: 4, move: 3, rmin: 2, rmax: 4, sight: 5 },
  scout:   { name: 'Scout',   glyph: 'C', hp: 10, atk: 4, move: 5, rmin: 1, rmax: 1, sight: 7 },
  ogre:    { name: 'Ogre',    glyph: 'O', hp: 24, atk: 6, move: 3, rmin: 1, rmax: 1, sight: 4, size: 'large' },
  // fly: moves over anything (terrain, cliffs, rocks, units, zones of control) at 1 per hex, but must land where it fits.
  //      On a map with `ceiling: true` (a cave) rock is solid to flyers as well.
  dragon:  { name: 'Dragon',  glyph: 'D', hp: 40, atk: 6, move: 4, rmin: 1, rmax: 1, sight: 6, size: 'huge', fly: true, value: 3, spells: ['breath'] },
  // Monsters. climb: height costs nothing and cliffs are no obstacle.
  //           burrow: tunnels under everything, rock included (even under a ceiling), and surfaces where it fits.
  spider:  { name: 'Giant spider', glyph: 'X', hp: 12, atk: 4, move: 4, rmin: 1, rmax: 1, sight: 5, climb: true, spells: ['web'] },
  bat:     { name: 'Bat swarm',    glyph: 'B', hp: 7,  atk: 3, move: 6, rmin: 1, rmax: 1, sight: 4, fly: true },
  worm:    { name: 'Rock worm',    glyph: 'M', hp: 20, atk: 6, move: 3, rmin: 1, rmax: 1, sight: 3, size: 'large', burrow: true, value: 1.5 },
  // regen: heals that much at the start of each of its own turns.
  troll:   { name: 'Cave troll',   glyph: 'T', hp: 22, atk: 6, move: 3, rmin: 1, rmax: 1, sight: 4, regen: 2 },
  wizard:  { name: 'Wizard',  glyph: 'W', hp: 8,  atk: 4, move: 3, rmin: 1, rmax: 3, sight: 5, pierce: true, spells: ['fireball', 'frost', 'blink'] },   // lightning ignores cover
};

// Spells are cast instead of attacking, at a hex, and then need `cooldown` of the caster's turns
// to recharge. They ignore cover and height. Per-unit state lives in flat fields so that clone()
// stays a shallow copy: unit['cd_' + spell] (turns until ready) and unit.frozen.
//   area:   hits the target hex for `dmg` and every adjacent hex for `splash` — friend or foe.
//   freeze: the target cannot move on its next turn. (snare: the same, shown as a web: unit.frozen = 2.)
//   cone:   aimed at any hex in range; burns everything in a 60-degree wedge toward it, from
//           rmin to rmax hexes out — friend or foe — except what is hidden behind rock or a rise.
//   blink:  teleports the caster to any free hex in range, over cliffs, water and walls.
export const SPELLS = {
  fireball: { name: 'Fireball',   rmin: 2, rmax: 4, cooldown: 3, dmg: 4, splash: 2, area: true },
  frost:    { name: 'Frost bolt', rmin: 1, rmax: 4, cooldown: 2, dmg: 2, freeze: true },
  breath:   { name: 'Fire breath', rmin: 2, rmax: 4, cooldown: 2, dmg: 5, cone: true },
  web:      { name: 'Web',        rmin: 2, rmax: 3, cooldown: 3, dmg: 1, splash: 1, area: true, freeze: true, snare: true },
  blink:    { name: 'Blink',      rmin: 1, rmax: 4, cooldown: 3, blink: true },
};

export const ROSTER = ['archer', 'soldier', 'scout', 'ogre', 'wizard'];
// Monster packs: extra units for both sides (createGame's `monsters` option, or a map's own `monsters` list).
export const PACKS = { cave: ['spider', 'bat', 'worm'] };
// Neutral monsters are team WILD. Each guards the ground within WILD_RANGE hexes of where it started.
export const WILD = 2, WILD_RANGE = 4;
// Flyers and burrowers move the same way: 1 per hex over (or under) anything, stopping only where they fit.
const glides = (cls) => !!(CLASSES[cls].fly || CLASSES[cls].burrow);
// Can such a unit pass with its body over these hexes? Off-board never; rock stops a flyer under a ceiling.
const canGlide = (map, cls, hexes) => hexes.every((h) => {
  const c = map.cells[key(h.q, h.r)];
  return c && (CLASSES[cls].burrow || !(TERRAIN[c.t].low || (map.ceiling && c.t === 'rock')));
});

// ---- Creature sizes ----
// A class's `size` picks a footprint: the hexes it occupies, as offsets from its anchor hex.
// Sizes with more than one entry can turn; the unit's `o` says which entry it is in.
//   medium: one hex.
//   large:  three mutually adjacent hexes. Such a triangle points either down (o = 0) or up (o = 1).
//   huge:   a hex and its six neighbours.
// A big creature is attacked, seen, blocked and stopped through any of its hexes. It takes the
// worst cover and the lowest height among them when defending, and the highest when attacking.
export const SHAPES = {
  medium: [[[0, 0]]],
  large: [[[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 0], [1, -1]]],
  huge: [[[0, 0], [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]],
};
// A large creature moves by pivoting: two of its hexes stay put and the third swings across to
// the other side of them, which turns it over. [dq, dr, new o] for each of the three pivots.
// Two pivots shift it one whole hex, so each costs half a step.
const PIVOTS = { 0: [[0, 1, 1], [-1, 1, 1], [0, 0, 1]], 1: [[0, -1, 0], [1, -1, 0], [0, 0, 0]] };

export const isBig = (u) => (CLASSES[u.cls].size || 'medium') !== 'medium';

// The hexes `unit` occupies, or would occupy standing at `at` ({q, r, o}).
export function footprint(unit, at = unit) {
  const size = CLASSES[unit.cls].size;
  if (!size || size === 'medium') return [at];
  return SHAPES[size][at.o || 0].map(([dq, dr]) => ({ q: at.q + dq, r: at.r + dr }));
}

// Map key for a position. Plain hex key for one-hex units; includes the orientation for big ones.
export const posKey = (p) => (p.o === undefined ? key(p.q, p.r) : key(p.q, p.r) + ',' + p.o);

// Hex distance between two units (optionally at hypothetical positions): nearest pair of hexes.
export function unitDist(a, b, pa = a, pb = b) {
  if (!isBig(a) && !isBig(b)) return dist(pa, pb);
  let best = Infinity;
  for (const x of footprint(a, pa)) for (const y of footprint(b, pb)) best = Math.min(best, dist(x, y));
  return best;
}

// Could `unit` stand at `at`? Every hex must exist, be passable, be free of other units, and the
// ground under it must not span a cliff (flyers may straddle one).
export function fits(state, unit, at = unit) {
  let lo = Infinity, hi = -Infinity;
  for (const c of footprint(unit, at)) {
    const cell = state.map.cells[key(c.q, c.r)];
    if (!cell || cell.t === 'rock' || (TERRAIN[cell.t].narrow && isBig(unit)) || (TERRAIN[cell.t].low && CLASSES[unit.cls].fly)) return false;
    const other = unitAt(state, c);
    if (other && other.id !== unit.id) return false;
    lo = Math.min(lo, cell.e); hi = Math.max(hi, cell.e);
  }
  return hi - lo <= 1 || !!CLASSES[unit.cls].fly;      // a flyer can perch across a ledge
}

// Optional rules (all plain flags on the state): fog, counters (defenders strike back),
// zoc (melee units stop enemies that step next to them).
//
// mode: 'eliminate' (default) — destroy the other team.
//       'hold' — control points. At the end of each team's turn, any point with a unit standing on
//       it goes to that unit's team and stays theirs until an enemy stands on it; the team whose
//       turn is ending then scores 1 per point it owns. First to `target` wins (default 2 per
//       point); wiping the enemy out still wins too. Points come from map.objectives, or are
//       placed automatically along the line where the two armies meet.
export function createGame(map, { maxRounds = 0, fog = false, counters = true, zoc = true, mode = 'eliminate', target = 0, dragons = 'none', monsters, wild } = {}) {
  if (!maxRounds) {                                // 30, or longer when the armies start far apart
    const mid = (t, a) => map.spawns[t].reduce((sum, p) => sum + p[a], 0) / Math.max(1, map.spawns[t].length);
    const apart = dist(hexRound(mid(0, 'q'), mid(0, 'r')), hexRound(mid(1, 'q'), mid(1, 'r')));
    maxRounds = Math.max(30, Math.round(apart * 1.5 + 4));
  }
  const units = [];
  for (const team of [0, 1]) {
    map.spawns[team].forEach((s, i) => {
      const cls = s.cls || ROSTER[i % ROSTER.length];
      units.push({ id: units.length, team, cls, q: s.q, r: s.r, hp: CLASSES[cls].hp, moved: false, acted: false });
    });
  }
  // dragons: 'none' | 'both' | 'red' | 'blue' — an extra Dragon for those teams, behind their line.
  for (const team of [0, 1]) {
    if (dragons !== 'both' && dragons !== ['blue', 'red'][team]) continue;
    const mid = (t, a) => map.spawns[t].reduce((sum, p) => sum + p[a], 0) / Math.max(1, map.spawns[t].length);
    const [q, r, fq, fr] = [mid(team, 'q'), mid(team, 'r'), mid(1 - team, 'q'), mid(1 - team, 'r')];
    const len = Math.hypot(q - fq, r - fr) || 1;
    const sign = team ? -1 : 1;
    const at = hexRound(q + 2 * (q - fq) / len + sign * 1e-6, r + 2 * (r - fr) / len + sign * 2e-6);
    units.push({ id: units.length, team, cls: 'dragon', q: at.q, r: at.r, hp: CLASSES.dragon.hp, moved: false, acted: false });
  }
  // wild: neutral monsters, [{q, r, cls}]. Default: the map's own list. 'auto': the map's own, or if it
  // has none a troll and two spiders on the control points (the map's, or the ones 'hold' would place).
  let lairs = wild === undefined || wild === 'auto' ? map.wild || [] : wild || [];
  if (wild === 'auto' && !lairs.length) {
    const spots = map.objectives?.length ? map.objectives : defaultObjectives(map);
    lairs = spots.slice(0, 3).map((p, i) => ({ q: p.q, r: p.r, cls: i ? 'spider' : 'troll' }));
  }
  for (const w of lairs) {
    const c = cellAt(map, w);
    if (!CLASSES[w.cls] || !c || c.t === 'rock' || units.some((u) => u.q === w.q && u.r === w.r)) continue;
    units.push({ id: units.length, team: WILD, cls: w.cls, q: w.q, r: w.r, hp: CLASSES[w.cls].hp, moved: false, acted: false });
  }
  // monsters: a list of classes each side gets as well (default: the map's own list, if it has one).
  // They have no spawn hex: they start as near the middle of their army as there is room.
  const loose = new Set();
  for (const team of [0, 1]) {
    for (const cls of monsters === undefined ? map.monsters || [] : monsters || []) {
      if (!CLASSES[cls] || !map.spawns[team].length) continue;
      const mid = (a) => map.spawns[team].reduce((sum, p) => sum + p[a], 0) / map.spawns[team].length;
      const sign = team ? -1 : 1;                  // ties break in mirror image, so a symmetric map stays fair
      const at = hexRound(mid('q') + sign * 1e-6, mid('r') + sign * 2e-6);
      loose.add(units.length);
      units.push({ id: units.length, team, cls, q: at.q, r: at.r, hp: CLASSES[cls].hp, moved: false, acted: false });
    }
  }
  // Big creatures need room: take the nearest spot to the spawn hex where the whole footprint fits.
  const placing = { map, units: units.filter((u) => !isBig(u) && !loose.has(u.id)) };
  for (const u of units) {
    if (!isBig(u)) continue;
    // Candidates are ranked by how close the whole body is to the spawn hex (covering it is best),
    // with ties broken in mirror image for the second team, so a symmetric map gives a symmetric start.
    const spawn = { q: u.q, r: u.r }, sign = u.team ? -1 : 1;
    const cands = [];
    for (const c of Object.values(map.cells)) {
      if (dist(c, spawn) > 8) continue;
      for (let o = 0; o < SHAPES[CLASSES[u.cls].size].length; o++) {
        const at = { q: c.q, r: c.r, o }, body = footprint(u, at);
        if (!fits(placing, u, at)) continue;
        const sum = (f) => body.reduce((t, h) => t + f(h), 0);
        cands.push({ at, d: sum((h) => dist(h, spawn)), covers: body.some((h) => h.q === spawn.q && h.r === spawn.r) ? 0 : 1, r: sign * sum((h) => h.r), q: sign * sum((h) => h.q) });
      }
    }
    cands.sort((x, y) => x.covers - y.covers || x.d - y.d || x.r - y.r || x.q - y.q);
    const done = cands.length > 0;
    if (done) { u.q = cands[0].at.q; u.r = cands[0].at.r; u.o = cands[0].at.o; }
    if (!done) u.o = 0;
    placing.units.push(u);
  }
  for (const u of units) {                         // one-hex monsters take the nearest free hex
    if (isBig(u) || !loose.has(u.id)) continue;
    const spawn = { q: u.q, r: u.r }, sign = u.team ? -1 : 1;
    const spot = Object.values(map.cells).filter((c) => fits(placing, u, c))
      .sort((a, b) => dist(a, spawn) - dist(b, spawn) || sign * (a.r - b.r) || sign * (a.q - b.q))[0];
    if (spot) { u.q = spot.q; u.r = spot.r; }
    placing.units.push(u);
  }
  for (const u of units) if (u.team === WILD) { u.hq = u.q; u.hr = u.r; }     // home: the middle of its territory
  let objectives = [];
  if (mode === 'hold') {
    const placed = (map.objectives || []).filter((o) => { const c = cellAt(map, o); return c && c.t !== 'rock'; });
    objectives = placed.length ? placed : defaultObjectives(map);
  }
  // roster: both starting line-ups (public knowledge, even under fog).
  const roster = units.map(({ id, team, cls, q, r, o }) => ({ id, team, cls, q, r, o }));
  return { map, units, roster, turn: 0, round: 1, winner: null, maxRounds, fog, counters, zoc,
    mode, objectives, owners: objectives.map(() => null), score: [0, 0], target: target || 2 * objectives.length };
}

export const clone = (s) => ({ ...s, units: s.units.map((u) => ({ ...u })), owners: s.owners.slice(), score: s.score.slice() });
export const cellAt = (map, h) => map.cells[key(h.q, h.r)];
export const unitById = (s, id) => s.units.find((u) => u.id === id);
export function unitAt(s, h) {
  for (const u of s.units) {
    if (u.q === h.q && u.r === h.r) return u;
    if (isBig(u) && footprint(u).some((c) => c.q === h.q && c.r === h.r)) return u;
  }
  return undefined;
}

// ---- Movement ----

// Cost of stepping between adjacent cells. Climbing costs +1; a 2+ level difference is a cliff.
export function stepCost(from, to) {
  if (!to) return Infinity;
  const de = to.e - from.e;
  if (de > 1 || de < -1) return Infinity;
  return TERRAIN[to.t].cost + (de > 0 ? 1 : 0);
}

// Zone of control: the hexes next to `team`'s enemies that are melee units (range 1) and within
// one level of height — i.e. the hexes those units could strike. A unit that steps into one must
// stop there; a unit that starts its move in one may leave freely. Empty when the rule is off.
export function controlZone(state, team) {
  const zone = new Set();
  if (!state.zoc) return zone;
  for (const e of state.units) {
    if (e.team === team || CLASSES[e.cls].rmax !== 1) continue;
    for (const h of footprint(e)) {
      const ee = cellAt(state.map, h).e;
      for (const [dq, dr] of DIRS) {
        const c = state.map.cells[key(h.q + dq, h.r + dr)];
        if (c && Math.abs(c.e - ee) <= 1) zone.add(key(c.q, c.r));
      }
    }
  }
  return zone;
}

// One step from position `cur`: [{q, r, o?, step}] with the movement cost of each (terrain only).
function stepsFrom(map, unit, cur) {
  const { cells } = map;
  const out = [];
  const size = CLASSES[unit.cls].size || 'medium';
  if (size === 'medium') {
    const from = cells[key(cur.q, cur.r)], k = CLASSES[unit.cls];
    for (const [dq, dr] of DIRS) {
      const to = cells[key(cur.q + dq, cur.r + dr)];
      const step = glides(unit.cls) ? (canGlide(map, unit.cls, [{ q: cur.q + dq, r: cur.r + dr }]) ? 1 : Infinity)
        : k.climb ? (to ? TERRAIN[to.t].cost : Infinity)          // a climber ignores height
        : stepCost(from, to);
      if (step !== Infinity) out.push({ q: cur.q + dq, r: cur.r + dr, step });
    }
  } else if (size === 'large') {                 // pivot: one hex swings over the other two
    const old = footprint(unit, cur);
    for (const [dq, dr, o] of PIVOTS[cur.o || 0]) {
      const next = { q: cur.q + dq, r: cur.r + dr, o };
      const fresh = footprint(unit, next).find((c) => !old.some((p) => p.q === c.q && p.r === c.r));
      if (glides(unit.cls)) { if (canGlide(map, unit.cls, [fresh])) out.push({ ...next, step: 0.5 }); continue; }
      const kept = old.filter((p) => dist(p, fresh) === 1);
      const to = cells[key(fresh.q, fresh.r)];
      const step = 0.5 * Math.max(...kept.map((p) => stepCost(cells[key(p.q, p.r)], to)));
      if (step !== Infinity) out.push({ ...next, step });
    }
  } else {                                       // shift the whole footprint one hex
    const old = footprint(unit, cur);
    for (const [dq, dr] of DIRS) {
      const next = { q: cur.q + dq, r: cur.r + dr, o: cur.o || 0 };
      const over = footprint(unit, next);
      // Under a ceiling (map.ceiling: caves) rock reaches the roof, so flyers can't cross it either.
      const step = glides(unit.cls) ? (canGlide(map, unit.cls, over) ? 1 : Infinity)
        : Math.max(...over.map((c, i) => stepCost(cells[key(old[i].q, old[i].r)], cells[key(c.q, c.r)])));
      if (step !== Infinity) out.push({ ...next, step });
    }
  }
  return out;
}

// Dijkstra from the unit. Returns Map(posKey -> {q, r, o?, cost, prev, stop}); `stop` is false
// for positions the unit may pass through (allies) but not end on. Enemies block, and movement
// ends on entering an enemy zone of control. Big creatures pass through allies the same way.
export function reachable(state, unit) {
  const { cells } = state.map;
  const big = isBig(unit), fly = glides(unit.cls);
  const occ = new Map();
  const zone = controlZone(state, unit.team);
  for (const u of state.units) if (u.id !== unit.id) for (const c of footprint(u)) occ.set(key(c.q, c.r), u.team);
  const budget = unit.moved || unit.frozen ? 0 : CLASSES[unit.cls].move;
  const out = new Map();
  const start = { q: unit.q, r: unit.r, cost: 0, prev: null, stop: true };
  if (big) start.o = unit.o || 0;
  out.set(posKey(start), start);
  const open = [start];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].cost < open[bi].cost) bi = i;
    const cur = open.splice(bi, 1)[0];
    // Stepped into a control zone: no further.
    if (!fly && cur !== start && footprint(unit, cur).some((c) => zone.has(key(c.q, c.r)))) continue;
    for (const next of stepsFrom(state.map, unit, cur)) {
      const cost = cur.cost + next.step;
      if (cost > budget) continue;
      let stop = true;
      if (fly) stop = fits(state, unit, next);   // flies over anything, lands only where it fits
      else if (big) {
        if (footprint(unit, next).some((c) => TERRAIN[cells[key(c.q, c.r)].t].narrow)) continue;
        const under = footprint(unit, next).map((c) => occ.get(key(c.q, c.r))).filter((t) => t !== undefined);
        if (under.some((t) => t !== unit.team)) continue;
        stop = !under.length;                      // may pass through friends, like anyone else, but not stop on them
      } else {
        const team = occ.get(key(next.q, next.r));
        if (team !== undefined && team !== unit.team) continue;
        stop = team === undefined;
      }
      const k = posKey(next), old = out.get(k);
      if (old && old.cost <= cost) continue;
      const node = { q: next.q, r: next.r, cost, prev: cur, stop };
      if (big) node.o = next.o;
      out.set(k, node);
      const oi = old ? open.indexOf(old) : -1;
      if (oi >= 0) open[oi] = node; else open.push(node);
    }
  }
  return out;
}

// The positions from the unit's start to `h` ({q, r, o?}), as [{q, r, o?}].
export function pathTo(reach, h) {
  const path = [];
  for (let n = reach.get(posKey(h)); n; n = n.prev) path.unshift(n.o === undefined ? { q: n.q, r: n.r } : { q: n.q, r: n.r, o: n.o });
  return path;
}

// Terrain-only travel cost from the nearest of `sources` to every cell (ignores units).
// Handy as an "how far am I from the fight" heuristic that respects cliffs and rocks.
export function distanceField(map, sources) {
  const out = new Map();
  const heap = [];                               // binary heap of [cost, q, r]: stays fast on big maps
  const push = (n) => {
    let i = heap.push(n) - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= n[0]) break; heap[i] = heap[p]; i = p; }
    heap[i] = n;
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
        if (heap[c][0] >= last[0]) break;
        heap[i] = heap[c]; i = c;
      }
      heap[i] = last;
    }
    return top;
  };
  for (const s of sources) { out.set(key(s.q, s.r), 0); push([0, s.q, s.r]); }
  while (heap.length) {
    const [c0, cq, cr] = pop();
    if (c0 > out.get(key(cq, cr))) continue;
    const curCell = map.cells[key(cq, cr)];
    for (const [dq, dr] of DIRS) {
      const q = cq + dq, r = cr + dr, k = key(q, r);
      const cost = c0 + stepCost(curCell, map.cells[k]);
      if (cost === Infinity || (out.has(k) && out.get(k) <= cost)) continue;
      out.set(k, cost);
      push([cost, q, r]);
    }
  }
  return out;
}

// The cells within `n` hexes of `from` (cheaper than scanning the whole map).
export function cellsWithin(map, from, n) {
  const out = [];
  for (let dq = -n; dq <= n; dq++) {
    for (let dr = Math.max(-n, -dq - n); dr <= Math.min(n, -dq + n); dr++) {
      const c = map.cells[key(from.q + dq, from.r + dr)];
      if (c) out.push(c);
    }
  }
  return out;
}

// Three control points for a map that doesn't define any: the hex on the "front line" (about
// equally far from both starting areas) that the armies reach first, then two more front-line
// hexes spread as far from it and each other as possible. Never on rock, water or a spawn.
export function defaultObjectives(map) {
  const d0 = distanceField(map, map.spawns[0]), d1 = distanceField(map, map.spawns[1]);
  const spawn = new Set(map.spawns.flat().map((s) => key(s.q, s.r)));
  const open = Object.values(map.cells).filter((c) => {
    const k = key(c.q, c.r);
    return c.t !== 'rock' && c.t !== 'water' && !spawn.has(k) && d0.has(k) && d1.has(k);
  });
  const sum = (c) => d0.get(key(c.q, c.r)) + d1.get(key(c.q, c.r));
  const gap = (c) => Math.abs(d0.get(key(c.q, c.r)) - d1.get(key(c.q, c.r)));
  let front = [];
  for (let tol = 1; tol <= 8 && front.length < 3; tol++) front = open.filter((c) => gap(c) <= tol);
  if (!front.length) return [];
  front.sort((a, b) => sum(a) - sum(b) || a.q - b.q || a.r - b.r);
  const first = front[0], near = front.filter((c) => sum(c) <= sum(first) * 1.6);
  const picks = [first];
  while (picks.length < 3 && picks.length < near.length) {
    let best = null, bestD = -1;
    for (const c of near) {
      const d = Math.min(...picks.map((p) => dist(p, c)));
      if (d > bestD) { bestD = d; best = c; }
    }
    if (bestD <= 0) break;
    picks.push(best);
  }
  return picks.map(({ q, r }) => ({ q, r }));
}

// ---- Combat ----

// Sight line runs between "eye level" (elevation + 1) of both hexes. Any hex in between whose
// ground reaches the line blocks it; rocks count as 2 taller. Symmetric and cached per map.
export function los(map, a, b) {
  if (a.q > b.q || (a.q === b.q && a.r > b.r)) [a, b] = [b, a];
  const k = a.q + ',' + a.r + '|' + b.q + ',' + b.r;
  let v = map.losCache.get(k);
  if (v !== undefined) return v;
  v = !losBlocker(map, a, b);
  map.losCache.set(k, v);
  return v;
}

// The first cell that blocks the sight line between a and b, or null if it is clear.
export function losBlocker(map, a, b) {
  if (a.q > b.q || (a.q === b.q && a.r > b.r)) [a, b] = [b, a];
  const n = dist(a, b);
  const ea = cellAt(map, a).e + 1, eb = cellAt(map, b).e + 1;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const h = hexRound(a.q + (b.q - a.q) * t + 1e-6, a.r + (b.r - a.r) * t + 2e-6);
    const c = cellAt(map, h);
    if (c && c.e + (c.t === 'rock' ? 2 : 0) >= ea + (eb - ea) * t - 1e-9) return c;
  }
  return null;
}

// Could a unit of class `cls` standing on `from` attack something standing on `to`?
export function canAttack(map, cls, from, to) {
  const c = CLASSES[cls], d = dist(from, to);
  const ea = cellAt(map, from).e, eb = cellAt(map, to).e;
  if (c.rmax === 1) return d === 1 && Math.abs(ea - eb) <= 1;
  return d >= c.rmin && d <= c.rmax + (ea > eb ? 1 : 0) && los(map, from, to);   // high ground: +1 range
}

// canAttack for whole units: true if any hex of the attacker (standing at `from`) can attack any
// hex of the target (standing at `at`).
export function canStrike(map, attacker, from, target, at = target) {
  if (!isBig(attacker) && !isBig(target)) return canAttack(map, attacker.cls, from, at);
  const theirs = footprint(target, at);
  return footprint(attacker, from).some((a) => theirs.some((b) => canAttack(map, attacker.cls, a, b)));
}

// Damage `attacker` would deal to `target` if it stood on `from` (and the target on `at`).
// atk, +/-1 per level of height difference (max 2), minus target's cover, -1 if attacking from water.
// Big creatures attack from their highest hex and defend on their lowest, with their worst cover.
export function damage(map, attacker, from, target, at = target) {
  const cls = CLASSES[attacker.cls];
  let high = -Infinity, wet = true;
  for (const c of footprint(attacker, from)) {
    const cell = cellAt(map, c);
    high = Math.max(high, cell.e);
    if (cell.t !== 'water') wet = false;
  }
  let low = Infinity, cover = Infinity;
  for (const c of footprint(target, at)) {
    const cell = cellAt(map, c);
    low = Math.min(low, cell.e);
    cover = Math.min(cover, TERRAIN[cell.t].cover);
  }
  if (cls.pierce) cover = Math.min(0, cover);
  const h = Math.max(-2, Math.min(2, high - low));
  return Math.max(1, cls.atk + h - cover - (wet ? 1 : 0));
}

// Damage `defender` would deal back to `attacker` (standing on `from`) after surviving its attack:
// its normal attack, if the attacker is within its range and sight line. 0 if it can't reach, or
// the rule is off. Spells are never countered.
export function counterDamage(state, defender, attacker, from = attacker) {
  if (!state.counters || !canStrike(state.map, defender, defender, attacker, from)) return 0;
  return damage(state.map, defender, defender, attacker, from);
}

export function targetsFrom(state, unit, from) {
  return state.units.filter((t) => t.team !== unit.team && canStrike(state.map, unit, from, t)
    && (!state.fog || spotted(state, unit, from, t)));
}

// ---- Fog of war (only when state.fog is set) ----
//
// A team sees every hex within a unit's sight range that the unit has a clear sight line to
// (+1 range when looking down from higher ground). Vision is shared across the team. Units
// standing in forest stay hidden until an enemy is adjacent to them.
//
// The true state always holds every unit. What a player may know is observe(state, team):
// the same state with unseen enemies removed. AIs should be given that, not the true state.

export function visibleCells(state, team) {
  const { map } = state, vis = new Set();
  for (const u of state.units) {
    if (u.team !== team) continue;
    const sight = CLASSES[u.cls].sight;
    for (const eye of footprint(u)) {
      const eu = cellAt(map, eye).e;
      for (let dq = -sight - 1; dq <= sight + 1; dq++) {
        for (let dr = Math.max(-sight - 1, -dq - sight - 1); dr <= Math.min(sight + 1, -dq + sight + 1); dr++) {
          const c = map.cells[key(eye.q + dq, eye.r + dr)];
          if (!c) continue;
          const d = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
          if (d <= sight + (eu > c.e ? 1 : 0) && (d <= 1 || los(map, eye, c))) vis.add(key(c.q, c.r));
        }
      }
    }
  }
  return vis;
}

// A unit is concealed by forest only if every hex it stands on is forest.
const inForest = (map, u) => footprint(u).every((c) => cellAt(map, c).t === 'forest');

// Forest rule for attacks: a target in forest must have one of the attacker's team next to it
// (the attacker itself counts, standing on `from`).
function spotted(state, unit, from, target) {
  if (!inForest(state.map, target) || unitDist(unit, target, from) <= 1) return true;
  return state.units.some((m) => m.team === unit.team && m.id !== unit.id && unitDist(m, target) <= 1);
}

// What `team` knows: {...state, units: own + visible enemies, observer: team, unseen: n, vis: Set}.
// Returns the state unchanged when fog is off or it is already an observation.
export function observe(state, team) {
  if (!state.fog || state.observer !== undefined) return state;
  const vis = visibleCells(state, team);
  const mine = state.units.filter((u) => u.team === team);
  const units = [];
  let unseen = 0;
  for (const u of state.units) {
    const seen = u.team === team || (footprint(u).some((c) => vis.has(key(c.q, c.r)))
      && (!inForest(state.map, u) || mine.some((m) => unitDist(m, u) <= 1)));
    if (seen) units.push({ ...u }); else if (u.team !== WILD) unseen++;      // hidden neutrals aren't counted
  }
  return { ...state, units, observer: team, unseen, vis };
}

// Every hex `unit` could attack on its next turn: Map(key -> 'now' | 'move'), where 'now' means
// from where it stands and 'move' means only after moving first.
export function threatZone(state, unit) {
  const out = new Map();
  const k0 = CLASSES[unit.cls];
  const range = Math.max(k0.rmax + 1, ...(k0.spells || []).map((sp) => SPELLS[sp].rmax)) + (isBig(unit) ? 2 : 0);
  const fresh = { ...unit, moved: false };
  for (const n of reachable(state, fresh).values()) {
    if (!n.stop) continue;
    const here = n.cost === 0;
    for (const c of cellsWithin(state.map, n, range)) {
      const k = key(c.q, c.r);
      if (out.get(k) === 'now' || (!here && out.has(k))) continue;
      const hit = footprint(unit, n).some((a) => canAttack(state.map, unit.cls, a, c))
        || (CLASSES[unit.cls].spells || []).some((sp) => SPELLS[sp].dmg && !(unit['cd_' + sp] > 0) && spellReach(state.map, sp, n, c));
      if (hit) out.set(k, here ? 'now' : 'move');
    }
  }
  return out;
}

// ---- Spells ----

export const spellReady = (u, sp) =>
  !u.acted && (CLASSES[u.cls].spells || []).includes(sp) && !(u['cd_' + sp] > 0);

export function spellReach(map, sp, from, to) {
  const s = SPELLS[sp], d = dist(from, to);
  return d >= s.rmin && d <= s.rmax && !!cellAt(map, to) && los(map, from, to);
}

// Hexes `unit` could aim `sp` at if it stood on `from`. Area spells can target any hex in reach
// (empty ground, or woods that might hide something); the rest need an enemy it can see.
export function castTargets(state, unit, sp, from = unit) {
  if (SPELLS[sp].blink) {                        // any free, standable hex in range; no sight line needed
    const s = SPELLS[sp], taken = new Set(state.units.flatMap((u) => footprint(u).map((c) => key(c.q, c.r))));
    return cellsWithin(state.map, from, s.rmax).filter((c) => {
      const d = dist(from, c);
      return d >= s.rmin && d <= s.rmax && c.t !== 'rock' && !taken.has(key(c.q, c.r));
    });
  }
  if (SPELLS[sp].area || SPELLS[sp].cone) return cellsWithin(state.map, from, SPELLS[sp].rmax).filter((c) => spellReach(state.map, sp, from, c));
  const out = [];                                // one entry per enemy: the hex of it to aim at, plus its id
  for (const t of state.units) {
    if (t.team === unit.team) continue;
    const c = footprint(t).find((h) => spellReach(state.map, sp, from, h));
    if (c && (!state.fog || spotted(state, unit, from, t))) out.push({ q: c.q, r: c.r, id: t.id });
  }
  return out;
}

// The hexes a cone spell breathed from `from` toward `at` covers: within 30 degrees of that
// direction, rmin..rmax hexes out, and in sight of `from`.
export function coneCells(map, sp, from, at) {
  const s = SPELLS[sp], out = [];
  const px = (h) => [Math.sqrt(3) * (h.q - from.q + (h.r - from.r) / 2), 1.5 * (h.r - from.r)];
  const [ax, ay] = px(at), al = Math.hypot(ax, ay);
  if (!al) return out;
  for (let dq = -s.rmax; dq <= s.rmax; dq++) {
    for (let dr = Math.max(-s.rmax, -dq - s.rmax); dr <= Math.min(s.rmax, -dq + s.rmax); dr++) {
      const c = map.cells[key(from.q + dq, from.r + dr)];
      if (!c || dist(from, c) < s.rmin) continue;
      const [x, y] = px(c);
      if ((x * ax + y * ay) / (al * Math.hypot(x, y)) >= 0.857 && los(map, from, c)) out.push({ q: c.q, r: c.r });   // cos 31
    }
  }
  return out;
}

// Who a spell landing on `at` would hurt: [{unit, dmg}]. A big creature is hit once, by the worst of it.
// Cone spells also need `from`, where the caster stands.
export function spellHits(state, sp, at, from) {
  const s = SPELLS[sp], out = [];
  if (!s.dmg) return out;
  if (s.cone) {
    const burnt = new Set(coneCells(state.map, sp, from, at).map((c) => key(c.q, c.r)));
    for (const t of state.units) if (footprint(t).some((c) => burnt.has(key(c.q, c.r)))) out.push({ unit: t, dmg: s.dmg });
    return out;
  }
  for (const t of state.units) {
    const d = isBig(t) ? Math.min(...footprint(t).map((c) => dist(c, at))) : dist(t, at);
    if (d === 0) out.push({ unit: t, dmg: s.dmg });
    else if (s.area && d === 1) out.push({ unit: t, dmg: s.splash });
  }
  return out;
}

// After damage that can hit both sides: set the winner if a team has nobody left.
function settle(state) {
  const alive = [0, 1].map((t) => state.units.some((x) => x.team === t) || (state.unseen > 0 && state.observer !== t));
  if (!alive[0] && !alive[1]) state.winner = 'draw';
  else if (!alive[0]) state.winner = 1;
  else if (!alive[1]) state.winner = 0;
}

// ---- Actions ----

// Every "end position + optional target" a unit could choose this turn:
// [{q, r, o?, cost, target: unit|null, cast?}]. Most AIs want this rather than raw legalActions.
export function unitOptions(state, unit) {
  const out = [];
  if (unit.acted) return out;
  for (const n of reachable(state, unit).values()) {
    if (!n.stop) continue;
    const pos = n.o === undefined ? { q: n.q, r: n.r, cost: n.cost } : { q: n.q, r: n.r, o: n.o, cost: n.cost };
    out.push({ ...pos, target: null });
    for (const t of targetsFrom(state, unit, n)) out.push({ ...pos, target: t });
    for (const sp of CLASSES[unit.cls].spells || []) {
      if (!spellReady(unit, sp) || SPELLS[sp].blink) continue;     // blink is left to legalActions: too many targets
      const cast = (h) => out.push({ ...pos, target: null, cast: { spell: sp, q: h.q, r: h.r } });
      if (!SPELLS[sp].area && !SPELLS[sp].cone) { castTargets(state, unit, sp, n).forEach(cast); continue; }
      const tried = new Set();                   // area spells: only centres on or next to an enemy
      for (const e of state.units) {
        if (e.team === unit.team) continue;
        for (const part of footprint(e)) {
          for (const [dq, dr] of [[0, 0], ...DIRS]) {
            const h = { q: part.q + dq, r: part.r + dr }, k = key(h.q, h.r);
            if (tried.has(k)) continue;
            tried.add(k);
            if (spellReach(state.map, sp, n, h)) cast(h);
          }
        }
      }
    }
  }
  return out;
}

export function legalActions(state) {
  const out = [];
  if (state.winner !== null) return out;
  for (const u of state.units) {
    if (u.team !== state.turn || u.acted) continue;
    if (!u.moved) {
      for (const n of reachable(state, u).values()) {
        if (n.stop && n.cost > 0) out.push(n.o === undefined ? { type: 'move', unit: u.id, q: n.q, r: n.r } : { type: 'move', unit: u.id, q: n.q, r: n.r, o: n.o });
      }
    }
    for (const t of targetsFrom(state, u, u)) out.push({ type: 'attack', unit: u.id, target: t.id });
    for (const sp of CLASSES[u.cls].spells || []) {
      if (!spellReady(u, sp)) continue;
      for (const h of castTargets(state, u, sp)) {      // skip casts that would hit no enemy
        if (SPELLS[sp].blink || spellHits(state, sp, h, u).some((x) => x.unit.team !== u.team)) out.push({ type: 'cast', unit: u.id, spell: sp, q: h.q, r: h.r });
      }
    }
    out.push({ type: 'wait', unit: u.id });
  }
  out.push({ type: 'endTurn' });
  return out;
}

export function isLegal(state, a) {
  if (!a || state.winner !== null) return false;
  if (a.type === 'endTurn') return true;
  const u = unitById(state, a.unit);
  if (!u || u.team !== state.turn || u.acted) return false;
  if (a.type === 'wait') return true;
  if (a.type === 'move') {
    if (u.moved) return false;
    const n = reachable(observe(state, u.team), u).get(posKey(isBig(u) ? { q: a.q, r: a.r, o: a.o || 0 } : { q: a.q, r: a.r }));   // judged on what the mover knows
    return !!n && n.stop && n.cost > 0;
  }
  if (a.type === 'cast') {
    // Judged on what the caster's team knows (a blink may be aimed at a hex with a hidden enemy on it).
    if (!SPELLS[a.spell] || !spellReady(u, a.spell)) return false;
    const view = observe(state, u.team), aims = castTargets(view, u, a.spell);
    if (SPELLS[a.spell].dmg && !SPELLS[a.spell].area && !SPELLS[a.spell].cone) {       // aimed at a unit: any of its hexes will do
      const t = unitAt(view, a);
      return !!t && aims.some((h) => h.id === t.id);
    }
    return aims.some((h) => h.q === a.q && h.r === a.r);
  }
  if (a.type === 'attack') {
    const t = unitById(state, a.target);
    return !!t && targetsFrom(state, u, u).includes(t);
  }
  return false;
}

// Mutates `state`. Does NOT validate (so simulations stay fast) — call isLegal first for
// untrusted actions. Returns {dmg, killed, counter: {dmg, killed} | null} for attacks. Under fog, a move on the true state
// follows the path the mover planned and stops short if a hidden enemy is in the way; it
// then returns {path, ambushed}.
export function applyAction(state, a) {
  if (a.type === 'endTurn') {
    let ev = null;
    const ending = state.turn;
    if (state.mode === 'hold' && ending === WILD) {      // a monster squatting on a point makes it nobody's
      state.objectives.forEach((o, i) => { if (unitAt(state, o)?.team === WILD) state.owners[i] = null; });
    } else if (state.mode === 'hold') {          // returns {team, captured: [{i, team}], scored}
      ev = { team: state.turn, captured: [], scored: 0 };
      state.objectives.forEach((o, i) => {
        const holder = unitAt(state, o);
        if (holder && holder.team === WILD) state.owners[i] = null;
        else if (holder && state.owners[i] !== holder.team) { state.owners[i] = holder.team; ev.captured.push({ i, team: holder.team }); }
      });
      ev.scored = state.owners.filter((o) => o === state.turn).length;
      state.score[state.turn] += ev.scored;
      if (state.score[state.turn] >= state.target) { state.winner = state.turn; return ev; }
    }
    // Order: 0, 1, then the neutral monsters if there are any.
    state.turn = ending === 0 ? 1 : ending === 1 && state.units.some((u) => u.team === WILD) ? WILD : 0;
    if (state.turn === 0) state.round++;
    for (const u of state.units) {
      u.moved = false; u.acted = false;
      if (u.team === ending && u.frozen) u.frozen = 0;                         // its frozen turn is over
      if (u.team !== state.turn) continue;
      for (const sp of CLASSES[u.cls].spells || []) if (u['cd_' + sp] > 0) u['cd_' + sp]--;
      if (CLASSES[u.cls].regen) u.hp = Math.min(CLASSES[u.cls].hp, u.hp + CLASSES[u.cls].regen);
    }
    if (state.round > state.maxRounds) {         // out of time: on points if there are any, else a draw
      const [s0, s1] = state.score;
      state.winner = s0 > s1 ? 0 : s1 > s0 ? 1 : 'draw';
    }
    // The monsters' phase plays itself, unless the caller wants to step through it (a.step) with wildAction.
    if (state.turn === WILD && !a.step) {
      for (let i = 0; i < 300 && state.turn === WILD && state.winner === null; i++) applyAction(state, wildAction(state));
    }
    return ev;
  }
  const u = unitById(state, a.unit);
  if (a.type === 'move') {
    const big = isBig(u);
    const dest = big ? { q: a.q, r: a.r, o: a.o || 0 } : { q: a.q, r: a.r };
    const put = (p) => { u.q = p.q; u.r = p.r; if (big) u.o = p.o; };
    if (!state.fog || state.observer !== undefined) { put(dest); u.moved = true; return null; }
    const path = pathTo(reachable(observe(state, u.team), u), dest);
    u.moved = true;
    const zone = controlZone(state, u.team);      // includes zones of enemies the mover can't see
    let end = 0, ambushed = false;
    if (glides(u.cls)) {                          // lands on the last spot along its flight that is really free
      for (let i = 1; i < path.length; i++) if (fits(state, u, path[i])) end = i;
      ambushed = end < path.length - 1;
      put(path[end]);
      return { path: path.slice(0, end + 1), ambushed };
    }
    for (let i = 1; i < path.length; i++) {
      const others = footprint(u, path[i]).map((c) => unitAt(state, c)).filter((x) => x && x.id !== u.id);
      if (others.some((x) => x.team !== u.team)) { ambushed = true; break; }
      if (!others.length) end = i;               // allies can be passed but not stopped on
      if (i < path.length - 1 && footprint(u, path[i]).some((c) => zone.has(key(c.q, c.r)))) { ambushed = true; break; }
    }
    put(path[end]);
    return { path: path.slice(0, end + 1), ambushed };
  }
  u.moved = true; u.acted = true;
  if (a.type === 'cast') {                       // returns {hits: [{unit (as it was), dmg, killed}]}
    const s = SPELLS[a.spell];
    u['cd_' + a.spell] = s.cooldown;
    if (s.blink) {                               // fizzles if a hidden enemy is standing there
      const from = { q: u.q, r: u.r }, fizzled = !!unitAt(state, a);
      if (!fizzled) { u.q = a.q; u.r = a.r; }
      return { hits: [], from, fizzled };
    }
    const hits = spellHits(state, a.spell, a, u).map(({ unit: t, dmg }) => {
      const before = { ...t };
      t.hp -= dmg;
      if (s.freeze && t.hp > 0) t.frozen = s.snare ? 2 : 1;
      return { unit: before, dmg, killed: t.hp <= 0 };
    });
    state.units = state.units.filter((x) => x.hp > 0);
    settle(state);
    return { hits };
  }
  if (a.type === 'attack') {
    const t = unitById(state, a.target);
    const dmg = damage(state.map, u, u, t);
    t.hp -= dmg;
    const killed = t.hp <= 0;
    let counter = null;
    if (!killed) {                               // the defender strikes back if the attacker is in its reach
      const back = counterDamage(state, t, u);
      if (back) { u.hp -= back; counter = { dmg: back, killed: u.hp <= 0 }; }
    }
    if (killed || counter?.killed) {
      state.units = state.units.filter((x) => x.hp > 0);
      settle(state);
    }
    return { dmg, killed, counter };
  }
  return null;
}

// ---- Neutral monsters ----
//
// The next action for the neutral monsters (state.turn must be WILD); {type:'endTurn'} when they are
// done. Deterministic, like everything else here, so AIs can simulate through their phase — which
// applyAction does by itself after the second player's endTurn.
// Behaviour: a monster goes for any unit of either army that sets foot within WILD_RANGE hexes of
// its home hex, hits whatever it can reach of those (preferring kills and big hits), strikes at
// anything standing next to it, and otherwise walks back home. It never casts spells.
// Under fog it only knows what the monsters themselves can see.
export function wildAction(state) {
  if (state.turn !== WILD || state.winner !== null) return { type: 'endTurn' };
  const view = state.fog && state.observer === undefined ? observe(state, WILD) : state;
  for (const u of view.units) {
    if (u.team !== WILD || u.acted) continue;
    const home = { q: u.hq ?? u.q, r: u.hr ?? u.r };
    const prey = view.units.filter((t) => t.team !== WILD && footprint(t).some((c) => dist(c, home) <= WILD_RANGE));
    let best = null, bestS = -Infinity;
    for (const o of unitOptions(view, u)) {
      if (o.cast || (o.target && o.cost > 0 && !prey.includes(o.target))) continue;
      let s = -o.cost * 0.01;
      if (o.target) {
        const d = Math.min(o.target.hp, damage(view.map, u, o, o.target));
        s += 100 + d * 10 + (d >= o.target.hp ? 40 : -4 * Math.min(u.hp, counterDamage(view, o.target, u, o)));
      } else if (prey.length) s -= Math.min(...prey.map((t) => unitDist(u, t, o)));
      else s -= dist(o, home);
      if (s > bestS) { bestS = s; best = o; }
    }
    if (best && (best.q !== u.q || best.r !== u.r || (best.o !== undefined && best.o !== u.o))) {
      return best.o === undefined ? { type: 'move', unit: u.id, q: best.q, r: best.r } : { type: 'move', unit: u.id, q: best.q, r: best.r, o: best.o };
    }
    if (best?.target) return { type: 'attack', unit: u.id, target: best.target.id };
    return { type: 'wait', unit: u.id };
  }
  return { type: 'endTurn' };
}

// Simple material evaluation from `team`'s point of view. A starting point, not gospel.
export function evaluate(state, team) {
  if (state.winner === team) return 1000;
  if (state.winner === 1 - team) return -1000;
  let v = 0;
  for (const u of state.units) v += (u.team === team ? 1 : u.team === WILD ? -0.25 : -1) * (4 + 6 * u.hp / CLASSES[u.cls].hp) * (CLASSES[u.cls].value || 1);
  if (state.unseen) v += (state.observer === team ? -1 : 1) * state.unseen * 8;   // enemies we can't see still count
  if (state.mode === 'hold') {                   // points on the board, and points already banked
    v += (state.score[team] - state.score[1 - team]) * 5;
    for (const o of state.owners) v += o === team ? 4 : o === 1 - team ? -4 : 0;
  }
  return v;
}
