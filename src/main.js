// Browser UI: human input, AI turn loop, animation, and the map editor. All rules live in engine.js.
import { generateMap, mapFromData, mapToData, mapProblem, rectBoard } from './mapgen.js';
import * as E from './engine.js';
import { AIS } from './ai/index.js';
import { Renderer } from './render.js';
import { key, dist, hexRound, DIRS } from './hex.js';
import { paintBackdrop } from './paint.js';
import { play, unlock, setEnabled } from './sound.js';

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const R = new Renderer(canvas);
const TEAM = ['Blue', 'Red', 'Wild'];
const R3 = Math.sqrt(3);

let state, ais = [null, null];
let gen = 0;            // bumped on every new game so stale async work can bail out
let busy = false;       // an animation or AI turn is in progress
let sel = null, reach = null, undo = null, hover = null;
let custom = null;      // map data (see mapgen.js) when playing a hand-made map; null = random seed
let editing = false;    // editor is open; state.map is the working copy
let obs = null;         // what the player at the screen may know: state, minus unseen enemies under fog
let lastSeen = [new Map(), new Map()];   // per team: enemy id -> where it was last seen
let brush = 't:forest';
let casting = null;     // spell being aimed by the selected unit, or null
let mousePx = null;     // last mouse position over the board, in canvas pixels
const view = { reach: null, selected: null, targets: new Set(), hoverTargets: new Set(), threat: null,
  sight: null, ghost: null, hover: null, anim: null, floats: [], fogVis: null, ghosts: [], fx: [], shake: null };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const speed = () => +$('speed').value;
const unit = (id) => E.unitById(state, id);
const label = (u) => `${TEAM[u.team]} ${E.CLASSES[u.cls].name}`;
const spot = (u) => ({ q: u.q, r: u.r, o: u.o, cls: u.cls });      // where a unit is, for effects and numbers

// Where the selected unit would go for the hex under the mouse: a node of `reach`, or null.
// A big creature can cover a hex in several ways; take the one centred nearest the cursor.
function destAt(me) {
  if (!me || !view.reach || !hover) return null;
  if (!E.isBig(me)) return view.reach.get(key(hover.q, hover.r)) || null;
  let best = null, bestD = Infinity;
  for (const n of view.reach.values()) {
    if (!n.stop || n.cost === 0 || !E.footprint(me, n).some((c) => c.q === hover.q && c.r === hover.r)) continue;
    const p = R.centre({ cls: me.cls, ...n });
    const d = mousePx && p ? Math.hypot(p.x - mousePx.x, p.y - mousePx.y) : n.cost;
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}
const store = (k, v) => { try { v === undefined ? null : localStorage.setItem(k, v); return localStorage.getItem(k); } catch { return null; } };

function log(text) {
  const el = $('log');
  el.appendChild(Object.assign(document.createElement('div'), { textContent: text }));
  while (el.children.length > 80) el.firstChild.remove();
  el.scrollTop = el.scrollHeight;
}

function newGame() {
  gen++;
  busy = false;
  const map = custom ? mapFromData(custom) : generateMap(Math.max(1, Math.floor(+$('seed').value) || 1), +$('size').value || 6);
  state = E.createGame(map, { fog: !editing && $('fog').checked, counters: $('counters').checked, zoc: $('zoc').checked,
    mode: editing ? 'eliminate' : $('mode').value, dragons: editing ? 'none' : $('dragons').value,
    monsters: editing || $('monsters').value === 'none' ? [] : $('monsters').value === 'cave' ? E.PACKS.cave : undefined,
    wild: editing || $('wild').value === 'map' ? undefined : $('wild').value === 'none' ? [] : 'auto' });
  lastSeen = [new Map(), new Map()];
  sel = reach = undo = hover = casting = null;
  celebrated = false;
  view.anim = null; view.floats = []; view.fx = []; view.shake = null; view.scorch = new Map();
  makeAIs();
  R.pad = editing ? 2 : 0;
  R.layout(state.map);
  $('log').textContent = '';
  log(custom ? `New game on ${custom.name ? `map "${custom.name}"` : 'unsaved custom map'}` : `New game on map seed ${state.map.seed}`);
  refresh();
  if (!editing) pump();
}

// AIs think in a background worker (src/ai/worker.js) so the page never freezes; the instances here
// are only used if the browser can't start one. A new game or a change of controller starts a
// fresh worker, which also abandons whatever the old one was still working on.
let brain = null, asked = 0, thinking = false;
const waiting = new Map();
function makeAIs() {
  const ids = [0, 1].map((t) => ($('ctl' + t).value === 'human' ? null : $('ctl' + t).value));
  ais = ids.map((v) => (v ? AIS[v].create() : null));
  if (brain) brain.terminate();
  for (const done of waiting.values()) done({ cancelled: true });     // let whoever was waiting give up
  brain = null; waiting.clear(); thinking = false;
  if (!state || !ids.some(Boolean)) return;
  try {
    brain = new Worker(new URL('./ai/worker.js', import.meta.url), { type: 'module' });
    const mine = brain;
    brain.onmessage = (ev) => { const done = waiting.get(ev.data.id); waiting.delete(ev.data.id); if (done) done(ev.data); };
    brain.onerror = (ev) => {                              // couldn't start or crashed: think on the page instead
      console.warn('AI worker failed; thinking on the main thread', ev.message || ev);
      if (brain === mine) brain = null;
      for (const done of waiting.values()) done({ error: 'worker failed' });
      waiting.clear();
    };
    const { losCache, ...map } = state.map;
    brain.postMessage({ type: 'init', map, ais: ids });
  } catch (err) { console.warn('No AI worker', err); brain = null; }
}
// Ask the AI for `team` what to do, given what it may know. Resolves with an action.
async function think(team, known) {
  if (brain) {
    const { map, ...rest } = known;
    const reply = await new Promise((done) => { const id = ++asked; waiting.set(id, done); brain.postMessage({ type: 'choose', id, team, state: rest }); });
    if (reply.cancelled) return null;
    if (!reply.error) return reply.action;
    console.warn('AI worker error:', reply.error);
  }
  return ais[team].chooseAction(E.clone(known));
}

// Whose eyes the screen shows under fog: the human's; with two humans, whoever's turn it is;
// with none (AI vs AI), nobody — the spectator sees everything.
function viewer() {
  if (!state.fog || editing) return null;
  const pick = $('fogView').value;                       // an explicit choice, e.g. to watch what an AI knows
  if (pick !== 'auto') return pick === 'blue' ? 0 : pick === 'red' ? 1 : null;
  const humans = [0, 1].filter((t) => !ais[t]);
  return humans.length === 1 ? humans[0] : humans.length === 2 ? state.turn : null;
}

// Recompute what the viewer can see, and each team's last-seen markers.
function updateFog() {
  const v = viewer();
  obs = v === null ? state : E.observe(state, v);
  view.fogVis = v === null ? null : obs.vis;
  view.ghosts = [];
  if (!state.fog || editing) return;
  for (const t of [0, 1]) {
    const o = t === v ? obs : E.observe(state, t), inView = new Set();
    for (const u of o.units) {
      if (u.team === t) continue;
      inView.add(u.id);
      lastSeen[t].set(u.id, { q: u.q, r: u.r, o: u.o, cls: u.cls, team: u.team });
    }
    for (const [id, p] of lastSeen[t]) {
      if (inView.has(id) || !o.vis.has(key(p.q, p.r))) continue;
      const hidesInForest = E.cellAt(state.map, p).t === 'forest' && !o.units.some((m) => m.team === t && dist(m, p) <= 1);
      if (!hidesInForest) lastSeen[t].delete(id);          // we can see it is no longer there
    }
    if (t === v) view.ghosts = [...lastSeen[t]].filter(([id]) => !inView.has(id)).map(([, p]) => p);
  }
}

// Sync derived view state + DOM with the game state.
function refresh() {
  const b = $('banner');
  updateFog();
  $('seed').disabled = !!custom;
  $('size').disabled = !!custom;
  if (editing) {
    Object.assign(view, { selected: null, reach: null, reachCells: null, destCells: null, targets: new Set(), hoverTargets: new Set(), threat: null, sight: null });
    const cell = hover && E.cellAt(state.map, hover);
    view.hover = cell ? hover : null;
    view.ghost = hover && !cell && brush === 'add' ? hover : null;
    $('end').disabled = $('undo').disabled = true;
    view.objectives = (state.map.objectives || []).map((o) => ({ ...o, owner: null }));
    b.className = 'edit';
    b.textContent = 'Editing map — paint hexes, then "Play this map"';
    $('info').textContent = infoText(null);
    return;
  }
  const me = sel !== null ? unit(sel) : null;
  view.objectives = state.objectives.map((o, i) => ({ ...o, owner: state.owners[i] }));
  if (!me) { sel = null; reach = null; view.reachCells = null; view.destCells = null; }
  view.ghost = null;
  view.selected = sel;
  view.reach = me && !me.moved ? reach : null;
  view.zone = view.reach ? E.controlZone(obs, me.team) : null;
  view.reachCells = view.reach
    ? new Set([...view.reach.values()].filter((n) => n.stop).flatMap((n) => E.footprint(me, n).map((c) => key(c.q, c.r)))) : null;
  view.destCells = null;
  view.targets = new Set(me && !me.acted ? E.targetsFrom(obs, me, me).map((t) => t.id) : []);
  view.hover = hover;
  view.hoverTargets = new Set();
  // Hovering a unit you can't currently attack shows everything it could hit next turn.
  const hu = hover && !busy ? E.unitAt(obs, hover) : null;
  view.threat = hu && hu.id !== sel && !view.targets.has(hu.id) && (hu.team !== state.turn || sel === null)
    ? E.threatZone(obs, hu) : null;
  // Selected ranged unit + hovered enemy: show the sight line and why a shot is or isn't possible.
  view.sight = null;
  if (me && !me.acted && hu && hu.team !== me.team && E.CLASSES[me.cls].rmax > 1) {
    const k = E.CLASSES[me.cls], d = dist(me, hu);
    const blocker = E.losBlocker(state.map, me, hu);
    const max = k.rmax + (E.cellAt(state.map, me).e > E.cellAt(state.map, hu).e ? 1 : 0);
    view.sight = { from: me, to: hu, d, blocker, status: blocker ? 'blocked' : d < k.rmin || d > max ? 'range' : 'ok' };
  }
  const dest = destAt(me);
  if (dest && dest.stop) {
    view.hoverTargets = new Set(E.targetsFrom(obs, me, dest).map((t) => t.id));
    if (E.isBig(me)) view.destCells = E.footprint(me, dest);
  }

  // Aiming a spell: show where it can go, and what the hex under the cursor would hit.
  view.castCells = null; view.aoe = null; view.castColor = null;
  if (casting && !(me && E.spellReady(me, casting))) casting = null;
  if (casting) {
    const spell = E.SPELLS[casting], hexes = E.castTargets(obs, me, casting);
    Object.assign(view, { reach: null, reachCells: null, destCells: null, threat: null, sight: null, hoverTargets: new Set(), targets: new Set() });
    if (spell.dmg && !spell.area && !spell.cone) {
      view.targets = new Set(hexes.map((h) => h.id));
    } else {
      view.castCells = new Set(hexes.map((h) => key(h.q, h.r)));
      view.castColor = spell.blink ? 'rgba(190,130,255,0.32)' : 'rgba(255,150,40,0.3)';
      if (spell.area && hover && view.castCells.has(key(hover.q, hover.r))) {
        view.aoe = [hover, ...DIRS.map(([dq, dr]) => ({ q: hover.q + dq, r: hover.r + dr }))];
      }
      if (spell.cone && hover && view.castCells.has(key(hover.q, hover.r))) view.aoe = E.coneCells(state.map, casting, me, hover);
    }
  }
  syncSpells(me);

  const human = !ais[state.turn] && state.winner === null;
  $('end').disabled = !human || busy;
  $('undo').disabled = !human || busy || !undo;
  $('undo').title = state.fog ? 'Not available under fog of war (a move may reveal enemies)' : '';
  if (state.winner !== null) {
    b.className = 'over';
    const heldOut = state.mode === 'siege' && state.winner === state.defender && state.units.some((u) => u.team !== state.winner);
    const onPoints = (state.mode === 'hold' || state.mode === 'siege') && !heldOut && state.winner !== 'draw' && state.units.some((u) => u.team !== state.winner);
    b.textContent = state.winner === 'draw' ? 'Draw — round limit reached'
      : heldOut ? `${TEAM[state.winner]} wins — the keep held out!`
      : `${TEAM[state.winner]} wins${onPoints ? ` on points, ${state.score[state.winner]}–${state.score[1 - state.winner]}` : ''}!`;
  } else {
    b.className = 't' + state.turn;
    const who = state.turn === E.WILD ? 'neutral monsters' : ais[state.turn] ? AIS[$('ctl' + state.turn).value].label + (thinking ? ', thinking\u2026' : '') : 'your move';
    b.textContent = `Round ${state.round}/${state.maxRounds} — ${TEAM[state.turn]} (${who})`
      + (state.mode === 'hold' ? `  ·  Blue ${state.score[0]} – ${state.score[1]} Red, first to ${state.target}` : '')
      + (state.mode === 'siege' ? `  ·  ${TEAM[1 - state.defender]} ${state.score[1 - state.defender]}/${state.target} to take the keep · ${TEAM[state.defender]} must hold to round ${state.maxRounds}` : '');
  }
  $('info').textContent = infoText(me);
}

// Spell buttons for the selected unit. Rebuilt only when something about them changes.
let spellSig = '';
function syncSpells(me) {
  const list = me && !me.acted && !ais[state.turn] && !editing ? E.CLASSES[me.cls].spells || [] : [];
  const sig = list.map((sp) => `${sp}:${me['cd_' + sp] || 0}:${casting === sp}:${busy}`).join('|');
  if (sig === spellSig) return;
  spellSig = sig;
  const box = $('spells');
  box.textContent = '';
  box.hidden = !list.length;
  list.forEach((sp, i) => {
    const cd = me['cd_' + sp] || 0, spell = E.SPELLS[sp];
    const btn = Object.assign(document.createElement('button'), {
      textContent: cd ? `${spell.name} (${cd})` : spell.name, disabled: cd > 0 || busy,
      title: `${SPELL_HELP[sp]} Range ${spell.rmin}–${spell.rmax}, recharges in ${spell.cooldown} turns. Key ${i + 1}.`,
    });
    btn.classList.toggle('on', casting === sp);
    btn.addEventListener('click', () => toggleCast(sp));
    box.appendChild(btn);
  });
}
const SPELL_HELP = {
  fireball: 'Explodes on a hex: 4 damage there, 2 to everything adjacent, friend or foe. Ignores cover.',
  frost: 'Hits one enemy for 2 and freezes it: it cannot move on its next turn.',
  breath: 'A cone of fire toward the hex you pick: 5 damage to everything in it, friend or foe. Rock and high ground give shelter.',
  web: 'Sticky strands over a hex and every hex around it: 1 damage, and enemies caught in it cannot move on their next turn.',
  blink: 'Teleports the wizard to any free hex in range, across water, cliffs and walls.',
};
function toggleCast(sp) {
  const me = sel !== null ? unit(sel) : null;
  if (!me || busy || !E.spellReady(me, sp)) return;
  casting = casting === sp ? null : sp;
  refresh();
}

function infoText(me) {
  if (!hover) return casting ? `${E.SPELLS[casting].name}: pick a target, or Esc to cancel.` : 'Hover a hex or unit for details.';
  const c = E.cellAt(state.map, hover);
  if (!c) return 'No hex here. Use the "Add hex" brush to extend the board.';
  const t = E.TERRAIN[c.t];
  const point = (view.objectives || []).find((o) => o.q === hover.q && o.r === hover.r);
  const tname = t.narrow && !state.map.ceiling ? 'Standing stones' : t.name;     // above ground they are menhirs
  const lines = [`${tname} · height ${c.e} · ` +
    (t.cost === Infinity ? (c.t === 'lava' ? 'impassable on foot; flyers cross; does not block sight' : 'impassable, blocks sight') : `move cost ${t.cost} · cover ${t.cover}`) + (t.narrow ? ' · too tight for big creatures' : '') + (t.tall && t.cost !== Infinity ? ' · blocks sight through it' : '')];
  if (point) {
    lines.push(`Control point — ${point.owner === null ? 'unclaimed' : 'held by ' + TEAM[point.owner]}`
      + (editing ? '' : '. End a turn standing here to take it.'));
  }
  const u = E.unitAt(obs, hover);
  if (view.fogVis && !view.fogVis.has(key(hover.q, hover.r))) lines.push('Out of sight');
  if (u) {
    const k = E.CLASSES[u.cls];
    lines.push(`${label(u)} — HP ${u.hp}/${k.hp}`,
      `ATK ${k.atk} · move ${k.move} · range ${k.rmin === k.rmax ? k.rmin : k.rmin + '–' + k.rmax + ' (+1 from high ground)'}${state.fog ? ` · sight ${k.sight}` : ''}`);
    if (k.size === 'large') lines.push('Large: occupies 3 hexes, cannot fit through single-hex gaps');
    if (k.pierce) lines.push('Lightning ignores cover');
    if (k.regen) lines.push(`Regenerates ${k.regen} HP at the start of each of its turns`);
    if (u.team === E.WILD) lines.push(`Neutral: attacks anyone who comes within ${E.WILD_RANGE} hexes of its lair`);
    if (k.fly) lines.push('Flies: every hex costs 1; passes over units, water and cliffs' + (state.map.ceiling ? ', but not through cave rock' : ' and rock'));
    if (k.burrow) lines.push('Burrows: tunnels under anything, rock included, and comes up wherever it fits');
    if (k.climb) lines.push('Climbs: height and cliffs cost nothing');
    if (state.zoc && k.rmax === 1) lines.push('Zone of control: enemies stepping adjacent must stop');
    if (u.frozen) lines.push(u.frozen === 2 ? 'Webbed: cannot move this turn' : 'Frozen: cannot move this turn');
    if (k.spells) {
      lines.push('Spells: ' + k.spells.map((sp) => E.SPELLS[sp].name + (u['cd_' + sp] ? ` (${u['cd_' + sp]})` : '')).join(', '));
    }
    if (view.threat) lines.push('Orange: can hit now · pale: after moving');
    if (me && view.targets.has(u.id)) {
      const d = E.damage(state.map, me, me, u);
      const back = d >= u.hp ? 0 : E.counterDamage(obs, u, me);
      lines.push(`→ Attack for ${d} damage${d >= u.hp ? ' (kills)' : ''}`
        + (back ? `, takes ${back} back${back >= me.hp ? ' (fatal!)' : ''}` : d >= u.hp ? '' : ', no counter'));
    }
  }
  return lines.join('\n');
}

// Leave a burn mark on the ground where a fireball landed (not on water).
function scorch(at) {
  if (E.cellAt(state.map, at)?.t !== 'water') view.scorch.set(key(at.q, at.r), Math.random() * 6.28);
}

// Shake the whole board briefly.
function quake(strength = 1) {
  const t0 = performance.now();
  (function step() {
    const t = (performance.now() - t0) / 380;
    if (t >= 1) { canvas.style.transform = ''; return; }
    const amp = (1 - t) * 7 * strength;
    canvas.style.transform = `translate(${(Math.random() - 0.5) * 2 * amp}px, ${(Math.random() - 0.5) * 2 * amp}px)`;
    requestAnimationFrame(step);
  })();
}

// Run fn(0..1) over `ms`, stopping early if a new game has started.
async function tween(ms, fn, g) {
  const t0 = performance.now();
  for (let k = 0; k < 1 && g === gen;) {
    k = Math.min(1, (performance.now() - t0) / ms);
    fn(k);
    await sleep(12);
  }
}

// ---- Attack animation pieces (used for both the attack and the counter-attack) ----

const lungeTo = (who, target, k) => {
  const pa = R.centre(who), pt = R.centre(target);
  view.anim = { id: who.id, x: pa.x + (pt.x - pa.x) * 0.42 * k, y: pa.y + (pt.y - pa.y) * 0.42 * k };
};

// What `who` does before its blow lands on `target`. Returns the spark colour for the impact.
async function windUp(g, who, target, seen) {
  if (!seen) return '#ffe9a8';
  const sp = speed(), from = spot(who), at = spot(target);
  const fx = (e) => view.fx.push({ t0: performance.now(), ...e });
  if (who.cls === 'wizard') {
    fx({ type: 'charge', at: from, dur: 240 / sp });
    play('charge');
    await sleep(240 / sp);
    fx({ type: 'bolt', from, to: at, dur: 380 / sp });
    play('zap');
    await sleep(110 / sp);
    return '#bfe6ff';
  }
  if (E.CLASSES[who.cls].rmax > 1) {
    const dur = (95 * dist(from, at) + 110) / sp;
    fx({ type: 'arrow', from, to: at, dur });
    play('arrow');
    await sleep(dur);
    return '#ffe9a8';
  }
  await tween(110 / sp, (k) => lungeTo(who, target, k), g);
  play('slash');
  const pa = R.centre(from), pt = R.centre(at);
  fx({ type: 'slash', at, angle: Math.atan2(pt.y - pa.y, pt.x - pa.x), dur: 260 / sp });
  return '#ffe9a8';
}

// Melee attackers step back after the lunge.
async function windDown(g, who, target, seen) {
  if (!seen || E.CLASSES[who.cls].rmax > 1) return;
  if (unit(who.id)) await tween(150 / speed(), (k) => lungeTo(who, target, 1 - k), g);
  if (g === gen) view.anim = null;
}

// Flash, sparks, damage number, and a shudder or a death fade on `victim` (a pre-hit snapshot).
function landBlow(victim, dmg, killed, color) {
  const sp = speed(), now = performance.now(), at = spot(victim);
  play('hit');
  view.fx.push({ type: 'flash', at, color: color === '#ffe9a8' ? '#ffffff' : '#d8f0ff', t0: now, dur: 220 / sp });
  view.fx.push({ type: 'sparks', at, color, t0: now, dur: 420 / sp, bits: Array.from({ length: 9 }, () => [Math.random() * 6.283, 0.5 + Math.random() * 0.9]) });
  if (killed) { view.fx.push({ type: 'death', unit: victim, t0: now, dur: 520 / sp }); play('death'); }
  else view.shake = { id: victim.id, t0: now, dur: 320 / sp };
  view.floats.push({ ...at, text: '-' + dmg, t0: now });
}

// Apply one action with animation.
async function perform(a) {
  const g = gen;
  if (a.type === 'move') {
    const u = unit(a.unit);
    const planned = state.fog ? null : E.pathTo(E.reachable(state, u), a);
    const ev = E.applyAction(state, a);
    const path = ev ? ev.path : planned;
    updateFog();
    const shown = obs.units.some((x) => x.id === u.id);    // don't animate moves the viewer can't see
    // A burrower sinks into the ground, travels as a moving mound of earth, and bursts out at the end.
    const digs = shown && E.CLASSES[u.cls].burrow && path.length > 1;
    const dirt = (p, n) => view.fx.push({ type: 'sparks', at: p, color: '#b39676', t0: performance.now(), dur: 520 / speed(),
      bits: Array.from({ length: n }, () => [Math.random() * 6.283, 0.5 + Math.random() * 1.2]) });
    const dive = async (p, from, to) => {
      const ms = 240 / speed(), t0 = performance.now();
      for (let t = 0; t < 1 && g === gen;) {
        t = Math.min(1, (performance.now() - t0) / ms);
        view.anim = { id: u.id, x: p.x, y: p.y, k: from + (to - from) * t };
        await sleep(12);
      }
    };
    if (digs) {
      const p = R.centre({ cls: u.cls, ...path[0] });
      play('dig'); dirt({ cls: u.cls, ...path[0] }, 14);
      await dive(p, 1, 0);
    }
    for (let i = 1; shown && i < path.length && g === gen; i++) {
      const p0 = R.centre({ cls: u.cls, ...path[i - 1] }), p1 = R.centre({ cls: u.cls, ...path[i] });
      if (shown && (!digs || i % 2)) play(digs ? 'rumble' : 'step');
      const ms = (E.isBig(u) ? 80 : 130) / speed(), t0 = performance.now();
      for (let t = 0; t < 1 && g === gen;) {
        t = Math.min(1, (performance.now() - t0) / ms);
        view.anim = digs ? { id: u.id, x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t, mound: true }
          : { id: u.id, x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t - Math.sin(t * Math.PI) * R.S * 0.15 };
        await sleep(12);
      }
    }
    if (digs && g === gen) {
      const p = R.centre({ cls: u.cls, ...path[path.length - 1] });
      play('dig'); dirt({ cls: u.cls, ...path[path.length - 1] }, 20); quake(0.35);
      await dive(p, 0, 1);
    }
    if (g === gen) view.anim = null;
    if (ev?.ambushed && g === gen) {
      view.floats.push({ ...spot(u), text: '!', t0: performance.now() });
      play('ambush');
      log(`${label(u)} runs into a hidden enemy and stops`);
    }
  } else if (a.type === 'attack') {
    const u = unit(a.unit), t = unit(a.target);
    const d = E.unitDist(u, t), sp = speed();
    const attacker = { ...u }, defender = { ...t };          // as they were before the exchange
    const seen = obs.units.some((x) => x.id === u.id);      // under fog, don't show where an unseen shot came from
    const who = seen ? label(u) : 'An unseen enemy';

    const color = await windUp(g, attacker, defender, seen);
    if (g !== gen) return;
    const ev = E.applyAction(state, a);
    // If the counter is about to kill the attacker, keep it on the board until that blow lands.
    if (ev.counter?.killed) view.fx.push({ type: 'hold', unit: attacker, t0: performance.now(), dur: 60000 });
    landBlow(defender, ev.dmg, ev.killed, color);
    log(`${who} hits ${label(defender)} for ${ev.dmg}${d > 1 ? ` from ${d} hexes` : ''}${ev.killed ? ' — defeated!' : ''}`);
    refresh();
    await windDown(g, attacker, defender, seen);
    await sleep((ev.killed ? 480 : 260) / sp);

    if (ev.counter && g === gen) {                          // the defender strikes back
      const back = await windUp(g, defender, attacker, true);
      if (g !== gen) return;
      view.fx = view.fx.filter((f) => f.type !== 'hold');
      landBlow(attacker, ev.counter.dmg, ev.counter.killed, back);
      log(`${label(defender)} strikes back for ${ev.counter.dmg}${ev.counter.killed ? ' — defeated!' : ''}`);
      refresh();
      await windDown(g, defender, attacker, true);
      await sleep((ev.counter.killed ? 480 : 260) / sp);
    }
  } else if (a.type === 'cast') {
    const u = unit(a.unit), spell = E.SPELLS[a.spell], sp = speed(), now = () => performance.now();
    const from = { q: u.q, r: u.r }, at = { q: a.q, r: a.r };
    const color = spell.blink ? 'arcane' : a.spell === 'frost' ? 'frost' : spell.snare ? 'web' : 'fire';
    const burnt = spell.cone ? E.coneCells(state.map, a.spell, u, at) : [];
    const known = new Set(obs.units.map((x) => x.id));       // under fog, only report what the viewer can see
    const seen = known.has(u.id), who = seen ? label(u) : 'An unseen enemy';
    const fx = (e) => view.fx.push({ t0: now(), ...e });

    if (seen) {
      fx({ type: 'charge', at: from, color, dur: 260 / sp });
      play('charge');
      await sleep(260 / sp);
      if (spell.blink) {
        fx({ type: 'blink', at: from, out: true, dur: 260 / sp });
        play('blink');
      } else if (spell.cone) {                               // a jet of flame; the damage lands as it peaks
        fx({ type: 'breath', from, to: at, reach: (spell.rmax + 0.5) / dist(from, at), dur: 900 / sp,
          bits: Array.from({ length: 90 }, () => [Math.random() - 0.5, 0.55 + Math.random() * 0.45, Math.random(), Math.random()]) });
        play('breath');
        quake(0.5);
        await sleep(380 / sp);
      } else {
        const dur = (80 * dist(from, at) + 140) / sp;
        fx({ type: 'orb', from, to: at, color, dur });
        play(color === 'frost' ? 'iceShot' : 'whoosh');
        await sleep(dur);
      }
    }
    if (g !== gen) return;
    const ev = E.applyAction(state, a);

    if (spell.blink) {
      updateFog();
      if (ev.fizzled) log(`${who}'s Blink fizzles — something is already there`);
      else if (obs.units.some((x) => x.id === u.id)) { fx({ type: 'blink', at, dur: 320 / sp }); log(`${label(u)} blinks away`); }
    } else {
      if (spell.snare) {
        for (const h of [at, ...DIRS.map(([dq, dr]) => ({ q: at.q + dq, r: at.r + dr }))]) if (E.cellAt(state.map, h)) fx({ type: 'flash', at: h, color: '#f4f4ee', dur: 420 / sp });
        play('web');
      } else if (spell.area) { fx({ type: 'explosion', at, dur: 560 / sp }); scorch(at); quake(); play('boom'); }
      else if (spell.cone) burnt.forEach(scorch);
      else { fx({ type: 'flash', at, color: '#c8f2ff', dur: 300 / sp }); play('ice'); }
      if (!spell.cone) fx({ type: 'sparks', at, color: spell.snare ? '#ffffff' : spell.area ? '#ffb347' : '#bfefff', dur: 560 / sp,
        bits: Array.from({ length: spell.area ? 18 : 10 }, () => [Math.random() * 6.283, 0.6 + Math.random() * (spell.area ? 1.7 : 0.9)]) });
      const parts = [], shaken = new Set();
      for (const h of ev.hits) {
        if (!known.has(h.unit.id)) continue;
        view.floats.push({ ...spot(h.unit), text: '-' + h.dmg, t0: now() });
        if (spell.cone) fx({ type: 'flash', at: spot(h.unit), color: '#ffd9a0', dur: 300 / sp });
        if (h.killed) { fx({ type: 'death', unit: h.unit, dur: 520 / sp }); play('death'); } else shaken.add(h.unit.id);
        parts.push(`${label(h.unit)} −${h.dmg}${h.killed ? ' (defeated)' : spell.snare ? (h.unit.team === u.team ? '' : ' (webbed)') : spell.freeze ? ' (frozen)' : ''}`);
      }
      view.shake = { ids: shaken, t0: now(), dur: 340 / sp };
      log(`${who} ${spell.cone ? 'breathes fire' : 'casts ' + spell.name}${parts.length ? ': ' + parts.join(', ') : ' — it hits nothing in sight'}`);
    }
    refresh();
    await sleep((spell.blink ? 320 : 560) / sp);
  } else {
    const ev = E.applyAction(state, a.type === 'endTurn' ? { ...a, step: true } : a);
    if (a.type === 'endTurn' && ev) {                       // hold the points: captures, then scoring
      for (const c of ev.captured) {
        const o = state.objectives[c.i];
        log(`${TEAM[c.team]} takes a control point`);
        view.fx.push({ type: 'flash', at: o, color: c.team ? '#ffb0a6' : '#a9cdff', t0: performance.now(), dur: 500 / speed() });
        play('capture');
      }
      if (ev.scored) {
        state.objectives.forEach((o, i) => {
          if (state.owners[i] === ev.team) view.floats.push({ q: o.q, r: o.r, text: '+1', t0: performance.now() });
        });
        log(state.mode === 'siege' ? `${TEAM[ev.team]} holds the keep: ${state.score[ev.team]} of ${state.target}`
          : `${TEAM[ev.team]} scores ${ev.scored} — Blue ${state.score[0]}, Red ${state.score[1]} (first to ${state.target})`);
      }
      if (ev.captured.length || ev.scored) await sleep(350 / speed());
    }
    if (a.type === 'endTurn' && state.winner === null) {
      play('turn');
      log(state.turn === E.WILD ? '— The neutral monsters stir —' : `— Round ${state.round}, ${TEAM[state.turn]} —`);
      await sleep(200 / speed());
      // The neutral monsters' phase: step through it so every move and blow is shown.
      while (g === gen && state.turn === E.WILD && state.winner === null) { refresh(); await perform(E.wildAction(state)); }
    }
  }
  if (g === gen) {
    refresh();
    if (state.winner !== null && !celebrated) celebrate();
  }
}

// End of game: a jingle, and confetti in the winner's colours.
let celebrated = false;
function celebrate() {
  celebrated = true;
  const w = state.winner, humans = [0, 1].filter((t) => !ais[t]);
  play(w === 'draw' || (humans.length === 1 && humans[0] !== w) ? 'lose' : 'win');
  if (w === 'draw') return;
  const colors = w === 0 ? ['#5b9bf0', '#2f6fd6', '#bcd9ff', '#ffe14a'] : ['#f58a7c', '#d2443a', '#ffd0c8', '#ffe14a'];
  view.fx.push({ type: 'confetti', t0: performance.now(), dur: 4200,
    bits: Array.from({ length: 110 }, () => [Math.random(), 0.5 + Math.random() * 0.9, Math.random() * 6.28, colors[Math.floor(Math.random() * colors.length)], 4 + Math.random() * 5]) });
}

// Let AI controllers play until it's a human's turn or the game ends.
async function pump() {
  if (editing || busy || state.winner !== null || !ais[state.turn]) { refresh(); return; }
  const g = gen;
  busy = true;
  sel = reach = undo = null;
  refresh();
  await sleep(250 / speed());
  while (g === gen && state.winner === null && ais[state.turn]) {
    const known = $('cheat').checked ? state : E.observe(state, state.turn);
    thinking = true; refresh();
    let a = await think(state.turn, known);
    thinking = false;
    if (g !== gen || !a) return;
    if (!E.isLegal(state, a)) {
      log(`${TEAM[state.turn]} AI returned an illegal action; ending its turn`);
      console.warn('illegal action', a);
      a = { type: 'endTurn' };
    }
    await perform(a);
  }
  if (g === gen) { busy = false; refresh(); }
}

async function human(a) {
  const g = gen;
  busy = true;
  await perform(a);
  if (g !== gen) return;
  busy = false;
  if (a.type === 'attack' || a.type === 'cast') { undo = null; sel = null; }
  reach = null;
  const left = state.units.some((u) => u.team === state.turn && !u.acted);
  if (state.winner === null && !left) return endTurn();
  refresh();
}

async function endTurn() {
  if (editing || busy || state.winner !== null || ais[state.turn]) return;
  const g = gen;
  busy = true;
  sel = reach = undo = null;
  await perform({ type: 'endTurn' });
  if (g !== gen) return;
  busy = false;
  pump();
}

function undoMove() {
  if (editing || busy || !undo || ais[state.turn]) return;
  state = undo.state;
  sel = undo.unit;
  reach = E.reachable(state, unit(sel));
  undo = null;
  refresh();
}

// ---- Saved maps ----

async function refreshMapList() {
  let names = [];
  try { names = await (await fetch('api/maps')).json(); } catch { /* server without the maps API */ }
  const s = $('mapSel');
  s.textContent = '';
  s.add(new Option('Random (by seed)', '#random'));
  // Label each saved map with its size, e.g. "greenvale — Vast (839)".
  const sizes = await Promise.all(names.map(async (n) => {
    try { return (await (await fetch('maps/' + encodeURIComponent(n) + '.json')).json()).cells.length; } catch { return 0; }
  }));
  const sizeName = (c) => (c < 200 ? 'Standard' : c < 350 ? 'Large' : c < 600 ? 'Huge' : 'Vast');
  names.forEach((n, i) => s.add(new Option(sizes[i] ? n + ' — ' + sizeName(sizes[i]) + ' (' + sizes[i] + ')' : n, n)));
  if (custom && !names.includes(custom.name)) s.add(new Option('Custom (unsaved)', '#custom'));
  s.value = custom ? (names.includes(custom.name) ? custom.name : '#custom') : '#random';
  return names;
}

async function loadImage(blob) {
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  return img;
}

async function openSavedMap(name) {
  const data = await (await fetch(`maps/${name}.json`)).json();
  let bd = null;
  if (data.backdrop?.image) {
    try {
      const blob = await (await fetch(`maps/${data.backdrop.image}`)).blob();
      bd = { img: await loadImage(blob), blob: null, file: data.backdrop.image,
        hexPx: data.backdrop.hexPx, ox: data.backdrop.ox, oy: data.backdrop.oy };
    } catch { log(`Backdrop image ${data.backdrop.image} is missing`); }
  }
  custom = data;
  R.backdrop = bd;
  // A siege map is played as a siege; leaving one goes back to plain elimination.
  if (data.siege) $('mode').value = 'siege'; else if ($('mode').value === 'siege') $('mode').value = 'eliminate';
  setOverlay(data.backdrop?.overlay ?? 0.4);
  if (bd) setView(true);
  store('map', name);
  const problem = mapProblem(mapFromData(data));
  if (problem) {                                        // unfinished map: open it in the editor instead
    enterEdit();
    $('edMsg').textContent = `Can't play yet: ${problem}.`;
    return;
  }
  setEditing(false);
  newGame();
  refreshMapList();
}

function useRandomMap() {
  custom = null;
  R.backdrop = null;
  setEditing(false);
  store('map', '');
  newGame();
  refreshMapList();
}

$('mapSel').addEventListener('change', (ev) => {
  const v = ev.target.value;
  if (v === '#random') useRandomMap();
  else if (v !== '#custom') openSavedMap(v).catch(() => log(`Could not load map "${v}"`));
});

// ---- Editor ----

const BRUSHES = [
  ['Terrain', [['Grass', 't:grass'], ['Forest', 't:forest'], ['Ruins', 't:ruins'], ['House', 't:house'], ['Road', 't:road'], ['Stalagmites / stones', 't:spikes'], ['Water', 't:water'], ['Lava', 't:lava'], ['Rock', 't:rock']]],
  ['Height', [['0', 'e:0'], ['1', 'e:1'], ['2', 'e:2'], ['3', 'e:3']]],
  ['Markers (click to place or remove)', [['Blue spawn', 'spawn:0'], ['Red spawn', 'spawn:1'], ['Neutral monster', 'spawn:2'], ['Control point', 'objective']]],
  ['Board shape', [['Add hex', 'add'], ['Remove hex', 'remove']]],
];
for (const [title, items] of BRUSHES) {
  const h = Object.assign(document.createElement('h3'), { textContent: title });
  const row = Object.assign(document.createElement('div'), { className: 'brushes' });
  for (const [text, id] of items) {
    const btn = Object.assign(document.createElement('button'), { textContent: text });
    btn.dataset.brush = id;
    btn.addEventListener('click', () => setBrush(id));
    row.appendChild(btn);
  }
  $('brushes').append(h, row);
}
function setBrush(id) {
  brush = id;
  for (const btn of $('brushes').querySelectorAll('button')) btn.classList.toggle('on', btn.dataset.brush === id);
  refresh();
}

function setEditing(on) {
  editing = on;
  $('editor').hidden = !on;
  $('turnBox').hidden = on;
  $('edit').textContent = on ? 'Play this map' : 'Edit map';
  $('edit').classList.toggle('on', on);
  $('edMsg').textContent = '';
  if (!on) $('bgAdjust').checked = false;
  syncBackdropUI();
}

const backdropMeta = () => (R.backdrop
  ? { image: R.backdrop.file, hexPx: R.backdrop.hexPx, ox: R.backdrop.ox, oy: R.backdrop.oy, overlay: R.overlay } : null);

$('edCeiling').addEventListener('change', () => {
  state.map.ceiling = $('edCeiling').checked;
  if (custom) custom.ceiling = state.map.ceiling;
});

function enterEdit() {
  if (!custom) custom = mapToData(state.map);          // start from the generated map
  setView(true);
  setEditing(true);
  $('edName').value = custom.name || '';
  $('edCeiling').checked = !!custom.ceiling;
  newGame();                                            // fresh working copy of the map, no AI running
  setBrush(brush);
  refreshMapList();
}

function exitEdit() {
  const problem = mapProblem(state.map);
  if (problem) { $('edMsg').textContent = `Can't play yet: ${problem}.`; return; }
  custom = mapToData(state.map, custom.name, backdropMeta());
  setEditing(false);
  newGame();
}

$('edit').addEventListener('click', () => (editing ? exitEdit() : enterEdit()));

$('edBlank').addEventListener('click', () => {
  const n = (id) => Math.max(2, Math.min(40, Math.floor(+$(id).value) || 2));
  custom = { ...rectBoard(n('edCols'), n('edRows')), name: custom.name };
  newGame();
  if (R.backdrop) fitBackdrop();
});

$('edSave').addEventListener('click', async () => {
  const name = $('edName').value.trim().toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
  const msg = $('edMsg');
  if (!name) { msg.textContent = 'Give the map a name first.'; return; }
  $('edName').value = name;
  try {
    const put = async (file, body) => {
      const res = await fetch(`api/maps/${file}`, { method: 'PUT', body });
      if (!res.ok) throw new Error(await res.text());
    };
    const bd = R.backdrop;
    if (bd && bd.blob) {                                // new image: store it next to the map
      const ext = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[bd.blob.type] || 'png';
      await put(`${name}.${ext}`, bd.blob);
      bd.file = `${name}.${ext}`;
      bd.blob = null;
    }
    custom = mapToData(state.map, name, backdropMeta());
    await put(`${name}.json`, JSON.stringify(custom));
    store('map', name);
    await refreshMapList();
    const problem = mapProblem(state.map);
    msg.textContent = `Saved to maps/${name}.json` + (problem ? ` — not playable yet: ${problem}.` : '');
  } catch (e) {
    msg.textContent = `Save failed: ${e.message}`;
  }
});

let painting = false, shapeChanged = false;

function paint(h, first) {
  const map = state.map, k = key(h.q, h.r), c = map.cells[k];
  const [kind, val] = brush.split(':');
  const dropSpawn = () => {
    let hit = false;
    for (const t of [0, 1]) {
      const n = map.spawns[t].length;
      map.spawns[t] = map.spawns[t].filter((s) => s.q !== h.q || s.r !== h.r);
      hit = hit || n !== map.spawns[t].length;
    }
    const wild = (map.wild || []).length;
    map.wild = (map.wild || []).filter((s) => s.q !== h.q || s.r !== h.r);
    hit = hit || wild !== map.wild.length;
    return hit;
  };
  let units = false;
  if (kind === 'add') {
    if (c) return;
    map.cells[k] = { q: h.q, r: h.r, t: 'grass', e: 0 };
    shapeChanged = true;
  } else if (!c) {
    return;
  } else if (kind === 'remove') {
    if (Object.keys(map.cells).length <= 1) return;
    delete map.cells[k];
    units = dropSpawn();
    shapeChanged = true;
  } else if (kind === 't') {
    if (c.t === val) return;
    c.t = val;
    if (val === 'rock' || val === 'lava') units = dropSpawn();
  } else if (kind === 'e') {
    if (c.e === +val) return;
    c.e = +val;
  } else if (kind === 'spawn') {
    if (!first || c.t === 'rock' || c.t === 'lava') return;
    const team = +val, cls = team === 2 && $('edCls').value === 'auto' ? 'spider' : $('edCls').value;
    const list = team === 2 ? map.wild || [] : map.spawns[team];
    const same = list.some((s) => s.q === h.q && s.r === h.r && (s.cls || 'auto') === cls);
    dropSpawn();
    if (!same && team === 2) map.wild.push({ q: h.q, r: h.r, cls });
    else if (!same) map.spawns[team].push(cls === 'auto' ? { q: h.q, r: h.r } : { q: h.q, r: h.r, cls });
    units = true;
  } else if (kind === 'objective') {
    if (!first || c.t === 'rock') return;
    const list = map.objectives || (map.objectives = []);
    const i = list.findIndex((o) => o.q === h.q && o.r === h.r);
    if (i >= 0) list.splice(i, 1); else list.push({ q: h.q, r: h.r });
  }
  $('edMsg').textContent = '';
  if (units) state = E.createGame(map, { monsters: [] });                 // spawn markers are just a fresh game's units
  R.rebuild();
  refresh();
}

// ---- Backdrop image ----

const adjusting = () => editing && !!R.backdrop && $('bgAdjust').checked;
let drag = null;

function syncBackdropUI() {
  const b = R.backdrop;
  $('bgTools').hidden = !b;
  $('bgClear').disabled = !b;
  if (b) $('bgHex').value = Math.round(b.hexPx * 10) / 10;
  else $('bgAdjust').checked = false;
  canvas.style.cursor = adjusting() ? 'move' : editing ? 'crosshair' : 'pointer';
}

// Scale and centre the image so it spans the board's width.
function fitBackdrop() {
  const b = R.backdrop;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const c of Object.values(state.map.cells)) {
    x0 = Math.min(x0, c.q + c.r / 2); x1 = Math.max(x1, c.q + c.r / 2);
    y0 = Math.min(y0, c.r); y1 = Math.max(y1, c.r);
  }
  b.hexPx = b.img.width / (x1 - x0 + 1);
  b.ox = b.img.width / 2 - ((x0 + x1) / 2) * b.hexPx;
  b.oy = b.img.height / 2 - ((y0 + y1) / 2) * 1.5 * b.hexPx / R3;
  syncBackdropUI();
}

async function setBackdrop(blob) {
  if (!editing) enterEdit();
  R.backdrop = blob ? { img: await loadImage(blob), blob, file: null, hexPx: 1, ox: 0, oy: 0 } : null;
  if (blob) fitBackdrop();
  syncBackdropUI();
}

function setOverlay(v) {
  R.overlay = v;
  $('bgOverlay').value = v;
}

// Generate artwork from the terrain being edited. The art already shows the terrain, so the
// rules overlay is switched off (the slider brings it back).
async function paintFromTerrain() {
  if (!editing) enterEdit();
  const msg = $('edMsg');
  msg.textContent = 'Painting…';
  await sleep(30);                                      // let the message show before the heavy work
  // Big boards are painted a little coarser so the image stays a reasonable size (about 4500 px wide at most).
  const xs = Object.values(state.map.cells).map((c) => c.q + c.r / 2);
  const hexPx = Math.max(90, Math.min(140, Math.round(4500 / (Math.max(...xs) - Math.min(...xs) + 2))));
  state.map.biome = $('bgBiome').value;                  // remembered with the map: it picks the weather
  if (custom) custom.biome = state.map.biome;
  const art = paintBackdrop(state.map, { hexPx, seed: 7 + Object.keys(state.map.cells).length, biome: $('bgBiome').value });
  const blob = await new Promise((res) => art.canvas.toBlob(res, 'image/jpeg', 0.92));
  R.backdrop = { img: art.canvas, blob, file: null, hexPx: art.hexPx, ox: art.ox, oy: art.oy };
  setOverlay(0);
  syncBackdropUI();
  msg.textContent = 'Painted. Save the map to keep the image.';
}
$('bgPaint').addEventListener('click', () => paintFromTerrain().catch((e) => { $('edMsg').textContent = `Painting failed: ${e.message}`; }));

$('bgLoad').addEventListener('click', () => $('bgFile').click());
$('bgFile').addEventListener('change', (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (f) setBackdrop(f).catch(() => { $('edMsg').textContent = 'Could not read that image.'; });
});
$('bgClear').addEventListener('click', () => setBackdrop(null));
$('bgAdjust').addEventListener('change', syncBackdropUI);
$('bgOverlay').addEventListener('input', (ev) => setOverlay(+ev.target.value));
$('bgHex').addEventListener('change', (ev) => {
  const v = +ev.target.value;
  if (R.backdrop && v >= 4) R.backdrop.hexPx = v;
});

// ---- Mouse and keyboard ----

function mouseCell(ev) {
  const r = canvas.getBoundingClientRect();
  const x = ev.clientX - r.left, y = ev.clientY - r.top;
  return editing ? R.hexAt(x, y) : R.pick(x, y, obs);
}

// Camera: wheel zooms on the cursor; drag with the right or middle button (or hold Space and drag) pans.
let panning = null, spaceDown = false;
canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
window.addEventListener('keyup', (ev) => { if (ev.key === ' ') spaceDown = false; });
canvas.addEventListener('mousedown', (ev) => {
  if (ev.button === 1 || ev.button === 2 || (ev.button === 0 && spaceDown)) {
    ev.preventDefault();
    panning = { x: ev.clientX, y: ev.clientY, moved: false };
    canvas.style.cursor = 'grabbing';
    return;
  }
  if (ev.button !== 0 || !editing) return;
  if (adjusting()) { drag = { x: ev.clientX, y: ev.clientY }; return; }
  painting = true;
  hover = mouseCell(ev);
  paint(hover, true);
});
window.addEventListener('mouseup', () => {
  if (panning) { const p = panning; panning = null; canvas.style.cursor = ''; if (p.moved) skipClick = performance.now(); return; }
  drag = null;
  painting = false;
  if (shapeChanged) { shapeChanged = false; R.layout(state.map); }
});
let skipClick = 0;
window.addEventListener('mousemove', (ev) => {
  if (panning) {
    const dx = ev.clientX - panning.x, dy = ev.clientY - panning.y;
    if (dx || dy) { panning.moved = true; R.panBy(dx, dy); panning.x = ev.clientX; panning.y = ev.clientY; }
    return;
  }
  if (!drag || !adjusting()) return;
  const b = R.backdrop, k = (R3 * R.S) / b.hexPx;
  b.ox -= (ev.clientX - drag.x) / k;
  b.oy -= (ev.clientY - drag.y) / k;
  drag = { x: ev.clientX, y: ev.clientY };
});
canvas.addEventListener('wheel', (ev) => {
  if (!adjusting()) {                                    // zoom the view on the cursor
    ev.preventDefault();
    const box = canvas.getBoundingClientRect();
    R.zoomBy(Math.exp(-ev.deltaY * 0.0015), ev.clientX - box.left, ev.clientY - box.top);
    return;
  }
  ev.preventDefault();
  const b = R.backdrop, rect = canvas.getBoundingClientRect();
  const mx = ev.clientX - rect.left - R.ox, my = ev.clientY - rect.top - R.oy;
  const k0 = (R3 * R.S) / b.hexPx;
  const px = b.ox + mx / k0, py = b.oy + my / k0;           // image point under the cursor stays put
  b.hexPx = Math.max(4, b.hexPx * (ev.deltaY > 0 ? 1.02 : 1 / 1.02));
  const k1 = (R3 * R.S) / b.hexPx;
  b.ox = px - mx / k1; b.oy = py - my / k1;
  $('bgHex').value = Math.round(b.hexPx * 10) / 10;
}, { passive: false });

canvas.addEventListener('mousemove', (ev) => {
  if (adjusting() || panning) return;
  const c = mouseCell(ev);
  if (editing && painting && hover) {                   // fill in hexes a fast drag skipped over
    const n = dist(hover, c);
    for (let i = 1; i <= n; i++) {
      paint(hexRound(hover.q + (c.q - hover.q) * (i / n) + 1e-6, hover.r + (c.r - hover.r) * (i / n) + 1e-6), false);
    }
  }
  const box = canvas.getBoundingClientRect();
  mousePx = { x: ev.clientX - box.left, y: ev.clientY - box.top };
  const me = !editing && sel !== null ? unit(sel) : null;
  // A big creature's destination depends on where in the hex the cursor is, so keep refreshing.
  if (!(me && E.isBig(me)) && c?.q === hover?.q && c?.r === hover?.r) return;
  hover = c;
  refresh();
});
canvas.addEventListener('mouseleave', () => { hover = null; refresh(); });

canvas.addEventListener('click', (ev) => {
  if (performance.now() - skipClick < 250) return;      // the end of a Space-drag, not a click
  if (editing || busy || state.winner !== null || ais[state.turn]) return;
  const c = mouseCell(ev);
  const u = c && E.unitAt(obs, c);
  const me = sel !== null ? unit(sel) : null;
  if (casting && me) {                                    // a click while aiming casts, or cancels
    const ok = c && (view.castCells ? view.castCells.has(key(c.q, c.r)) : u && view.targets.has(u.id));
    const spell = casting;
    casting = null;
    if (ok) return human({ type: 'cast', unit: me.id, spell, q: c.q, r: c.r });
    return refresh();
  }
  if (me && u && u.team !== state.turn) {
    if (view.targets.has(u.id)) human({ type: 'attack', unit: me.id, target: u.id });
    return;
  }
  if (u && u.team === state.turn) {
    if (u.acted || u.id === sel) { sel = reach = null; } else { sel = u.id; reach = E.reachable(obs, u); }
    return refresh();
  }
  if (me && c && view.reach) {
    const box = canvas.getBoundingClientRect();
    mousePx = { x: ev.clientX - box.left, y: ev.clientY - box.top };
    hover = c;
    const n = destAt(me);
    if (n && n.stop && n.cost > 0) {
      undo = state.fog ? null : { state: E.clone(state), unit: me.id };
      return human(n.o === undefined ? { type: 'move', unit: me.id, q: n.q, r: n.r } : { type: 'move', unit: me.id, q: n.q, r: n.r, o: n.o });
    }
  }
  sel = reach = null;
  refresh();
});

window.addEventListener('keydown', (ev) => {
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
  if (ev.key === ' ') { spaceDown = true; ev.preventDefault(); return; }
  const step = 80;
  if (ev.key === '+' || ev.key === '=') return R.zoomBy(1.25);
  if (ev.key === '-' || ev.key === '_') return R.zoomBy(0.8);
  if (ev.key === '0') return R.fit();
  if (ev.key === 'ArrowLeft') return R.panBy(step, 0);
  if (ev.key === 'ArrowRight') return R.panBy(-step, 0);
  if (ev.key === 'ArrowUp') return R.panBy(0, step);
  if (ev.key === 'ArrowDown') return R.panBy(0, -step);
  if (ev.key === 'e' || ev.key === 'E') endTurn();
  else if (ev.key === 'u' || ev.key === 'U') undoMove();
  else if (ev.key === 'v' || ev.key === 'V') setView(!R.flat);
  else if (ev.key === 'Escape') { if (casting) casting = null; else sel = reach = null; refresh(); }
  else if (ev.key >= '1' && ev.key <= '9') {
    const me = sel !== null ? unit(sel) : null, sp = me && (E.CLASSES[me.cls].spells || [])[+ev.key - 1];
    if (sp) toggleCast(sp);
  }
});

// ---- Setup ----

for (const t of [0, 1]) {
  const s = $('ctl' + t);
  s.add(new Option('Human', 'human'));
  for (const [id, ai] of Object.entries(AIS)) s.add(new Option('AI: ' + ai.label, id));
  s.value = t === 0 ? 'human' : 'greedy';
  s.addEventListener('change', () => { gen++; busy = false; view.anim = null; makeAIs(); sel = reach = undo = null; pump(); });
}

function setView(flat) {
  if (editing) flat = true;                             // the editor only works top-down
  R.flat = flat;
  $('view').textContent = flat ? 'Switch to 2.5D' : 'Switch to top-down';
  store('view', flat ? 'flat' : 'iso');
  if (state) R.layout(state.map);
}
setView(store('view') !== 'iso');
$('view').addEventListener('click', () => setView(!R.flat));
$('zoomIn').addEventListener('click', () => R.zoomBy(1.25));
$('zoomOut').addEventListener('click', () => R.zoomBy(0.8));
$('zoomFit').addEventListener('click', () => R.fit());
$('new').addEventListener('click', () => { if (editing) setEditing(false); newGame(); });
$('rand').addEventListener('click', () => {
  $('seed').value = 1 + Math.floor(Math.random() * 99999);
  useRandomMap();
});
$('seed').addEventListener('change', () => { if (!custom) newGame(); });
$('fogView').addEventListener('change', () => { sel = reach = null; refresh(); });
$('size').addEventListener('change', () => { if (!custom) newGame(); });
for (const id of ['fog', 'counters', 'zoc', 'mode', 'dragons', 'monsters', 'wild']) $(id).addEventListener('change', () => { if (!editing) newGame(); });
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);
$('sound').checked = store('sound') !== 'off';
$('grid').value = store('grid') ?? 1;
R.grid = +$('grid').value;
$('weather').checked = store('weather') !== 'off';
R.weather = $('weather').checked;
$('weather').addEventListener('change', (ev) => { R.weather = ev.target.checked; store('weather', R.weather ? 'on' : 'off'); });
$('edges').checked = store('edges') !== 'off';
R.edges = $('edges').checked;
$('edges').addEventListener('change', (ev) => { R.edges = ev.target.checked; store('edges', R.edges ? 'on' : 'off'); });
$('grid').addEventListener('input', (ev) => { R.grid = +ev.target.value; store('grid', ev.target.value); });
setEnabled($('sound').checked);
$('sound').addEventListener('change', (ev) => { setEnabled(ev.target.checked); store('sound', ev.target.checked ? 'on' : 'off'); });
$('end').addEventListener('click', endTurn);
$('undo').addEventListener('click', undoMove);
window.addEventListener('resize', () => R.layout(state.map));

setEditing(false);
newGame();
R.loadTokens().catch((e) => console.warn('token art not loaded', e));
(function frame() {
  R.draw(obs || state, view);
  requestAnimationFrame(frame);
})();
refreshMapList().then((names) => {
  const last = store('map');
  if (last && names.includes(last)) return openSavedMap(last);
}).catch((e) => console.warn('could not restore last map', e));

window.game = { get state() { return state; }, view, E, AIS, setBackdrop };   // handy for poking around in the console
