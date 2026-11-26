// Painterly map art: each map's own painted backdrop (maps/<name>.jpg, made by "Paint from
// terrain") is handed to the Codex CLI's image tool as a reference and repainted in a richer
// hand-painted style with the layout kept where it is. Needs `codex` signed in and Python with
// Pillow.
//
//   node tools/mapart/generate.mjs                  # every map that has no painterly picture yet
//   node tools/mapart/generate.mjs blackvault kepler
//
// The result goes to maps/painterly/<image>, the same size as the original, and the game uses it
// when the art style is Painterly. Repaint a map's own backdrop first if its terrain has changed.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = 'tools/mapart/raw', OUT = 'maps/painterly';

// What each art style shows, and how to paint it.
const BIOME = {
  meadow: ['green countryside: meadows, woods, hills, rivers, roads, bridges, cottages and stone ruins', 'lush grass with painted variation, leafy tree canopies seen from above, rippling water, thatch and slate roofs, weathered stone, soft afternoon sunlight with gentle shadows'],
  snow: ['snowbound highlands: snowfields, frozen lakes, pine woods, rock ledges and stone ruins', 'drifted snow with blue shadows, cracked glassy ice, dark snow-dusted pines seen from above, cold grey rock, crisp winter light'],
  desert: ['desert: dunes, mesas, oases, wells and sandstone ruins', 'wind-rippled golden sand, layered red sandstone cliffs, turquoise pools ringed with palms seen from above, sun-bleached stonework, hot hard light with deep shadows'],
  alien: ['an alien world: strange coloured ground, crystal and fungus growths, pools, rock and prefabricated human outpost buildings', 'otherworldly ground textures, luminous alien plants and crystals, glowing pools, panelled metal roofs with lights, eerie coloured light'],
  cave: ['underground caverns: cave floors and tunnels inside solid dark rock, with pools, fungus, stalagmites, rubble and in places lava', 'rough natural cave floors, wet glistening rock, glowing fungus, deep still water, molten lava with bright cracks where present, darkness in the solid rock with warm and cold pools of light'],
  dungeon: ['a stone dungeon: flagstone rooms and corridors inside solid dark rock, with torches, pools, rubble, pillars and in places lava', 'detailed worn flagstones, carved stone wall edges with depth shading, warm torchlight against cool shadows, deep still water, molten lava with bright cracks where present, darkness in the solid rock'],
};

const prompt = (name, biome) => {
  const [what, how] = BIOME[biome] || BIOME.meadow;
  return `The attached image (${RAW}/${name}.ref.png) is a top-down battle map for a hex-grid tactics game, showing ${what}. It may have black bars along two edges. `
    + `Use your built-in image generation tool, with the attached image as the reference input, to repaint it exactly once as a rich painterly hand-painted fantasy battle map, and save the result as ${RAW}/${name}.out.png. `
    + 'Do not modify any other file, do not generate more than one image, and do not commit anything. Requirements for the repaint: keep the exact same strictly top-down (orthographic, straight overhead) view, '
    + 'the same landscape 3:2 framing including the black bars, and the exact same layout: every feature in the reference (each wall, building, tree clump, rock, cliff, road, river, pool, bridge, ruin and open area) must stay in precisely the same position, size and shape, '
    + `because game rules are tied to those positions. Only change the rendering: ${how}, in the style of a hand-painted tabletop RPG battle map. `
    + 'Do not add a hex grid, characters, creatures, text, numbers, labels, UI or a border, and do not add, remove or move any feature.';
};

const run = (cmd, args, stdio = ['ignore', 'ignore', 'inherit']) => new Promise((resolve) => {
  const p = spawn(cmd, args, { cwd: ROOT, stdio, shell: process.platform === 'win32' });
  p.on('close', (code) => resolve(code));
  p.on('error', () => resolve(-1));
});
const q = (s) => JSON.stringify(s);

async function make(name) {
  const data = JSON.parse(readFileSync(join(ROOT, 'maps', `${name}.json`), 'utf8'));
  const image = data.backdrop?.image;
  if (!image) { console.log(`${name}: no backdrop image to repaint`); return; }
  const ref = `${RAW}/${name}.ref.png`, out = `${RAW}/${name}.out.png`;
  rmSync(join(ROOT, out), { force: true });
  if (await run('python', ['tools/mapart/frame.py', 'ref', `maps/${image}`, ref])) { console.log(`${name}: could not read maps/${image}`); return; }
  const code = await run('codex', ['exec', '-s', 'workspace-write', '-C', '.', '-i', ref, '--', q(prompt(name, data.biome))], ['ignore', 'ignore', 'ignore']);
  if (!existsSync(join(ROOT, out))) { console.log(`${name}: no image (codex exit ${code})`); return; }
  const done = await run('python', ['tools/mapart/frame.py', 'finish', `maps/${image}`, out, `${OUT}/${image.replace(/\.\w+$/, '.jpg')}`]);
  console.log(`${name}: ${done === 0 ? 'done' : 'could not finish the picture'}`);
}

const all = readdirSync(join(ROOT, 'maps')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const asked = process.argv.slice(2);
const bad = asked.filter((n) => !all.includes(n));
if (bad.length) { console.error('no such map:', bad.join(', ')); process.exit(1); }
const todo = asked.length ? asked : all.filter((n) => !existsSync(join(ROOT, OUT, `${n}.jpg`)));
mkdirSync(join(ROOT, RAW), { recursive: true });
mkdirSync(join(ROOT, OUT), { recursive: true });
console.log(todo.length ? `repainting: ${todo.join(', ')}` : 'nothing to do');
const queue = todo.slice();
await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) await make(queue.shift()); }));
