// Baseline: uniformly random legal actions (with endTurn only when nothing else is left).
import { legalActions } from '../engine.js';

export default {
  label: 'Random',
  create() {
    return {
      chooseAction(state) {
        const acts = legalActions(state).filter((a) => a.type !== 'endTurn' && a.type !== 'wait');
        return acts.length && Math.random() < 0.9
          ? acts[Math.floor(Math.random() * acts.length)]
          : { type: 'endTurn' };
      },
    };
  },
};
