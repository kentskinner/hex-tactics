// Headless AI-vs-AI tournament.
//   node arena.js <aiA> <aiB> [--games 20] [--seed 1] [--map name-or-path] [--fog] [--no-counters] [--no-zoc] [--hold] [--dragons] [--monsters | --no-monsters] [--wild | --no-wild] [--size 6]
// Each map is played twice with sides swapped, so first-move and terrain advantage cancel out.
// --map uses a saved map (maps/<name>.json) for every game instead of generated ones.
// --fog plays with fog of war: each AI is only shown what its own team can see.
// --no-counters and --no-zoc switch off counter-attacks and zones of control.
// --hold plays the hold-the-points objective instead of elimination.
// --dragons gives each side a Dragon as well.
// --monsters gives each side the cave monsters (spider, bats, worm) on any map; --no-monsters removes
// them from a map that has its own. Default: whatever the map says.
// --wild adds neutral monsters (a troll and two spiders) to maps without their own; --no-wild removes them.
import { readFileSync } from 'node:fs';
import { generateMap, mapFromData, mapProblem } from './src/mapgen.js';
import { createGame, clone, isLegal, applyAction, observe, PACKS } from './src/engine.js';
import { AIS } from './src/ai/index.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? +args[i + 1] : def; };
const SWITCHES = ['--fog', '--no-counters', '--no-zoc', '--hold', '--dragons', '--monsters', '--no-monsters', '--wild', '--no-wild'];  // flags that take no value
const fog = args.includes('--fog');
const rules = { fog, counters: !args.includes('--no-counters'), zoc: !args.includes('--no-zoc'),
  mode: args.includes('--hold') ? 'hold' : 'eliminate', dragons: args.includes('--dragons') ? 'both' : 'none',
  monsters: args.includes('--no-monsters') ? [] : args.includes('--monsters') ? PACKS.cave : undefined,
  wild: args.includes('--no-wild') ? [] : args.includes('--wild') ? 'auto' : undefined };
const [nameA, nameB] = args.filter((a, i) => !a.startsWith('--') && !((args[i - 1] || '').startsWith('--') && !SWITCHES.includes(args[i - 1])));
if (!AIS[nameA] || !AIS[nameB]) {
  console.log(`usage: node arena.js <aiA> <aiB> [--games N] [--seed S]\nAIs: ${Object.keys(AIS).join(', ')}`);
  process.exit(1);
}
const games = opt('games', 20), seed0 = opt('seed', 1), size = opt('size', 6);   // size: radius of generated maps
const mapArg = args.indexOf('--map') >= 0 ? args[args.indexOf('--map') + 1] : null;
let mapData = null;
if (mapArg) {
  mapData = JSON.parse(readFileSync(mapArg.endsWith('.json') ? mapArg : `maps/${mapArg}.json`, 'utf8'));
  const problem = mapProblem(mapFromData(mapData));
  if (problem) { console.log(`Map can't be played: ${problem}`); process.exit(1); }
}

export function playGame(map, makers, game = 0) {
  const state = createGame(map, rules);
  // A different seed each game, so AIs that use randomness don't replay one game on a fixed map.
  const ais = makers.map((m, i) => m.create({ seed: 1000 + game * 2 + i }));
  const ms = [0, 0];
  while (state.winner === null) {
    const t = state.turn, t0 = performance.now();
    let a = ais[t].chooseAction(clone(observe(state, t)));
    ms[t] += performance.now() - t0;
    if (!isLegal(state, a)) { console.warn(`illegal action from team ${t}:`, a); a = { type: 'endTurn' }; }
    applyAction(state, a);
  }
  return { winner: state.winner, rounds: state.round, ms };
}

const score = { [nameA]: 0, [nameB]: 0, draw: 0 };
const time = [0, 0];
let rounds = 0;
for (let g = 0; g < games; g++) {
  const swap = g % 2 === 1;
  const names = swap ? [nameB, nameA] : [nameA, nameB];
  const map = mapData ? mapFromData(mapData) : generateMap(seed0 + (g >> 1), size);
  const res = playGame(map, names.map((n) => AIS[n]), g);
  score[res.winner === 'draw' ? 'draw' : names[res.winner]]++;
  rounds += res.rounds;
  time[0] += res.ms[swap ? 1 : 0];
  time[1] += res.ms[swap ? 0 : 1];
}
console.log(`${games} games${fog ? ' with fog of war' : ''}, avg ${(rounds / games).toFixed(1)} rounds`);
console.log(`  ${nameA}: ${score[nameA]} wins  (${(time[0] / games).toFixed(0)} ms thinking/game)`);
if (nameA !== nameB) console.log(`  ${nameB}: ${score[nameB]} wins  (${(time[1] / games).toFixed(0)} ms thinking/game)`);
console.log(`  draws: ${score.draw}`);
