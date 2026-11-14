// Greedy: score every (unit, destination, target) option with a hand-written heuristic and
// take the best one. No lookahead at all — it charges, focuses kills, and likes cover and height.
import { CLASSES, TERRAIN, SPELLS, maxHp, unitAt, cellAt, unitOptions, damage, distanceField, applyAction, visibleCells, spellHits, counterDamage, footprint } from '../engine.js';
import { key, dist } from '../hex.js';

function scoreOption(state, u, o, enemies, field, asleep = false, quiet = false) {
  const cell = cellAt(state.map, o);
  const ranged = CLASSES[u.cls].rmax > 1;
  // Cover and height only matter once the enemy is close; otherwise a unit would camp in the first ruin it finds.
  // (With no enemy in view at all, it is exploring, and cover means nothing.)
  const far = quiet || (field.get(key(o.q, o.r)) ?? 99) > 8;
  let s = far ? 0 : TERRAIN[cell.t].cover * 3 + cell.e * 2;
  if (o.target) {
    const d = Math.min(o.target.hp, damage(state.map, u, o, o.target));
    s += d * 10 + (d >= o.target.hp ? 40 : 0) + 10 * d / o.target.hp;
    if (d < o.target.hp) {                                            // it survives, so it may hit back
      const back = Math.min(u.hp, counterDamage(state, o.target, u, o));
      s -= back * 8 + (back >= u.hp ? 45 : 0);
    }
  }
  if (o.cast) {                                                       // spells: same scale, allies count against
    const spell = SPELLS[o.cast.spell];
    for (const { unit: t, dmg } of spellHits(state, o.cast.spell, o.cast, o)) {
      if (t.id === u.id) continue;
      const d = Math.min(t.hp, dmg), v = d * 10 + (d >= t.hp ? 40 : 0) + 10 * d / t.hp;
      s += t.team === u.team ? -1.3 * v : v;
      if (spell.freeze && t.team !== u.team && d < t.hp) s += 8;      // pinning something in place is worth a bit
    }
    if (spell.heal) {                                                 // mending a friend: worth about what the same damage to a foe is
      const t = unitAt(state, o.cast);
      if (t) s += Math.min(spell.heal, maxHp(t) - t.hp) * 9;
    }
    s -= spell.cooldown * 2;                                          // don't burn a long cooldown for a marginal gain
  }
  if (state.mode === 'hold' || state.mode === 'siege') {              // ending the turn on a point we don't own takes it
    const on = footprint(u, o);                                       // big creatures hold a point with any hex
    const i = state.objectives.findIndex((p) => on.some((c) => c.q === p.q && c.r === p.r));
    if (i >= 0 && state.owners[i] !== u.team) s += state.owners[i] === null ? 30 : 42;
  }
  if (asleep) s -= dist(o, u) * 2;                                    // nobody near: stay put
  else s -= (field.get(key(o.q, o.r)) ?? 99) * (ranged ? 1.5 : 2.5);  // close the distance
  if (ranged && enemies.some((e) => dist(e, o) < 2)) s -= 8;          // archers hate melee
  return s;
}

const asleepSide = (state) => state.mode === 'raid' && state.turn === state.defender;
const WAKE = 10;                                     // moves away at which a raided colony's defenders stir

// Best next action for the side to move, or null when every unit is done.
// noise > 1 picks randomly among the top `noise` options (used by the sampler to diversify plans).
// goals: extra places to advance on besides the enemies in view (see fogGoals).
export function bestAction(state, noise = 0, rng = Math.random, goals = []) {
  const enemies = state.units.filter((u) => u.team !== state.turn);
  // Advance on enemies, on fog goals, and on any control point that isn't ours yet.
  const pointMode = state.mode === 'hold' || state.mode === 'siege';
  const points = pointMode ? state.objectives.filter((p, i) => state.owners[i] !== state.turn) : [];
  // Neutral monsters are fought when they are in the way, but not marched on.
  let foes = enemies.filter((u) => u.team === 1 - state.turn);
  let home = [];
  if (state.mode === 'siege' && state.turn === state.defender) {
    // Defending: stay by the keep and meet whoever comes within reach of it, rather than marching out.
    home = state.objectives;
    foes = foes.filter((u) => state.objectives.some((p) => dist(p, u) <= 5));
  }
  const toward = [...foes, ...goals, ...points, ...(foes.length ? [] : home)];
  const field = distanceField(state.map, toward.length ? toward : enemies);
  const quiet = !!state.fog && !foes.length && !asleepSide(state);     // nobody in view: go and look
  const cands = [];
  for (const u of state.units) {
    if (u.team !== state.turn || u.acted) continue;
    // A colony being raided doesn't march out: each defender keeps its post until a raider comes near.
    const asleep = state.mode === 'raid' && u.team === state.defender && (field.get(key(u.q, u.r)) ?? 99) > WAKE;
    for (const o of unitOptions(state, u)) cands.push({ u, o, s: scoreOption(state, u, o, enemies, field, asleep, quiet) });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.s - a.s);
  const { u, o } = cands[noise > 1 ? Math.floor(rng() * Math.min(noise, cands.length)) : 0];
  if (o.q !== u.q || o.r !== u.r || (o.o !== undefined && o.o !== u.o)) {
    return o.o === undefined ? { type: 'move', unit: u.id, q: o.q, r: o.r } : { type: 'move', unit: u.id, q: o.q, r: o.r, o: o.o };
  }
  if (o.target) return { type: 'attack', unit: u.id, target: o.target.id };
  if (o.cast) return { type: 'cast', unit: u.id, ...o.cast };
  return { type: 'wait', unit: u.id };
}

// Plays out the rest of the current turn on `state` (mutating it); returns the actions taken.
export function playTurn(state, noise = 0, rng = Math.random, goals = []) {
  const actions = [];
  const turn = state.turn;
  while (state.winner === null && state.turn === turn) {
    const a = bestAction(state, noise, rng, goals) || { type: 'endTurn' };
    applyAction(state, a);
    actions.push(a);
  }
  return actions;
}

// Under fog: where to head when enemies are out of sight. `memory` (a Map the AI keeps for the
// whole game) remembers where each enemy was last seen; a memory is dropped once we can see that
// the hex is empty. With nothing remembered, head for the enemy start area, then for the nearest
// unexplored ground.
export function fogGoals(state, memory) {
  if (!state.fog) return [];
  const team = state.turn, vis = state.vis || visibleCells(state, team);
  const mine = state.units.filter((u) => u.team === team);
  const inView = new Set();
  for (const u of state.units) if (u.team === 1 - team) { inView.add(u.id); memory.set(u.id, { q: u.q, r: u.r }); }
  for (const [id, p] of memory) {
    if (inView.has(id) || !vis.has(key(p.q, p.r))) continue;
    if (cellAt(state.map, p).t !== 'forest' || mine.some((m) => dist(m, p) <= 1)) memory.delete(id);
  }
  let goals = [...memory].filter(([id]) => !inView.has(id)).map(([, p]) => p);
  // Ground we have looked at since we last saw anybody. Without it, a hex that drops out of view
  // becomes a goal again and the army paces back and forth instead of pushing on.
  const explored = memory.explored || (memory.explored = new Set());
  if (inView.size) explored.clear();               // contact: what we knew about empty ground is stale
  for (const k of vis) explored.add(k);
  if (inView.size || goals.length) return goals;
  if (!state.unseen) return [];
  const open = (c) => c.t !== 'rock' && c.t !== 'lava' && !explored.has(key(c.q, c.r));
  goals = state.map.spawns[1 - team].filter((p) => open(cellAt(state.map, p)));
  if (goals.length) return goals;
  goals = Object.values(state.map.cells).filter(open);
  if (goals.length) return goals;
  explored.clear();                                // looked everywhere and they are still out there: start again
  for (const k of vis) explored.add(k);
  return Object.values(state.map.cells).filter(open);
}

export default {
  label: 'Greedy',
  create() {
    const memory = new Map();
    return { chooseAction: (state) => bestAction(state, 0, Math.random, fogGoals(state, memory)) || { type: 'endTurn' } };
  },
};
