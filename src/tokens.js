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

// ---- One-hex figures ----
// A person seen from above is mostly a head and shoulders, so these lean on three things to stay
// readable: a pale disc under the figure (so it never sits dark-on-dark), a bold ring in the
// team's colour around it, and an oversized, distinctive outline — the soldier's round shield, the
// archer's drawn bow, the wizard's hat brim, the spider's legs.
const LEATHER = [[168, 128, 82], [122, 88, 54], [76, 52, 32]];
const WOOD = [146, 100, 56], BONE = [236, 226, 198], BRASS = [208, 166, 78];

function small(team, facing, draw) {
  const T = TEAM[team], half = 0.86, U = 170;
  const base = layer(half, U), b = base.ctx;
  const disc = b.createRadialGradient(-0.12, -0.14, 0.05, 0, 0, 0.5);
  disc.addColorStop(0, 'rgba(246,238,216,0.78)'); disc.addColorStop(1, 'rgba(214,202,172,0.66)');
  b.beginPath(); b.arc(0, 0, 0.5, 0, 6.3); b.fillStyle = disc; b.fill();
  b.lineWidth = 0.115; b.strokeStyle = OUT; b.stroke();
  b.lineWidth = 0.08; b.strokeStyle = rgb(T.base); b.stroke();
  b.lineWidth = 0.02; b.strokeStyle = rgb(T.light); b.beginPath(); b.arc(0, 0, 0.522, 3.4, 5.3); b.stroke();
  b.lineWidth = 0.02; b.strokeStyle = rgb(T.dark); b.beginPath(); b.arc(0, 0, 0.522, 0.3, 2.1); b.stroke();
  const fig = layer(half, U), c = fig.ctx;
  c.rotate(facing);
  draw(c, T);
  return { canvas: finish(fig, { under: base.canvas, drop: [0.05, 0.075], blur: 0.022, U }), scale: half / 0.56 };
}
const LW = 0.03;                                    // outline weight for small figures: heavier, to hold up when tiny

// Soldier: bright helmet with a crest, mail shoulders, a big round shield and a broad sword.
function soldier(team, facing = FACING[team]) {
  return small(team, facing, (c, T) => {
    shape(c, [[-0.04, -0.24], [-0.22, -0.2], [-0.33, 0.0], [-0.22, 0.2], [-0.04, 0.24]], rgb(T.dark), LW);       // short cloak
    shape(c, ellipse(0.14, 0.3, 0.16, 0.07, -0.1), rgb(STEEL[2]), LW);                                           // sword arm
    shape(c, [[0.26, 0.225], [0.72, 0.19], [0.84, 0.235], [0.72, 0.275], [0.26, 0.31]], rgb(STEEL[0]), LW);        // blade
    shape(c, [[0.225, 0.15], [0.275, 0.15], [0.29, 0.385], [0.24, 0.385]], rgb(BRASS), 0.022);                     // crossguard
    shape(c, ellipse(0, 0, 0.17, 0.32), rgb(STEEL[1]), LW);                                                        // shoulders
    for (const y of [-0.27, 0.27]) shape(c, ellipse(0.0, y, 0.11, 0.09), rgb(STEEL[0]), 0.024);
    shape(c, ellipse(0.25, -0.27, 0.21, 0.21), rgb(STEEL[1]), LW);                                                 // round shield, rim
    shape(c, ellipse(0.25, -0.27, 0.16, 0.16), rgb(T.base), 0.02);
    c.fillStyle = rgb(T.light); c.fillRect(0.09, -0.3, 0.32, 0.06); c.fillRect(0.22, -0.43, 0.06, 0.32);
    shape(c, ellipse(0.25, -0.27, 0.055, 0.055), rgb(BRASS), 0.02);
    const g = c.createRadialGradient(0.0, -0.05, 0.01, 0.03, 0, 0.16);
    g.addColorStop(0, 'rgb(236,240,246)'); g.addColorStop(1, rgb(STEEL[1]));
    shape(c, ellipse(0.03, 0, 0.155, 0.15), g, LW);                                                                // helmet
    shape(c, [[0.15, -0.025], [0.25, -0.018], [0.25, 0.018], [0.15, 0.025]], rgb(STEEL[1]), 0.02);
    shape(c, [[-0.16, -0.045], [0.12, -0.034], [0.15, 0], [0.12, 0.034], [-0.16, 0.045], [-0.22, 0]], rgb(T.base), 0.022);   // crest
  });
}

// Archer: a hooded figure at full draw — the bow across the front, the arrow pointing ahead, a quiver behind.
function archer(team, facing = FACING[team]) {
  return small(team, facing, (c, T) => {
    shape(c, [[-0.02, -0.22], [-0.22, -0.2], [-0.36, -0.04], [-0.3, 0.16], [-0.12, 0.24], [-0.02, 0.22]], rgb(LEATHER[1]), LW);   // cloak
    c.save(); c.translate(-0.2, 0.12); c.rotate(0.5);                                                               // quiver
    shape(c, [[-0.13, -0.055], [0.1, -0.05], [0.1, 0.05], [-0.13, 0.055]], rgb(LEATHER[2]), 0.022);
    for (const y of [-0.03, 0, 0.03]) shape(c, [[-0.13, y - 0.012], [-0.21, y - 0.028], [-0.2, y + 0.02], [-0.13, y + 0.012]], rgb(T.light), 0.012);
    c.restore();
    shape(c, ellipse(0, 0, 0.15, 0.28), rgb(LEATHER[0]), LW);                                                       // shoulders
    shape(c, ellipse(0.2, -0.13, 0.19, 0.06, 0.35), rgb(LEATHER[0]), 0.024);                                        // bow arm
    shape(c, ellipse(0.04, 0.2, 0.12, 0.06, -0.5), rgb(LEATHER[0]), 0.024);                                         // drawing arm
    // The bow: a curve across the front with its tips swept back, strung to the drawing hand.
    const bow = (x) => { x.moveTo(0.2, -0.56); x.quadraticCurveTo(0.56, 0, 0.2, 0.56); };
    c.beginPath(); bow(c); c.strokeStyle = OUT; c.lineWidth = 0.1; c.stroke();
    c.beginPath(); bow(c); c.strokeStyle = rgb(WOOD); c.lineWidth = 0.06; c.stroke();
    c.beginPath(); bow(c); c.strokeStyle = 'rgba(255,236,200,0.5)'; c.lineWidth = 0.018; c.stroke();
    c.strokeStyle = 'rgba(40,32,24,0.9)'; c.lineWidth = 0.014; c.beginPath(); c.moveTo(0.2, -0.56); c.lineTo(0.06, 0.02); c.lineTo(0.2, 0.56); c.stroke();
    shape(c, [[0.04, 0.0], [0.6, -0.006], [0.6, 0.034], [0.04, 0.04]], rgb(BONE), 0.016);                           // arrow
    shape(c, [[0.58, -0.05], [0.76, 0.014], [0.58, 0.08]], rgb(STEEL[0]), 0.02);
    shape(c, ellipse(0.02, 0, 0.15, 0.145), rgb(T.base), LW);                                                       // hood
    shape(c, [[-0.1, -0.09], [-0.24, 0], [-0.1, 0.09]], rgb(T.base), 0.024);
    c.strokeStyle = rgb(T.light); c.lineWidth = 0.02; c.beginPath(); c.arc(0.02, 0, 0.1, -1.1, 1.1); c.stroke();
  });
}

// Scout: slim and fast — a long cloak streaming behind, a feathered cap, a short blade in each hand.
function scout(team, facing = FACING[team]) {
  return small(team, facing, (c, T) => {
    shape(c, [[0.0, -0.2], [-0.2, -0.22], [-0.42, -0.12], [-0.62, -0.16], [-0.5, 0.0], [-0.64, 0.14], [-0.42, 0.13], [-0.2, 0.22], [0.0, 0.2]], rgb(T.base), LW);   // cloak
    c.strokeStyle = rgb(T.dark, 0.7); c.lineWidth = 0.016;
    for (const y of [-0.09, 0.02, 0.11]) { c.beginPath(); c.moveTo(-0.06, y); c.lineTo(-0.44, y * 1.2); c.stroke(); }
    for (const s of [-1, 1]) {
      shape(c, ellipse(0.16, 0.24 * s, 0.17, 0.06, 0.28 * s), rgb(LEATHER[0]), 0.024);                              // arm
      shape(c, [[0.28, 0.25 * s], [0.66, 0.36 * s], [0.72, 0.42 * s], [0.62, 0.42 * s], [0.26, 0.31 * s]], rgb(STEEL[0]), 0.024);   // blade
      shape(c, [[0.25, 0.2 * s], [0.3, 0.21 * s], [0.27, 0.36 * s], [0.22, 0.35 * s]], rgb(BRASS), 0.018);
    }
    shape(c, ellipse(0, 0, 0.13, 0.25), rgb(LEATHER[1]), LW);                                                       // shoulders
    c.strokeStyle = rgb(LEATHER[2]); c.lineWidth = 0.03; c.beginPath(); c.moveTo(-0.1, -0.2); c.lineTo(0.1, 0.2); c.stroke();     // baldric
    shape(c, ellipse(0.03, 0, 0.135, 0.13), rgb(LEATHER[0]), LW);                                                   // cap
    shape(c, [[0.0, -0.03], [-0.36, -0.22], [-0.46, -0.14], [-0.3, -0.08], [-0.04, 0.03]], rgb(T.light), 0.02);     // feather
  });
}

// Wizard: a wide hat brim with the point flopping back, robes, a staff with a glowing head.
function wizard(team, facing = FACING[team]) {
  return small(team, facing, (c, T) => {
    shape(c, ellipse(-0.04, 0, 0.3, 0.3), rgb(T.dark), LW);                                                         // robes
    c.strokeStyle = rgb(T.light, 0.85); c.lineWidth = 0.022; c.beginPath(); c.arc(-0.04, 0, 0.255, 0.5, 5.8); c.stroke();
    shape(c, ellipse(0.2, 0.26, 0.13, 0.055, 0.2), rgb(T.dark), 0.024);                                             // staff arm
    shape(c, [[-0.3, 0.3], [0.62, 0.3], [0.62, 0.35], [-0.3, 0.35]], rgb(WOOD), 0.022);                             // staff
    const glow = c.createRadialGradient(0.68, 0.325, 0.01, 0.68, 0.325, 0.2);
    glow.addColorStop(0, 'rgba(255,255,255,0.95)'); glow.addColorStop(0.35, 'rgba(150,230,255,0.7)'); glow.addColorStop(1, 'rgba(150,230,255,0)');
    c.fillStyle = glow; c.beginPath(); c.arc(0.68, 0.325, 0.2, 0, 6.3); c.fill();
    shape(c, ellipse(0.68, 0.325, 0.075, 0.075), 'rgb(190,240,255)', 0.022);
    shape(c, ellipse(0.22, -0.24, 0.12, 0.05, -0.25), rgb(T.dark), 0.024);                                          // casting arm
    shape(c, ellipse(0.34, -0.28, 0.045, 0.045), 'rgb(232,196,160)', 0.018);
    shape(c, ellipse(0.03, 0, 0.245, 0.24), rgb(T.base), LW);                                                       // hat brim
    c.strokeStyle = rgb(T.light); c.lineWidth = 0.02; c.beginPath(); c.arc(0.03, 0, 0.2, 0, 6.3); c.stroke();
    shape(c, [[0.14, -0.1], [-0.02, -0.13], [-0.32, -0.02], [-0.02, 0.13], [0.14, 0.1], [0.17, 0]], rgb(mix(T.base, T.light, 0.25)), 0.024);   // the cone, lying back
    c.fillStyle = rgb(BRASS);                                                                                       // a star on it
    c.beginPath(); for (let i = 0; i < 10; i++) { const an = i * 0.6283, r = i % 2 ? 0.022 : 0.055; c.lineTo(0.0 + Math.cos(an) * r, Math.sin(an) * r); } c.closePath(); c.fill();
  });
}

// Giant spider: seen from above as any spider is — eight bent legs, a marked abdomen, a cluster of eyes.
function spider(team, facing = FACING[team]) {
  return small(team, facing, (c, T) => {
    const dark = [44, 36, 48], mid = [78, 66, 82];
    for (const s of [-1, 1]) for (const [a0, k, f] of [[0.55, 0.42, 0.72], [1.15, 0.46, 0.7], [1.85, 0.46, 0.68], [2.5, 0.44, 0.74]]) {
      const hip = [0.1 + Math.cos(a0) * 0.08, Math.sin(a0) * 0.1 * s], knee = [0.08 + Math.cos(a0) * k, Math.sin(a0) * k * s], foot = [0.08 + Math.cos(a0 + 0.38) * f, Math.sin(a0 + 0.38) * f * s];
      for (const [col, w] of [[OUT, 0.075], [rgb(mid), 0.04]]) { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(...hip); c.lineTo(...knee); c.lineTo(...foot); c.stroke(); }
    }
    shape(c, ellipse(-0.18, 0, 0.25, 0.21), rgb(dark), LW);                                                         // abdomen
    shape(c, [[-0.3, 0], [-0.2, -0.085], [-0.14, 0], [-0.08, -0.07], [-0.02, 0], [-0.08, 0.07], [-0.14, 0], [-0.2, 0.085]], rgb(T.base), 0.016);   // its marking
    shape(c, ellipse(0.14, 0, 0.15, 0.135), rgb(mid), LW);                                                          // head and thorax
    for (const s of [-1, 1]) {
      shape(c, [[0.25, 0.05 * s], [0.38, 0.04 * s], [0.3, 0.1 * s]], rgb(BONE), 0.016);                             // fangs
      for (const [x, y, r] of [[0.22, 0.04, 0.022], [0.19, 0.085, 0.017], [0.16, 0.035, 0.014]]) { c.fillStyle = 'rgb(255,84,64)'; c.beginPath(); c.arc(x, y * s, r, 0, 6.3); c.fill(); }
    }
  });
}

// Bat swarm: five bats in loose formation, wings spread.
function bat(team, facing = FACING[team]) {
  return small(team, facing, (c, T) => {
    const fur = [58, 48, 66], web = mix(T.dark, [70, 56, 84], 0.55);
    const one = (x, y, k, tilt) => {
      c.save(); c.translate(x, y); c.rotate(tilt); c.scale(k, k);
      for (const s of [-1, 1]) {
        shape(c, (p) => {
          p.moveTo(0.04, 0.03 * s); p.lineTo(0.12, 0.2 * s); p.lineTo(0.0, 0.4 * s);
          p.quadraticCurveTo(-0.02, 0.3 * s, -0.1, 0.3 * s); p.quadraticCurveTo(-0.08, 0.2 * s, -0.16, 0.16 * s); p.quadraticCurveTo(-0.1, 0.09 * s, -0.12, 0.03 * s);
          p.closePath();
        }, rgb(web), 0.03);
        c.strokeStyle = rgb(mix(web, T.light, 0.4)); c.lineWidth = 0.016;
        for (const [ex, ey] of [[0.0, 0.4], [-0.1, 0.3], [-0.16, 0.16]]) { c.beginPath(); c.moveTo(0.1, 0.19 * s); c.lineTo(ex, ey * s); c.stroke(); }
      }
      shape(c, ellipse(-0.01, 0, 0.12, 0.06), rgb(fur), 0.028);
      for (const s of [-1, 1]) {
        shape(c, [[0.08, 0.02 * s], [0.15, 0.07 * s], [0.1, 0.06 * s]], rgb(fur), 0.02);                             // ears
        c.fillStyle = 'rgb(255,214,80)'; c.beginPath(); c.arc(0.1, 0.022 * s, 0.014, 0, 6.3); c.fill();
      }
      c.restore();
    };
    one(-0.22, -0.26, 0.62, -0.25); one(-0.28, 0.2, 0.68, 0.2); one(0.26, -0.26, 0.6, 0.15); one(0.24, 0.27, 0.58, -0.2); one(0.0, 0.0, 1.0, 0);
  });
}

// Cave troll: hunched and long-armed — grey-green hide, big pointed ears, tusks, claws, a mossy mane.
function troll(team, facing = FACING[team]) {
  return small(team, facing, (c, T) => {
    const hide = [128, 148, 116], shade = [84, 102, 78], moss = [58, 84, 50];
    for (const s of [-1, 1]) {
      shape(c, ellipse(0.2, 0.33 * s, 0.24, 0.085, 0.16 * s), rgb(hide), LW);                                       // long arms
      shape(c, ellipse(0.44, 0.37 * s, 0.085, 0.08), rgb(hide), 0.024);
      for (const k of [-1, 0, 1]) shape(c, [[0.49, (0.37 + k * 0.05) * s], [0.62, (0.39 + k * 0.075) * s], [0.5, (0.4 + k * 0.05) * s]], rgb(BONE), 0.014);    // claws
    }
    shape(c, ellipse(-0.04, 0, 0.24, 0.36), rgb(hide), LW);                                                         // the hunched back
    c.strokeStyle = rgb(shade, 0.8); c.lineWidth = 0.02;
    for (const x of [-0.16, -0.06]) { c.beginPath(); c.moveTo(x, -0.2); c.quadraticCurveTo(x - 0.06, 0, x, 0.2); c.stroke(); }
    shape(c, [[-0.06, -0.3], [0.04, -0.34], [0.1, 0.3], [0.0, 0.34]], rgb(T.base), 0.022);                          // a sash in the team's colour
    shape(c, [[-0.02, -0.1], [-0.2, -0.16], [-0.34, -0.05], [-0.26, 0.0], [-0.36, 0.07], [-0.2, 0.16], [-0.02, 0.1]], rgb(moss), 0.024);    // mane
    for (const s of [-1, 1]) shape(c, [[0.06, 0.12 * s], [0.0, 0.34 * s], [0.16, 0.16 * s]], rgb(shade), 0.022);    // ears
    const g = c.createRadialGradient(0.06, -0.06, 0.01, 0.1, 0, 0.19);
    g.addColorStop(0, rgb(mix(hide, [240, 250, 220], 0.35))); g.addColorStop(1, rgb(hide));
    shape(c, ellipse(0.1, 0, 0.18, 0.17), g, LW);                                                                   // head
    c.strokeStyle = rgb(shade); c.lineWidth = 0.03; c.beginPath(); c.moveTo(0.2, -0.11); c.quadraticCurveTo(0.25, 0, 0.2, 0.11); c.stroke();   // brow
    for (const s of [-1, 1]) {
      shape(c, [[0.24, 0.05 * s], [0.38, 0.1 * s], [0.26, 0.11 * s]], rgb(BONE), 0.016);                            // tusks
      c.fillStyle = 'rgb(255,210,70)'; c.beginPath(); c.arc(0.2, 0.06 * s, 0.018, 0, 6.3); c.fill();
    }
  });
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

// ---- Ogre: a broad back under a fur mantle in the team's colour, a bald head, a spiked club held forward ----
function ogre(team, facing = FACING[team]) {
  const T = TEAM[team], half = 1.55, U = 130;
  const skin = [172, 152, 112], shade = [118, 100, 70], bone = [232, 220, 192], wood = [134, 92, 52];
  const fig = layer(half, U), c = fig.ctx;
  c.rotate(facing);
  // Feet, just showing in front of the belly.
  for (const s of [-1, 1]) shape(c, ellipse(0.34, 0.27 * s, 0.2, 0.13, 0.15 * s), rgb(shade));
  // Club arm (right) and the club itself, swung forward across the body.
  shape(c, ellipse(0.26, 0.62, 0.34, 0.15, -0.12), rgb(skin));
  shape(c, [[0.42, 0.5], [1.22, 0.1], [1.38, 0.2], [1.36, 0.42], [1.2, 0.5], [0.5, 0.66]], rgb(wood));
  c.strokeStyle = rgb(mix(wood, [40, 24, 10], 0.5), 0.7); c.lineWidth = 0.018;
  for (const k of [0.3, 0.55, 0.8]) { c.beginPath(); c.moveTo(0.5 + k * 0.1, 0.52 + k * 0.1); c.lineTo(1.24 + k * 0.1, 0.16 + k * 0.28); c.stroke(); }
  for (const [x, y, dx, dy] of [[1.1, 0.16, -0.02, -0.16], [1.3, 0.14, 0.1, -0.14], [1.4, 0.3, 0.17, 0.0], [1.3, 0.47, 0.1, 0.14], [1.08, 0.53, -0.02, 0.15]]) {
    shape(c, [[x - dy * 0.3, y + dx * 0.3], [x + dx, y + dy], [x + dy * 0.3, y - dx * 0.3]], rgb(STEEL[0]), 0.016);
  }
  shape(c, ellipse(0.5, 0.58, 0.14, 0.13), rgb(skin));                       // fist on the grip
  // Free arm (left), fist forward.
  shape(c, ellipse(0.3, -0.62, 0.34, 0.15, 0.2), rgb(skin));
  shape(c, ellipse(0.62, -0.55, 0.15, 0.14), rgb(skin));
  c.strokeStyle = rgb(shade, 0.8); c.lineWidth = 0.016;
  for (const k of [-0.05, 0.02, 0.09]) { c.beginPath(); c.moveTo(0.7, -0.55 + k); c.lineTo(0.76, -0.55 + k); c.stroke(); }
  // The great back and belly.
  shape(c, ellipse(-0.02, 0, 0.5, 0.7), rgb(skin));
  // Fur mantle over the shoulders and down the back: this carries the team's colour.
  shape(c, (x) => {
    x.moveTo(0.1, -0.74);
    const edge = [[-0.2, -0.82], [-0.34, -0.66], [-0.5, -0.6], [-0.52, -0.4], [-0.66, -0.3], [-0.6, -0.12], [-0.72, 0], [-0.6, 0.12], [-0.66, 0.3], [-0.52, 0.4], [-0.5, 0.6], [-0.34, 0.66], [-0.2, 0.82], [0.1, 0.74]];
    for (const [px, py] of edge) x.lineTo(px, py);
    x.quadraticCurveTo(-0.06, 0.4, -0.02, 0); x.quadraticCurveTo(-0.06, -0.4, 0.1, -0.74);
    x.closePath();
  }, rgb(T.base));
  c.strokeStyle = rgb(T.dark, 0.7); c.lineWidth = 0.016;                     // tufts
  for (let i = 0; i < 26; i++) {
    const a = 1.75 + (i / 25) * 2.78, r = 0.3 + (i % 3) * 0.1, x = -0.05 + Math.cos(a) * r * 0.9, y = Math.sin(a) * r * 1.5;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x - 0.07, y + (i % 2 ? 0.03 : -0.03)); c.stroke();
  }
  c.strokeStyle = rgb(T.light, 0.9); c.lineWidth = 0.03;                     // a paler band along its front edge
  c.beginPath(); c.moveTo(0.08, -0.7); c.quadraticCurveTo(-0.08, -0.4, -0.04, 0); c.quadraticCurveTo(-0.08, 0.4, 0.08, 0.7); c.stroke();
  // Spiked shoulder plates.
  for (const s of [-1, 1]) {
    shape(c, ellipse(0.02, 0.63 * s, 0.22, 0.17), rgb(STEEL[1]));
    for (const [dx, dy] of [[-0.14, 0.14], [0.0, 0.2], [0.14, 0.14]]) shape(c, [[0.02 + dx - 0.04, (0.63 + dy * 0.6) * s], [0.02 + dx * 1.3, (0.63 + dy * 1.25) * s], [0.02 + dx + 0.04, (0.63 + dy * 0.6) * s]], rgb(bone), 0.014);
  }
  // Head: bald, heavy-browed, with ears and two tusks.
  for (const s of [-1, 1]) shape(c, ellipse(0.1, 0.29 * s, 0.07, 0.09, 0.3 * s), rgb(shade));
  const g = c.createRadialGradient(0.08, -0.08, 0.02, 0.14, 0, 0.3);
  g.addColorStop(0, rgb(mix(skin, [255, 240, 200], 0.3))); g.addColorStop(1, rgb(skin));
  shape(c, ellipse(0.14, 0, 0.27, 0.26), g, 0.026);
  c.strokeStyle = rgb(shade); c.lineWidth = 0.03; c.beginPath(); c.moveTo(0.3, -0.17); c.quadraticCurveTo(0.36, 0, 0.3, 0.17); c.stroke();     // brow
  c.strokeStyle = rgb(shade, 0.7); c.lineWidth = 0.014; c.beginPath(); c.moveTo(0.02, -0.12); c.lineTo(0.16, -0.02); c.stroke();                // a scar
  for (const s of [-1, 1]) shape(c, [[0.36, 0.07 * s], [0.5, 0.13 * s], [0.38, 0.14 * s]], rgb(bone), 0.014);
  return { canvas: finish(fig, { drop: [0.1, 0.14], blur: 0.04, U }), scale: half / (0.56 * 1.85) };
}

// ---- Rock worm: reared up out of broken ground, seen straight down its ringed body into the maw ----
function worm(team, facing = FACING[team]) {
  const T = TEAM[team], half = 1.55, U = 130;
  const hide = mix(T.base, [176, 128, 112], 0.4), bone = [238, 228, 200];
  const fig = layer(half, U), c = fig.ctx;
  c.rotate(facing);
  // Ground it has burst through: a ragged ring of thrown-up earth and stones.
  const rim = [];
  for (let i = 0; i < 22; i++) { const a = (i / 22) * 6.283, r = 1.14 + 0.14 * Math.sin(i * 2.7) + 0.08 * Math.cos(i * 5.1); rim.push([Math.cos(a) * r, Math.sin(a) * r]); }
  shape(c, rim, 'rgb(112,90,62)');
  c.strokeStyle = 'rgba(40,28,14,0.55)'; c.lineWidth = 0.02;
  for (let i = 0; i < 11; i++) { const a = i * 0.571 + 0.2; c.beginPath(); c.moveTo(Math.cos(a) * 0.9, Math.sin(a) * 0.9); c.lineTo(Math.cos(a + 0.08) * 1.16, Math.sin(a + 0.08) * 1.16); c.stroke(); }
  for (let i = 0; i < 9; i++) { const a = i * 0.698 + 0.5, r = 1.02 + (i % 3) * 0.07; shape(c, ellipse(Math.cos(a) * r, Math.sin(a) * r, 0.07 + (i % 2) * 0.03, 0.055, a), 'rgb(150,142,128)', 0.014); }
  // The body: rings of hide, each a little further forward, so it leans the way it faces.
  for (let i = 0; i < 5; i++) {
    const r = 0.92 - i * 0.085, x = i * 0.075;
    shape(c, ellipse(x, 0, r, r), rgb(mix(hide, i % 2 ? T.dark : T.light, i % 2 ? 0.28 : 0.12)), 0.024);
    c.strokeStyle = rgb(T.dark, 0.35); c.lineWidth = 0.012;                  // plates across each ring
    for (let k = 0; k < 14; k++) { const a = (k / 14) * 6.283 + i * 0.22; c.beginPath(); c.moveTo(x + Math.cos(a) * (r - 0.075), Math.sin(a) * (r - 0.075)); c.lineTo(x + Math.cos(a) * (r - 0.012), Math.sin(a) * (r - 0.012)); c.stroke(); }
  }
  // The maw.
  const mx = 0.36, mr = 0.5;
  const throat = c.createRadialGradient(mx, 0, 0.04, mx, 0, mr);
  throat.addColorStop(0, 'rgb(14,4,6)'); throat.addColorStop(0.55, 'rgb(86,18,24)'); throat.addColorStop(1, 'rgb(176,58,62)');
  shape(c, ellipse(mx, 0, mr, mr), throat, 0.028);
  for (const [n, r0, r1, w] of [[15, mr - 0.01, mr - 0.2, 0.062], [10, mr - 0.2, mr - 0.33, 0.05]]) {     // two rows of teeth
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 6.283 + (n === 10 ? 0.3 : 0), p = (r, da) => [mx + Math.cos(a + da) * r, Math.sin(a + da) * r];
      shape(c, [p(r0, -w / r0 * 1.6), p(r1, 0), p(r0, w / r0 * 1.6)], rgb(bone), 0.014);
    }
  }
  c.fillStyle = 'rgb(8,2,3)'; c.beginPath(); c.arc(mx, 0, 0.1, 0, 6.3); c.fill();
  return { canvas: finish(fig, { drop: [0.08, 0.11], blur: 0.035, U }), scale: half / (0.56 * 1.85) };
}

// The painted figures, made on demand and kept: get(cls, team, angle) -> { canvas, scale } or null.
// `angle` is which way the figure faces on screen (radians, 0 = east; default: toward the enemy).
// A figure is repainted for each facing rather than turned as a picture, because the light and the
// shadow must stay put while the figure turns. Facings are rounded to steps of 15 degrees.
export function paintedTokens() {
  const painters = { soldier, archer, scout, wizard, spider, bat, troll, dragon, ogre, worm }, cache = new Map(), STEP = Math.PI / 12;
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
