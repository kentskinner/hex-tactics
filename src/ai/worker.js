// Runs the AIs off the page's main thread, so the board keeps animating while one thinks.
// The page sends:
//   { type: 'init', map, ais: [id|null, id|null] }   new game or new controllers: fresh AI instances
//   { type: 'choose', id, team, state }              state without its map; answered with { id, action, thought }
//                                                    (thought: what the AI says it was thinking, if it can)
import { AIS } from './index.js';

let map = null;
const ais = [null, null];

onmessage = (ev) => {
  const m = ev.data;
  if (m.type === 'init') {
    map = { ...m.map, losCache: new Map() };
    for (const t of [0, 1]) ais[t] = m.ais[t] ? AIS[m.ais[t]].create() : null;
  } else if (m.type === 'choose') {
    try {
      const action = ais[m.team].chooseAction({ ...m.state, map });
      postMessage({ id: m.id, action, thought: ais[m.team].explain?.() || null });
    } catch (err) {
      postMessage({ id: m.id, error: String(err && err.stack || err) });
    }
  }
};
