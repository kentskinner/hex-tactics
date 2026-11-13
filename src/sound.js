// Sound effects, synthesised with Web Audio — no audio files.
// Browsers only allow sound after a click or key press, so unlock() must be called from one;
// until then play() is silent.

let ac = null, master = null, enabled = true;

export function unlock() {
  if (!ac) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    ac = new Ctx();
    master = ac.createGain();
    master.gain.value = 0.28;
    master.connect(ac.destination);
  }
  if (ac.state === 'suspended') ac.resume();
}

export function setEnabled(on) { enabled = on; }

// A pitched tone sliding from f0 to f1.
function tone({ type = 'sine', f0, f1 = f0, dur, vol = 0.4, delay = 0, attack = 0.006 }) {
  const t = ac.currentTime + delay, osc = ac.createOscillator(), g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t); osc.stop(t + dur + 0.02);
}

// Filtered noise, with the filter sweeping from f0 to f1.
let noiseBuf = null;
function noise({ dur, vol = 0.4, f0, f1 = f0, q = 1, type = 'bandpass', delay = 0, attack = 0.004 }) {
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ac.currentTime + delay, src = ac.createBufferSource(), flt = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = noiseBuf; src.loop = true;
  flt.type = type; flt.Q.value = q;
  flt.frequency.setValueAtTime(f0, t);
  flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt).connect(g).connect(master);
  src.start(t, Math.random()); src.stop(t + dur + 0.02);
}

const SFX = {
  step() { noise({ dur: 0.05, vol: 0.12, f0: 900, f1: 400, q: 0.8 }); },
  arrow() {                                           // bowstring, then the arrow's hiss
    tone({ type: 'triangle', f0: 620, f1: 240, dur: 0.09, vol: 0.3 });
    noise({ dur: 0.22, vol: 0.2, f0: 4200, f1: 1400, q: 2, delay: 0.02 });
  },
  slash() { noise({ dur: 0.16, vol: 0.35, f0: 5200, f1: 900, q: 1.4 }); },
  hit() {
    tone({ f0: 170, f1: 55, dur: 0.16, vol: 0.55 });
    noise({ dur: 0.09, vol: 0.3, f0: 1800, f1: 500, q: 0.7 });
  },
  charge() { tone({ type: 'sine', f0: 220, f1: 880, dur: 0.24, vol: 0.2, attack: 0.12 }); },
  zap() {                                             // lightning: crackle over a falling buzz
    for (let i = 0; i < 6; i++) noise({ dur: 0.04, vol: 0.4, f0: 2500 + Math.random() * 4000, q: 3, delay: i * 0.045 });
    tone({ type: 'sawtooth', f0: 1400, f1: 90, dur: 0.3, vol: 0.2 });
    tone({ f0: 90, f1: 40, dur: 0.4, vol: 0.4, delay: 0.05 });
  },
  breath() {                                          // a roar with a long rush of flame over it
    tone({ type: 'sawtooth', f0: 95, f1: 50, dur: 0.9, vol: 0.3 });
    noise({ dur: 1.0, vol: 0.55, f0: 450, f1: 1900, q: 0.6, attack: 0.15 });
  },
  web() {                                             // a wet slap and a stretch
    noise({ dur: 0.18, vol: 0.35, f0: 2600, f1: 500, q: 1.2 });
    tone({ type: 'triangle', f0: 900, f1: 240, dur: 0.3, vol: 0.14, delay: 0.05 });
  },
  dig() {                                             // earth breaking
    noise({ dur: 0.35, vol: 0.5, f0: 900, f1: 140, q: 0.6, type: 'lowpass' });
    tone({ f0: 90, f1: 40, dur: 0.3, vol: 0.4 });
  },
  rumble() { noise({ dur: 0.16, vol: 0.22, f0: 260, f1: 110, q: 0.7, type: 'lowpass' }); },
  whoosh() { noise({ dur: 0.4, vol: 0.3, f0: 300, f1: 1400, q: 0.9, attack: 0.1 }); },
  boom() {
    tone({ f0: 120, f1: 30, dur: 0.7, vol: 0.8 });
    noise({ dur: 0.6, vol: 0.6, f0: 2400, f1: 120, q: 0.5, type: 'lowpass' });
    noise({ dur: 0.9, vol: 0.2, f0: 500, f1: 80, q: 0.5, type: 'lowpass', delay: 0.15 });
  },
  iceShot() { tone({ type: 'triangle', f0: 1500, f1: 2600, dur: 0.25, vol: 0.18, attack: 0.05 }); },
  ice() {                                             // shatter: a few glassy pings
    for (let i = 0; i < 5; i++) tone({ type: 'triangle', f0: 2200 + Math.random() * 2600, dur: 0.18 + Math.random() * 0.2, vol: 0.16, delay: i * 0.03 });
    noise({ dur: 0.12, vol: 0.2, f0: 6000, f1: 3000, q: 2 });
  },
  blink() {
    tone({ f0: 300, f1: 1800, dur: 0.16, vol: 0.25 });
    tone({ f0: 1800, f1: 500, dur: 0.22, vol: 0.2, delay: 0.2 });
  },
  death() { tone({ type: 'triangle', f0: 330, f1: 70, dur: 0.5, vol: 0.3, delay: 0.1 }); },
  ambush() { tone({ type: 'square', f0: 700, f1: 700, dur: 0.07, vol: 0.15 }); tone({ type: 'square', f0: 940, dur: 0.1, vol: 0.15, delay: 0.09 }); },
  capture() { tone({ type: 'triangle', f0: 523, dur: 0.14, vol: 0.25 }); tone({ type: 'triangle', f0: 784, dur: 0.26, vol: 0.25, delay: 0.12 }); },
  turn() { tone({ f0: 660, dur: 0.12, vol: 0.12 }); tone({ f0: 880, dur: 0.18, vol: 0.12, delay: 0.09 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.32, vol: 0.3, delay: i * 0.13 })); },
  lose() { [392, 330, 262].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.4, vol: 0.28, delay: i * 0.2 })); },
};

export function play(name) {
  if (!enabled || !ac || ac.state !== 'running') return;
  try { SFX[name]?.(); } catch { /* never let a sound break the game */ }
}
