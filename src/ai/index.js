// AI registry. To add an AI: create a module exporting
//   { label, create(options) -> { chooseAction(state) -> action } }
// and list it here. chooseAction is called repeatedly during the AI's turn (state.turn is the
// AI's team) until it returns {type:'endTurn'}. It receives a private copy of the state.
import random from './random.js';
import greedy from './greedy.js';
import sampler from './sampler.js';

export const AIS = { random, greedy, sampler };
