// Plan sampler: a tiny Monte-Carlo search over whole turns.
// Generates many candidate turns (greedy with noise), plays each forward through the opponent's
// greedy reply and our greedy follow-up, and keeps the plan with the best resulting evaluation.
// Sample 0 is the pure greedy plan, so this never does worse than Greedy by its own estimate.
//
// Under fog of war it also guesses where the enemies it can't see are ("determinization"):
//   1. Belief: for every enemy, remember where and when it was last seen (never seen = its start hex).
//   2. Each hidden enemy could be on any hex it had time to reach that we can't currently see into.
//   3. Build a few complete "worlds" by dropping each hidden enemy onto one such hex at random.
//   4. Score every candidate plan in every world and keep the plan with the best average.
// So a plan that walks a unit past dark woods is charged for the worlds where something is in them.
import { clone, evaluate, isLegal, applyAction, distanceField, visibleCells, fits, CLASSES } from '../engine.js';
import { makeRng } from '../mapgen.js';
import { key, dist } from '../hex.js';
import { playTurn, fogGoals } from './greedy.js';

export default {
  label: 'Plan sampler',
  // worlds: how many guesses about hidden enemies to average over (0 = ignore hidden enemies).
  create({ samples = 24, worlds = 4, seed = 12345 } = {}) {
    const rng = makeRng(seed);
    let plan = [], planFor = null;
    const memory = new Map();                     // last-seen enemy positions, for fogGoals
    let belief = null;                            // enemy id -> { q, r, cls, hp, tick }

    // Update the belief from what is visible now; return the enemies that are alive but unseen.
    // `tick` counts half-turns, so (now - tick) / 2 is how many turns that enemy has had since.
    function track(state) {
      const team = state.turn, foe = 1 - team, tick = state.round * 2 + team;
      if (!belief) {
        belief = new Map();
        for (const s of state.roster) {
          if (s.team === foe) belief.set(s.id, { q: s.q, r: s.r, o: s.o, cls: s.cls, hp: CLASSES[s.cls].hp, tick: 2 - team });
        }
      }
      const seen = new Set();
      for (const u of state.units) {
        if (u.team !== foe) continue;
        seen.add(u.id);
        belief.set(u.id, { q: u.q, r: u.r, o: u.o, cls: u.cls, hp: u.hp, tick });
      }
      // The game tells us how many enemies are hidden. If we believe in more than that, the
      // surplus are dead: most likely the ones that vanished just now, weakest first.
      const hidden = [...belief].filter(([id]) => !seen.has(id));
      hidden.sort((a, b) => b[1].tick - a[1].tick || a[1].hp - b[1].hp);
      for (let i = 0; i < hidden.length - (state.unseen || 0); i++) belief.delete(hidden[i][0]);
      return [...belief].filter(([id]) => !seen.has(id)).map(([id, b]) => ({ id, ...b }));
    }

    // Hexes a hidden enemy might be on, weighted toward the ones nearer our units (enemies tend
    // to close in). It must be reachable in the time since we saw it, and somewhere we can't see.
    function whereabouts(state, h, vis, mine) {
      const turns = (state.round * 2 + state.turn - h.tick) / 2;
      if (turns <= 0) return [{ q: h.q, r: h.r, w: 1 }];            // lost sight this turn: it hasn't moved
      const budget = turns > 3 ? Infinity : CLASSES[h.cls].move * turns;
      const field = distanceField(state.map, [h]);
      const out = [];
      for (const c of Object.values(state.map.cells)) {
        const k = key(c.q, c.r), cost = field.get(k);
        if (c.t === 'rock' || c.t === 'lava' || cost === undefined || cost > budget) continue;
        const hidden = !vis.has(k) || (c.t === 'forest' && !mine.some((m) => dist(m, c) <= 1));
        if (!hidden) continue;
        let near = Infinity;
        for (const m of mine) near = Math.min(near, dist(m, c));
        out.push({ q: c.q, r: c.r, w: 1 / (1 + near) });
      }
      return out.length ? out : [{ q: h.q, r: h.r, w: 1 }];
    }

    // One complete guess: the observed state plus every hidden enemy placed somewhere plausible.
    function makeWorld(state, hidden, options) {
      const s = clone(state);
      const taken = new Set(s.units.map((u) => key(u.q, u.r)));
      hidden.forEach((h, i) => {
        // Somewhere free where the whole creature fits (big ones are guessed in their last-known facing).
        const ghost = { id: h.id, cls: h.cls };
        const free = options[i].filter((o) => !taken.has(key(o.q, o.r)) && fits(s, ghost, { q: o.q, r: o.r, o: h.o || 0 }));
        if (!free.length) return;
        let pick = rng() * free.reduce((sum, o) => sum + o.w, 0), spot = free[0];
        for (const o of free) { pick -= o.w; if (pick <= 0) { spot = o; break; } }
        taken.add(key(spot.q, spot.r));
        s.units.push({ id: h.id, team: 1 - state.turn, cls: h.cls, q: spot.q, r: spot.r, o: h.o, hp: h.hp, moved: false, acted: false });
      });
      s.unseen = 0;
      return s;
    }

    function makePlan(state, hidden) {
      const team = state.turn;
      const goals = fogGoals(state, memory);
      let guesses = [];
      if (hidden.length && worlds > 0) {
        const vis = state.vis || visibleCells(state, team);
        const mine = state.units.filter((u) => u.team === team);
        const options = hidden.map((h) => whereabouts(state, h, vis, mine));
        guesses = Array.from({ length: worlds }, () => makeWorld(state, hidden, options));
      }
      const count = guesses.length ? Math.max(8, Math.round(samples * 0.6)) : samples;
      let best = null, bestVal = -Infinity;
      for (let i = 0; i < count; i++) {
        const s0 = clone(state);
        const actions = playTurn(s0, i === 0 ? 0 : 3, rng, goals);    // a candidate turn, from what we can see
        let total = 0;
        for (const world of guesses.length ? guesses : [null]) {
          let s = s0;
          if (world) {                                                // replay the turn in this guess;
            s = clone(world);                                         // steps a hidden enemy blocks are lost
            for (const a of actions) if (a.type === 'endTurn' || isLegal(s, a)) applyAction(s, a);
          }
          if (s.winner === null) playTurn(s);                         // opponent replies
          if (s.winner === null) playTurn(s, 0, rng, goals);          // we follow up
          total += evaluate(s, team);
        }
        const val = total / (guesses.length || 1);
        if (val > bestVal) { bestVal = val; best = actions; }
      }
      return best;
    }

    return {
      chooseAction(state) {
        const hidden = state.fog ? track(state) : [];
        const id = state.round + ':' + state.turn;
        // Replan if the turn changed, or the plan no longer fits (an ambush cut a move short).
        if (planFor !== id || !plan.length || !isLegal(state, plan[0])) { plan = makePlan(state, hidden); planFor = id; }
        return plan.shift();
      },
    };
  },
};
