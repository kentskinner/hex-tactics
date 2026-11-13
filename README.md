# Hex Tactics

A small turn-based tactics game on a 2.5D hex grid, built as a sandbox for trying out AI techniques.
No dependencies beyond Node.

    node server.js                              # play at http://localhost:5173
    node arena.js sampler greedy --games 20     # headless AI-vs-AI

Press `V` to switch between the top-down view (default; height shown as a number, shading and
contour/cliff edges) and the 2.5D view. Hover an enemy to see where it can strike next turn; with an
archer selected, hovering an enemy draws the sight line and marks what blocks it.

**Zoom and pan** — mouse wheel zooms on the cursor; drag with the right or middle button (or hold Space and
drag) to pan; arrow keys pan, `+` / `-` zoom, `0` or the Fit button shows the whole map again.

**Map size** — "Size" in the sidebar sets how big random maps are, from Standard (127 hexes) to Vast (817);
in the arena, `--size <radius>` (6 is standard). The round limit grows with the distance between the armies
(30 on standard maps). For your own large maps, the editor's blank board goes up to 40 × 40.

## Map editor

"Edit map" opens the editor on the current map (a generated one becomes an editable copy).

- **Brushes** — click or drag to paint terrain or height; click to place or remove spawn points
  (optionally with a fixed class); "Add hex" / "Remove hex" change the board's shape.
- **Blank board** — start from an empty rectangle of the given size.
- **Backdrop image** — put a battlemap picture under the grid. Tick "Align" to drag the image and
  zoom it with the mouse wheel until its features sit in the hexes, or type the hex width in image
  pixels. "Terrain overlay" sets how strongly the painted rules show over the art.
- **Paint from terrain** — generates a painted top-down battlemap from the map's terrain and
  heights (`src/paint.js`), so the art always matches the rules. Repaint after changing terrain.
  The dropdown beside it picks the style: Meadow, Snow, Desert or Cave. "Cave ceiling" marks the map as underground: flyers can no longer cross rock.
- **Save** — writes `maps/<name>.json` (and the image beside it) through the local server. Saved maps
  appear in the Map dropdown and work in the arena: `node arena.js sampler greedy --map <name>`.

A fifth, `greenvale`, is a vast one (839 hexes, meadow): a river valley with a ruined town at the centre, a broken
bridge north and south, wooded hills, two rings of standing stones each guarded by a neutral troll, and armies of ten.

`deepreach` is a vast cave (839 hexes, ceiling): an army hall at each end with a three-wide gallery into a great
cavern, where a ring lake surrounds an island of old stonework; a fungus grotto and a troll den on each side, joined
by one-hex tunnels; and a long tunnel along the north and south walls. Five control points, armies of ten plus the
cave monsters, and neutral trolls and spiders.

`sandsea` is a vast desert (839 hexes): open dunes broken by cliff-sided mesas (the larger ones climbed by ramps, the
small buttes only by flyers and spiders), a caravanserai between two pools at the centre, a well on each army's side,
an obelisk ring north and south, and two neutral sand worms. Five control points, armies of ten.

Four ready-made maps are included: `stonebridge` (meadow, a river with a ruined causeway),
`frostmere` (snow, a frozen lake around an island fort) and `sunspire` (desert, a cliff-sided temple
mesa climbed only by ramps on its north and south, with an oasis well toward each army) and `gloomhollow` (a cave: army chambers, a wide hall into a
central cavern, and two one-hex tunnels with junction rooms; has a ceiling). Unit tokens for the top-down view are the SVGs in
`assets/tokens/`, one per class, drawn in Blue's colours and recoloured for Red by the game.

The map file format is documented at the top of the "Map files" section in `src/mapgen.js`.

## Rules

- Each turn, every unit may move once and then attack (or wait). Eliminate the other team; round 30 is a draw.
- **Terrain** — forest: move cost 2, cover 1 · ruins: cover 2 · stalagmites (painted as standing stones above ground): move cost 2, cover 1, and only one-hex creatures fit among them (big ones can't stand there; flyers and burrowers may pass) · water: move cost 2, occupant takes +1 and deals -1 · stalactites: open ground for walkers, but flyers can't pass or land · rock: impassable, blocks sight.
- **Height** (0–3) — climbing costs +1 move, a 2-level step is a cliff. Attacks get +1 damage per level above the target (-1 per level below, max 2). Archers get +1 range from high ground. Hills block line of sight.
- **Objective** — *Eliminate* (default), or *Hold the points*: the map has control points (ringed, with a
  pennant). At the end of each team's turn, a point with a unit standing on it goes to that unit's team and
  stays theirs until an enemy stands on it; the team whose turn is ending then scores 1 per point it owns.
  First to 2 per point wins (6 with three points), as does wiping the enemy out; at the round limit the
  higher score wins. Maps can place their own points (editor: Markers → Control point); otherwise three are
  placed along the line where the armies meet. Arena: `--hold`.
- **Damage** is deterministic: `atk + height - cover`, minimum 1. No hit rolls.
- **Counter-attacks** — a unit that survives an attack hits back with its own attack if the attacker is
  within its range and sight (so melee answers melee, archers answer shots from 2+ hexes, and an archer
  stabbed from an adjacent hex can't reply). Spells are never countered.
- **Zones of control** — soldiers and scouts control the hexes next to them (within one level of height).
  An enemy that steps into one must stop there; a unit that starts its move in one may leave freely.
  Reachable hexes that would end the move this way are edged in red.
- Both can be switched off in the sidebar, or with `--no-counters` / `--no-zoc` in the arena.
- **Units** — Soldier (14 hp, 5 atk, move 3), Archer (9 hp, 4 atk, move 3, range 2–4), Scout (10 hp, 4 atk, move 5),
  Wizard (8 hp, 4 atk, move 3, range 1–3, lightning ignores cover), Ogre (24 hp, 6 atk, move 3, three hexes).
  Each side fields one of each.
- **Big creatures** — a class's `size` gives it a footprint of several hexes: `large` is three mutually
  adjacent hexes (the Ogre and the Rock worm), `huge` is a hex and its six neighbours (the Dragon).
  A big creature needs every hex of its footprint to be free, passable ground with no cliff under it, so
  it can't use one-hex gaps. Like one-hex units it may pass through friends, but not stop on them. It is attacked, seen, stopped and scored through
  any of its hexes; it gets cover only if all of them have it, defends on its lowest hex and attacks from
  its highest. An area spell hits it once. A large creature moves by pivoting — two hexes stay, the third
  swings over — at half a step each, so two pivots shift it one hex.
- **Dragon** (40 hp, bite 6, move 4, seven hexes) — optional: "Dragons" in the sidebar gives one to each
  side, or to one side only, placed behind its line (arena: `--dragons`; `createGame(map, { dragons })`;
  the editor can also place one as a spawn). It **flies**: every hex costs 1 whatever is below, it passes
  over rocks, cliffs, units and zones of control, and it may land anywhere its seven hexes are free of
  rock and units, even across a ledge. *Fire breath* (range 2–4, recharge 2) is aimed at any hex and
  burns everything in a 60° cone toward it for 5 — friend or foe — except what is sheltered behind rock
  or higher ground. `coneCells(map, 'breath', from, at)` gives the hexes; `evaluate` counts a dragon as
  three units.
- **Monsters** — extra creatures both sides get. A map can list its own (`"monsters": [...]` in the map
  file; `gloomhollow` has all three), and "Monsters" in the sidebar can add the cave pack to any map or
  switch them off (arena: `--monsters` / `--no-monsters`; `createGame(map, { monsters: [...] })`). They
  start as close to the middle of their army as there is room. The editor can also place them as spawns.
  - *Giant spider* (12 hp, 4 atk, move 4) — climbs: height and cliffs cost nothing. *Web* (range 2–3,
    recharge 3) covers a hex and its neighbours: 1 damage, and enemies in it can't move on their next turn.
  - *Bat swarm* (7 hp, 3 atk, move 6) — flies like the dragon, in one hex: over units, water and zones
    of control, but not through cave rock.
  - *Rock worm* (20 hp, 6 atk, move 3, three hexes) — burrows: passes under anything, rock included
    (ceiling or not), and comes up wherever its three hexes fit.
- **Neutral monsters** — a third side (team 2, green tokens) that belongs to neither player. Each one
  guards the ground within 4 hexes of where it starts: it goes for any unit of either army that comes
  that close, strikes at anything next to it, and walks home when left alone. They move by themselves
  after Red's turn, never cast spells, and don't need to be killed to win. A neutral standing on a
  control point makes it nobody's. A map lists them as `"wild": [{q, r, cls}]` (editor: Markers →
  Neutral monster, using the spawn class); `gloomhollow` has a *Cave troll* (22 hp, 6 atk, move 3,
  regenerates 2 hp a turn) on the dais and a spider in each junction room. "Neutrals" in the sidebar can
  add a troll and two spiders to a map without its own, or switch them off (arena: `--wild` /
  `--no-wild`; `createGame(map, { wild })`).
  For AIs: `applyAction` plays the neutral phase by itself after the second player's `endTurn`, so
  simulations run straight through it; `wildAction(state)` is the (deterministic) rule they follow.
  `evaluate` counts a neutral as a quarter of an enemy.

- **Wizard spells** — cast instead of attacking, aimed at a hex, then recharging for a few of the
  wizard's turns. They ignore cover and height. Select the wizard and use the buttons or keys 1–3.
  - *Fireball* (range 2–4, recharge 3): 4 damage on the target hex and 2 on every adjacent hex, friend or foe.
  - *Frost bolt* (range 1–4, recharge 2): 2 damage to one enemy, which cannot move on its next turn.
  - *Blink* (range 1–4, recharge 3): teleport to any free hex, across water, cliffs and walls.

All numbers live at the top of `src/engine.js`. For AIs, a big creature's position is its anchor hex plus
an orientation `o`, which move actions and `unitOptions` entries carry; `footprint(unit, at)`, `unitDist`
and `fits` do the geometry. AIs see casts as `{type:'cast', unit, spell, q, r}`;
`unitOptions` includes Fireball and Frost bolt, and `legalActions` also lists Blink. Greedy and the
sampler use the two damage spells but never Blink.

Attacks and spells are animated and have synthesised sound (`src/sound.js`, "Sound" in the sidebar).

### Fog of war (optional)

Tick "Fog of war" in the sidebar, or pass `--fog` to the arena.

- A team sees every hex within a unit's sight range (Soldier 4, Archer 5, Scout 7; +1 looking down
  from higher ground) that the unit has a clear sight line to. Vision is shared across the team.
- Units standing in forest stay hidden, and can't be targeted, until an enemy is adjacent.
- A move that runs into a hidden enemy stops short of it (an ambush). Undo is disabled.
- The screen shows the human player's view, with faded "?" tokens where enemies were last seen.
  With two AIs playing, you see everything.

For AIs: under fog, `chooseAction` receives `observe(state, team)` — the state with unseen enemies
removed, plus `unseen` (how many are hidden) and `vis` (the set of visible hex keys). Nothing is
remembered for you between calls; `fogGoals` in `src/ai/greedy.js` shows one way to keep a
last-seen memory. "AIs see through fog" hands AIs the full state instead, for comparison.

## Writing an AI

Add a file in `src/ai/` and register it in `src/ai/index.js`:

```js
import { legalActions, unitOptions, clone, applyAction, evaluate } from '../engine.js';

export default {
  label: 'My AI',
  create() {                       // called once per game; keep per-game memory in the closure
    return {
      chooseAction(state) {        // called repeatedly on your turn until you return endTurn
        return { type: 'endTurn' };
      },
    };
  },
};
```

It then shows up in the in-game player dropdowns and in `arena.js`.

Useful engine pieces: `legalActions(state)`, `unitOptions(state, unit)` (every destination + target combo),
`clone` / `applyAction` for simulating ahead, `evaluate(state, team)`, `distanceField`, `damage`, `canAttack`, `los`.
`src/ai/greedy.js` (heuristic, no lookahead) and `src/ai/sampler.js` (Monte-Carlo over whole turns) are worked examples.

In the browser the AIs run in a background worker (`src/ai/worker.js`), so the page stays responsive and the banner
shows "thinking…" while one plans. Nothing changes for an AI: it is still created once per game and asked for one
action at a time.

## Layout

- `src/engine.js` — rules and state; no DOM, no randomness
- `src/mapgen.js` — seeded, symmetric map generator
- `src/ai/` — AIs
- `src/render.js`, `src/main.js` — canvas renderer and browser UI
- `arena.js` — tournament runner
