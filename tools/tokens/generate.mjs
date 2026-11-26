// Painterly unit tokens, generated with the Codex CLI's built-in image tool (needs `codex` signed
// in) and cut out with cutout.py (needs Python with Pillow and numpy).
//
//   node tools/tokens/generate.mjs                 # every class that has no token yet
//   node tools/tokens/generate.mjs soldier dragon  # just these, replacing what is there
//   node tools/tokens/generate.mjs --portraits     # the close-up portraits instead of the standing figures
//
// Each figure is generated on flat magenta into tools/tokens/raw/<class>.png (not kept in git),
// then keyed out, trimmed and saved as assets/tokens/painterly/<class>.webp (portraits:
// assets/tokens/portrait/<class>.webp). The game picks the files up by name; a class without one
// keeps its classic token.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORTRAITS = process.argv.includes('--portraits');
const RAW = 'tools/tokens/raw', OUT = PORTRAITS ? 'assets/tokens/portrait' : 'assets/tokens/painterly', SUFFIX = PORTRAITS ? '.portrait' : '';

const FANTASY = 'a fantasy turn-based tactics game', SCIFI = 'a science-fiction turn-based tactics game';
const UNITS = {
  soldier: [FANTASY, 'a knight in steel plate armour with a crested helmet, a round wooden shield with a brass boss, and a broad sword held ready'],
  archer: [FANTASY, 'a hooded ranger in a worn olive-brown leather cloak, drawing a longbow, a quiver of arrows on the back'],
  scout: [FANTASY, 'a light, quick scout in a short grey travelling cloak and leather jerkin, crouched mid-stride with a dagger in each hand'],
  wizard: [FANTASY, 'an old wizard with a long grey beard, a wide-brimmed pointed hat and dusty slate-grey robes, raising a wooden staff tipped with a glowing pale crystal'],
  cleric: [FANTASY, 'a cleric in cream and ochre robes over mail, holding a mace in one hand and raising a glowing golden holy symbol in the other'],
  goblin: [FANTASY, 'a small, wiry green-skinned goblin with big pointed ears, ragged hide clothes, a crude jagged short blade and a tiny wooden buckler'],
  troll: [FANTASY, 'a hulking cave troll with mossy grey-green hide, long arms, a hunched back and a heavy stone-headed club'],
  ogre: [FANTASY, 'a huge fat ogre with tan skin, tusks, a patchwork hide loincloth and iron shoulder plate, hefting a massive spiked tree-trunk club'],
  dragon: [FANTASY, 'a mighty dragon with bronze-and-charcoal scales, wings fully spread to both sides, long tail curling behind, head lowered with smoke curling from its jaws'],
  spider: [FANTASY, 'a giant hairy cave spider with a dark brown and black body, eight long legs spread wide, many glinting eyes and dripping fangs'],
  bat: [FANTASY, 'a tight swarm of five large dark cave bats flying together, leathery wings spread'],
  worm: [FANTASY, 'a giant rock worm bursting out of a small mound of broken stones, its ringed, armoured tan hide rearing up and its round maw open showing rings of bone teeth'],
  catapult: [FANTASY, 'a wooden siege catapult on four wheels with iron fittings and rope windings, its throwing arm drawn back with a boulder in the cup, no crew'],
  marine: [SCIFI, 'a colonial infantry trooper in a slim sealed environment suit of off-white and grey composite plates over dark fabric, a smooth rounded helmet with a wide amber visor, a compact backpack, holding a short carbine; plain armour with no emblems or insignia'],
  sniper: [SCIFI, 'a sniper in a sand-coloured hooded camouflage cloak over light armour, kneeling and aiming a very long-barrelled rifle'],
  drone: [SCIFI, 'a small hovering combat drone with four rotor pods, a rounded gunmetal body, a single glowing teal sensor eye and a gun slung underneath'],
  mech: [SCIFI, 'a heavy two-legged combat walker mech with a boxy armoured gunmetal hull, thick legs, a cannon on one arm and a glowing teal cockpit slit'],
  stalker: [SCIFI, 'a lean six-legged alien hunter like a cross between a mantis and a panther, with mottled teal-and-rust chitin plates, two hooked forelimbs raised to strike, a short forked tail and a broad flat head with a cluster of six small amber eyes, prowling low'],
  spitter: [SCIFI, 'a bloated alien creature with dark chitin plates and glowing yellow-green acid sacs along its back, its mouth open spitting a glob of acid'],
  brute: [SCIFI, 'a massive hulking alien beast with thick dark chitin armour, huge fists like battering rams, small head sunk between its shoulders and glowing teal eyes'],
};

const prompt = (cls) => {
  const [game, what] = UNITS[cls];
  const task = `Use your built-in image generation tool to generate exactly one image, then save it as ${RAW}/${cls}${SUFFIX}.png in this repository. `
    + 'Do not modify any other file, do not run any other image generation, and do not commit anything. Image prompt: ';
  // A portrait has to read when it is 40 pixels across: one big head (or the front of a beast or
  // machine), bold shapes, strong light.
  if (PORTRAITS) return task
    + `A close-up character portrait for a round game token in ${game}. The subject: ${what}. Show only the head and shoulders `
    + '(for a beast, swarm or machine: its head or its most recognisable front part, very close up), in three-quarter view looking toward the right, '
    + 'large in the frame so the head fills most of the picture and the shoulders run off the bottom edge. Painterly hand-painted digital style '
    + 'with bold simple shapes, dark brown outlines, strong light from the top-left, bright highlights and high contrast, so it stays readable when '
    + 'shrunk very small. Rich natural colours, but no saturated blue or red clothing, plumes or trim (team colours are added by the game), and no magenta or pink anywhere on the subject. Isolated on a perfectly flat, uniform, solid '
    + 'magenta (#FF00FF) background: no frame, no ring, no border, no scenery, no text. Square 1:1.';
  return task
    + `A single unit sprite for ${game}: ${what}. Seen from a high three-quarter top-down angle (the classic tactical RPG view), `
    + 'the whole figure visible from head to foot, facing toward the right. Painterly hand-painted digital style with dark brown outlines, '
    + 'a crisp readable silhouette, lit from the top-left with warm highlights and cool shadows. Muted natural palette: no saturated pure '
    + 'blue or pure red clothing, and no magenta or pink anywhere on the subject. Centred and filling about 80% of the frame, isolated on a '
    + 'perfectly flat, uniform, solid magenta (#FF00FF) background: no ground, no cast shadow, no base, no scenery, no text, no border. Square 1:1.';
};

const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32', ...opts });
  p.on('close', (code) => resolve(code));
  p.on('error', () => resolve(-1));
});

async function make(cls) {
  const raw = `${RAW}/${cls}${SUFFIX}.png`;
  const code = await run('codex', ['exec', '-s', 'workspace-write', '-C', '.', JSON.stringify(prompt(cls))], { stdio: ['ignore', 'ignore', 'ignore'] });
  if (!existsSync(join(ROOT, raw))) { console.log(`${cls}: no image (codex exit ${code})`); return false; }
  const cut = await run('python', ['tools/tokens/cutout.py', raw, `${OUT}/${cls}.webp`]);
  console.log(`${cls}: ${cut === 0 ? 'done' : 'cut-out failed'}`);
  return cut === 0;
}

const asked = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const bad = asked.filter((c) => !UNITS[c]);
if (bad.length) { console.error('unknown class:', bad.join(', ')); process.exit(1); }
const todo = asked.length ? asked : Object.keys(UNITS).filter((c) => !existsSync(join(ROOT, OUT, `${c}.webp`)));
mkdirSync(join(ROOT, RAW), { recursive: true });
mkdirSync(join(ROOT, OUT), { recursive: true });
console.log(todo.length ? `generating: ${todo.join(', ')}` : 'nothing to do');
const queue = todo.slice();
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await make(queue.shift()); }));
