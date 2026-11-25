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
import { clone, evaluate, isLegal, applyAction, distanceField, visibleCells, fits, unitById, CLASSES } from '../engine.js';
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
    let thought = null;                           // what the last plan was chosen from, for the "AI thinking" view

    // A plan as arrows to draw: [{t: 'move'|'attack'|'cast'|'watch', cls, from, to}], worked out by
    // playing it on a copy of the state.
    function trace(state, actions) {
      const s = clone(state), steps = [];
      for (const a of actions) {
        if (a.type === 'endTurn') break;
        const u = unitById(s, a.unit);
        if (!u) continue;
        const from = { q: u.q, r: u.r, o: u.o, cls: u.cls };
        if (a.type === 'move') steps.push({ t: 'move', from, to: { q: a.q, r: a.r, o: a.o, cls: u.cls } });
        else if (a.type === 'attack') { const x = unitById(s, a.target); if (x) steps.push({ t: 'attack', from, to: { q: x.q, r: x.r, o: x.o, cls: x.cls } }); }
        else if (a.type === 'cast') steps.push({ t: 'cast', from, to: { q: a.q, r: a.r }, spell: a.spell });
        else if (a.type === 'overwatch') steps.push({ t: 'watch', from, to: from });
        if (isLegal(s, a)) applyAction(s, a);
      }
      return steps;
    }

    // Update the belief from what is visible now; return the enemies that are alive but unseen.
    // `tick` counts half-turns, so (now - tick) / 2 is how many turns that enemy has had since.
    function track(state) {
      const team = state.turn, foe = 1 - team, tick = state.round * 2 + team;
      if (!belief) {
        belief = new Map();
        for (const s of state.roster) {
          if (s.team === foe) belief.set(s.id, { q: s.q, r: s.r, o: s.o, cls: s.cls, hp: s.max || CLASSES[s.cls].hp, tick: 2 - team });
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
      const heat = new Map();                                         // hex -> how strongly we suspect someone is there
      if (hidden.length && worlds > 0) {
        const vis = state.vis || visibleCells(state, team);
        const mine = state.units.filter((u) => u.team === team);
        const options = hidden.map((h) => whereabouts(state, h, vis, mine));
        guesses = Array.from({ length: worlds }, () => makeWorld(state, hidden, options));
        for (const opts of options) {
          const sum = opts.reduce((t, o) => t + o.w, 0) || 1;
          for (const o of opts) heat.set(key(o.q, o.r), (heat.get(key(o.q, o.r)) || 0) + o.w / sum);
        }
      }
      const count = guesses.length ? Math.max(8, Math.round(samples * 0.6)) : samples;
      let best = null, bestVal = -Infinity;
      const tried = [];
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
        tried.push({ val, actions, i });
        if (val > bestVal) { bestVal = val; best = actions; }
      }
      // For the "AI thinking" view: the chosen plan and the two best different ones, what it
      // believes about hidden enemies, and how the plans it tried scored.
      const ranked = tried.slice().sort((a, b) => b.val - a.val || a.i - b.i), shown = [], had = new Set();
      for (const c of ranked) {
        const sig = JSON.stringify(c.actions);
        if (had.has(sig)) continue;
        had.add(sig);
        shown.push({ val: c.val, steps: trace(state, c.actions) });
        if (shown.length === 3) break;
      }
      const now = state.round * 2 + team;
      thought = { kind: 'sampler', team, round: state.round, tried: count, worlds: guesses.length, distinct: new Set(tried.map((c) => JSON.stringify(c.actions))).size,
        best: bestVal, greedy: tried[0].val, worst: ranked[ranked.length - 1].val, plans: shown,
        hidden: hidden.map((h) => ({ cls: h.cls, q: h.q, r: h.r, o: h.o, turns: Math.max(0, Math.ceil((now - h.tick) / 2)) })),
        heat: [...heat].sort((a, b) => b[1] - a[1]).slice(0, 500).map(([k, p]) => { const [q, r] = k.split(',').map(Number); return { q, r, p }; }),
        guesses: guesses.map((w) => w.units.filter((u) => hidden.some((h) => h.id === u.id)).map((u) => ({ q: u.q, r: u.r, o: u.o, cls: u.cls }))) };
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
      explain: () => thought,
    };
  },
};
