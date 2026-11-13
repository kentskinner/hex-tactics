// Painted unit tokens: each creature drawn from above, as a figure standing on the map, in the
// same manner as the painted maps — lit from the top-left, casting a shadow down-right, earthy
// colours, dark brown outlines. A work in progress: classes without a painter here keep their
// coin token from assets/tokens/.
//
//   paintedTokens() -> { <class>: [blue, red, neutral] } where each is { canvas, scale }.
// `scale` is how much bigger than a coin token the picture is drawn (it needs room for a sword
// tip or a wing).
//
// Figures are drawn facing +x in units of the hex size, then turned to face the enemy: Blue
// looks east, Red west, neutrals south. Shading and the cast shadow are applied afterwards in
// screen space, so the light comes from the same side whichever way a figure faces.

const TEAM = [
  { base: [62, 104, 168], dark: [30, 52, 98], light: [134, 170, 222] },
  { base: [172, 66, 56], dark: [98, 32, 28], light: [226, 138, 122] },
  { base: [150, 128, 168], dark: [78, 62, 96], light: [212, 196, 226] },     // neutral: dusky purple, clear of grass and trees
];
const FACING = [0, Math.PI, Math.PI / 2];
const OUT = 'rgba(24,16,10,0.9)';
const STEEL = [[198, 204, 214], [128, 136, 150], [72, 80, 96]];
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// A transparent square canvas `half` hex-sizes from centre to edge, U pixels per hex size, with
// the context set up so (0, 0) is the middle and 1 unit is one hex size.
function layer(half, U) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.ceil(2 * half * U);
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(U, U);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  return { canvas, ctx };
}

// Fill and outline a closed shape given as points (or a function that builds the path).
function shape(ctx, pts, fill, lw = 0.022) {
  ctx.beginPath();
  if (typeof pts === 'function') pts(ctx);
  else { pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (lw) { ctx.strokeStyle = OUT; ctx.lineWidth = lw; ctx.stroke(); }
}
const ellipse = (x, y, rx, ry, rot = 0) => (ctx) => ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);

// Light the finished figure from the top-left and lay it over its own blurred shadow.
function finish(fig, { under = null, drop = [0.07, 0.1], blur = 0.03, U }) {
  const size = fig.canvas.width;
  const f = fig.ctx;
  f.setTransform(1, 0, 0, 1, 0, 0);
  f.globalCompositeOperation = 'source-atop';
  const lit = f.createLinearGradient(0, 0, size, size);
  lit.addColorStop(0, 'rgba(255,250,235,0.2)'); lit.addColorStop(0.5, 'rgba(255,250,235,0)'); lit.addColorStop(0.5, 'rgba(10,8,20,0)'); lit.addColorStop(1, 'rgba(10,8,20,0.36)');
  f.fillStyle = lit; f.fillRect(0, 0, size, size);
  f.globalCompositeOperation = 'source-over';

  const dark = document.createElement('canvas');           // the figure's silhouette, in black
  dark.width = dark.height = size;
  const d = dark.getContext('2d');
  d.drawImage(fig.canvas, 0, 0);
  d.globalCompositeOperation = 'source-in';
  d.fillStyle = '#000'; d.fillRect(0, 0, size, size);

  const out = document.createElement('canvas');
  out.width = out.height = size;
  const o = out.getContext('2d');
  if (under) o.drawImage(under, 0, 0);
  o.save();
  o.globalAlpha = 0.42;
  o.filter = `blur(${Math.max(1, blur * U)}px)`;
  o.drawImage(dark, drop[0] * U, drop[1] * U);
  o.restore();
  o.drawImage(fig.canvas, 0, 0);
  return out;
}

// ---- Soldier: helmet with a crest, a surcoat in the team's colour, a shield on the left arm, a sword held forward ----
function soldier(team, facing = FACING[team]) {
  const T = TEAM[team], half = 0.84, U = 170;
  // The ground marker under the figure: a thin team-coloured ring, see-through in the middle.
  const base = layer(half, U), b = base.ctx;
  b.beginPath(); b.arc(0, 0, 0.47, 0, 6.3); b.fillStyle = rgb(T.base, 0.3); b.fill();
  b.lineWidth = 0.09; b.strokeStyle = OUT; b.stroke();
  b.lineWidth = 0.058; b.strokeStyle = rgb(T.base); b.stroke();
  b.lineWidth = 0.016; b.strokeStyle = rgb(T.light, 0.9); b.beginPath(); b.arc(0, 0, 0.487, 3.5, 5.1); b.stroke();

  const fig = layer(half, U), c = fig.ctx;
  c.rotate(facing);
  // Cloak trailing behind.
  shape(c, [[-0.02, -0.25], [-0.2, -0.27], [-0.36, -0.17], [-0.43, 0.0], [-0.37, 0.18], [-0.2, 0.27], [-0.02, 0.25]], rgb(T.dark));
  c.strokeStyle = rgb(T.base, 0.8); c.lineWidth = 0.016;
  for (const y of [-0.13, 0.0, 0.13]) { c.beginPath(); c.moveTo(-0.08, y); c.quadraticCurveTo(-0.24, y * 1.2, -0.38, y * 0.8 + 0.02); c.stroke(); }
  // Sword arm and sword (right side: +y when facing +x).
  shape(c, ellipse(0.12, 0.29, 0.15, 0.06, -0.12), rgb(STEEL[2]));
  shape(c, [[0.24, 0.235], [0.7, 0.2], [0.8, 0.235], [0.7, 0.265], [0.24, 0.295]], rgb(STEEL[0]), 0.02);
  c.strokeStyle = rgb(STEEL[2], 0.8); c.lineWidth = 0.012; c.beginPath(); c.moveTo(0.28, 0.265); c.lineTo(0.72, 0.234); c.stroke();
  shape(c, [[0.215, 0.17], [0.255, 0.17], [0.27, 0.36], [0.23, 0.36]], 'rgb(196,152,64)', 0.018);
  shape(c, ellipse(0.16, 0.275, 0.055, 0.036, -0.1), 'rgb(84,58,36)', 0.016);
  // Shoulders in mail, the surcoat over them, and a pauldron on each shoulder.
  shape(c, ellipse(0, 0, 0.16, 0.31), rgb(STEEL[2]));
  shape(c, ellipse(-0.01, 0, 0.17, 0.215), rgb(T.base));
  c.fillStyle = rgb(T.light); c.fillRect(-0.15, -0.035, 0.3, 0.07);          // a stripe down the surcoat
  for (const y of [-0.265, 0.265]) {
    shape(c, ellipse(0.0, y, 0.105, 0.085), rgb(STEEL[1]));
    c.strokeStyle = rgb(STEEL[0], 0.9); c.lineWidth = 0.014; c.beginPath(); c.arc(0.0, y, 0.055, 3.4, 5.6); c.stroke();
  }
  // Shield on the left arm, carried forward.
  c.save(); c.translate(0.24, -0.3); c.rotate(-0.38);
  shape(c, ellipse(0, 0, 0.14, 0.25), rgb(STEEL[1]));
  shape(c, ellipse(0, 0, 0.105, 0.21), rgb(T.base), 0.016);
  c.fillStyle = rgb(T.light); c.fillRect(-0.105, -0.028, 0.21, 0.056); c.fillRect(-0.028, -0.2, 0.056, 0.4);
  shape(c, ellipse(0, 0, 0.05, 0.055), 'rgb(206,164,76)', 0.016);
  c.restore();
  // Helmet with a crest and a nasal bar.
  const g = c.createRadialGradient(-0.01, -0.05, 0.01, 0.03, 0, 0.15);
  g.addColorStop(0, rgb(STEEL[0])); g.addColorStop(1, rgb(STEEL[2]));
  shape(c, ellipse(0.03, 0, 0.14, 0.135), g, 0.026);
  shape(c, [[0.14, -0.022], [0.235, -0.016], [0.235, 0.016], [0.14, 0.022]], rgb(STEEL[1]), 0.016);
  shape(c, [[-0.15, -0.04], [0.11, -0.03], [0.14, 0], [0.11, 0.03], [-0.15, 0.04], [-0.2, 0]], rgb(T.light), 0.018);
  return { canvas: finish(fig, { under: base.canvas, U }), scale: half / 0.56 };
}

// ---- Dragon: no ring at all — the creature itself, wings spread across its seven hexes ----
function dragon(team, facing = FACING[team]) {
  const T = TEAM[team], half = 2.55, U = 120;
  const hide = T.base, belly = mix(T.base, [232, 214, 170], 0.55), bone = [232, 220, 192];
  const fig = layer(half, U), c = fig.ctx;
  c.rotate(facing);

  // Tail: a tapering S-curve ending in a spade.
  const spine = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, u = 1 - t;
    const x = u * u * u * -0.7 + 3 * u * u * t * -1.45 + 3 * u * t * t * -1.75 + t * t * t * -2.25;
    const y = u * u * u * 0 + 3 * u * u * t * 0.5 + 3 * u * t * t * -0.35 + t * t * t * -0.12;
    spine.push([x, y, 0.2 * (1 - t) + 0.03]);
  }
  const side = (k) => spine.map(([x, y, w], i) => {
    const [ax, ay] = spine[Math.max(0, i - 1)], [bx, by] = spine[Math.min(spine.length - 1, i + 1)], l = Math.hypot(bx - ax, by - ay) || 1;
    return [x - (by - ay) / l * w * k, y + (bx - ax) / l * w * k];
  });
  shape(c, [...side(1), ...side(-1).reverse()], rgb(hide));
  const [tx, ty] = spine[spine.length - 1];
  shape(c, [[tx + 0.06, ty - 0.1], [tx - 0.24, ty - 0.02], [tx + 0.04, ty + 0.13], [tx - 0.02, ty + 0.01]], rgb(T.dark));

  // Wings: a membrane stretched over three fingers, scalloped along the trailing edge.
  for (const s of [-1, 1]) {
    const P = (x, y) => [x, y * s];
    const shoulder = P(0.3, 0.2), elbow = P(0.62, 0.92), wrist = P(0.3, 1.5), tip = P(-0.3, 2.3);
    const f1 = P(-0.86, 1.86), f2 = P(-1.12, 1.24), f3 = P(-1.0, 0.66), back = P(-0.5, 0.2);
    const web = c.createRadialGradient(wrist[0], wrist[1], 0.1, wrist[0] - 0.4, wrist[1] - 0.4 * s, 1.7);
    web.addColorStop(0, rgb(mix(T.base, T.light, 0.35))); web.addColorStop(1, rgb(T.dark));
    shape(c, (x) => {
      x.moveTo(...shoulder); x.lineTo(...elbow); x.lineTo(...wrist); x.lineTo(...tip);
      x.quadraticCurveTo(-0.42, 1.86 * s, ...f1);
      x.quadraticCurveTo(-0.72, 1.42 * s, ...f2);
      x.quadraticCurveTo(-0.76, 0.9 * s, ...f3);
      x.quadraticCurveTo(-0.6, 0.42 * s, ...back);
      x.closePath();
    }, web, 0.024);
    c.strokeStyle = rgb(T.dark, 0.55); c.lineWidth = 0.012;                 // folds in the membrane
    for (const [a, b2] of [[tip, f1], [f1, f2], [f2, f3]]) { c.beginPath(); c.moveTo(...wrist); c.lineTo((a[0] + b2[0]) / 2 + 0.06, (a[1] + b2[1]) / 2); c.stroke(); }
    for (const [a, b2, w] of [[shoulder, elbow, 0.085], [elbow, wrist, 0.07], [wrist, tip, 0.05], [wrist, f1, 0.04], [wrist, f2, 0.04], [wrist, f3, 0.04]]) {   // arm and finger bones
      c.strokeStyle = OUT; c.lineWidth = w + 0.03; c.beginPath(); c.moveTo(...a); c.lineTo(...b2); c.stroke();
      c.strokeStyle = rgb(mix(hide, T.light, 0.3)); c.lineWidth = w; c.beginPath(); c.moveTo(...a); c.lineTo(...b2); c.stroke();
    }
    shape(c, [[wrist[0] + 0.02, wrist[1] + 0.03 * s], [wrist[0] + 0.2, wrist[1] + 0.2 * s], [wrist[0] + 0.09, wrist[1] - 0.02 * s]], rgb(bone), 0.016);    // wing claw
  }

  // Legs, tucked in at the sides, with claws.
  for (const [lx, ly, fwd] of [[0.36, 0.3, 1], [-0.42, 0.33, 1]]) for (const s of [-1, 1]) {
    shape(c, ellipse(lx, ly * s, 0.2, 0.11, 0.35 * s * fwd), rgb(mix(hide, T.dark, 0.25)));
    for (const k of [-1, 0, 1]) shape(c, [[lx + 0.17, (ly + 0.05 + k * 0.045) * s], [lx + 0.3, (ly + 0.1 + k * 0.06) * s], [lx + 0.18, (ly + 0.09 + k * 0.045) * s]], rgb(bone), 0.012);
  }

  // Body, neck and head.
  shape(c, ellipse(-0.1, 0, 0.78, 0.31), rgb(hide));
  shape(c, [[0.5, -0.19], [1.02, -0.11], [1.02, 0.11], [0.5, 0.19]], rgb(hide));
  c.strokeStyle = rgb(T.dark, 0.5); c.lineWidth = 0.012;                   // scales
  for (let x = -0.72; x < 0.95; x += 0.13) for (const y of [-0.16, -0.06, 0.06, 0.16]) {
    if (Math.abs(y) > 0.3 * Math.sqrt(Math.max(0, 1 - ((x + 0.1) / 0.78) ** 2)) + (x > 0.5 ? 0.14 : -0.02)) continue;
    c.beginPath(); c.arc(x, y, 0.05, -1.1, 1.1); c.stroke();
  }
  shape(c, [[0.94, -0.17], [1.2, -0.15], [1.46, -0.07], [1.54, 0], [1.46, 0.07], [1.2, 0.15], [0.94, 0.17], [0.88, 0]], rgb(hide));
  shape(c, [[1.28, -0.1], [1.5, -0.045], [1.5, 0.045], [1.28, 0.1]], rgb(belly), 0.014);       // snout
  for (const s of [-1, 1]) {
    shape(c, [[1.02, 0.12 * s], [0.66, 0.36 * s], [0.6, 0.31 * s], [0.9, 0.06 * s]], rgb(bone), 0.018);     // horns, swept back
    shape(c, ellipse(1.19, 0.095 * s, 0.045, 0.028, 0.3 * s), 'rgb(255,208,64)', 0.012);
    c.fillStyle = '#16100a'; c.beginPath(); c.ellipse(1.195, 0.095 * s, 0.012, 0.024, 0.3 * s, 0, 6.3); c.fill();
    c.beginPath(); c.arc(1.47, 0.025 * s, 0.012, 0, 6.3); c.fill();
  }
  // Ridge of spines down the back, from the nape to the root of the tail.
  for (let x = 0.84; x > -1.0; x -= 0.15) {
    const r = 0.055 * (0.5 + 0.5 * Math.sin((x + 1) * 1.7));
    shape(c, [[x + r * 1.5, 0], [x, -r], [x - r * 1.9, 0], [x, r]], rgb(mix(T.light, bone, 0.4)), 0.014);
  }
  return { canvas: finish(fig, { drop: [0.2, 0.28], blur: 0.07, U }), scale: half / (0.56 * 2.8) };
}

// The painted figures, made on demand and kept: get(cls, team, angle) -> { canvas, scale } or null.
// `angle` is which way the figure faces on screen (radians, 0 = east; default: toward the enemy).
// A figure is repainted for each facing rather than turned as a picture, because the light and the
// shadow must stay put while the figure turns. Facings are rounded to steps of 15 degrees.
export function paintedTokens() {
  const painters = { soldier, dragon }, cache = new Map(), STEP = Math.PI / 12;
  return {
    has: (cls) => !!painters[cls],
    facing: (team) => FACING[team] ?? 0,
    get(cls, team, angle) {
      if (!painters[cls]) return null;
      const q = ((Math.round((angle ?? FACING[team] ?? 0) / STEP) % 24) + 24) % 24, k = cls + '|' + team + '|' + q;
      if (!cache.has(k)) {
        try { cache.set(k, painters[cls](team, q * STEP)); } catch (err) { console.warn('token painter failed for', cls, err); cache.set(k, null); }
      }
      return cache.get(k);
    },
  };
}
