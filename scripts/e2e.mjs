import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTerrain, applyTerrainCommand, encodeTerrain } from '../packages/core/dist/index.js';

const cli = fileURLToPath(new URL('../packages/cli/dist/index.js', import.meta.url));
const root = path.resolve(
  process.argv[2] ?? (await mkdtemp(path.join(tmpdir(), 'mapedit-village-'))),
);
const run = (args, cwd = root) => {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
  });
  if (result.status !== 0)
    throw new Error(`mapedit ${args.join(' ')} failed:\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
};
await mkdir(root, { recursive: true });
run(['init', root]);
const house = await readFile(path.join(root, 'maps/village/structures/house.yaml'), 'utf8');
await rm(path.join(root, 'maps/village/structures/house.yaml'));
for (const [id, x, z, rotation] of [
  ['house_west', 20, 20, 0],
  ['house_centre', 40, 20, 15],
  ['house_east', 60, 20, 30],
]) {
  await writeFile(
    path.join(root, `maps/village/structures/${id}.yaml`),
    house
      .replace('id: house', `id: ${id}`)
      .replace('position: [20, 20]', `position: [${x}, ${z}]`)
      .replace('rotation: 0', `rotation: ${rotation}`),
  );
}
let terrain = createTerrain(100, 100);
terrain = applyTerrainCommand(terrain, {
  operation: 'mountain',
  height: 6,
  region: { kind: 'circle', center: [80, 70], radius: 12 },
});
terrain = applyTerrainCommand(terrain, {
  operation: 'paint',
  surface: 'gravel',
  region: {
    kind: 'path',
    points: [
      [22, 28],
      [42, 28],
      [62, 28],
    ],
    width: 3,
  },
});
const png = encodeTerrain(terrain);
await writeFile(path.join(root, 'maps/village/terrain/height.png'), png.height);
await writeFile(path.join(root, 'maps/village/terrain/surface.png'), png.surface);
const checked = JSON.parse(run(['check', '--json']));
if (checked.violations.length || checked.fileErrors.length)
  throw new Error('Village check did not reach zero violations.');
const out = path.join(root, 'export');
run(['export', '--out', out]);
const glb = await readFile(path.join(out, 'village.glb'));
if (glb.toString('ascii', 0, 4) !== 'glTF' || glb.readUInt32LE(4) !== 2)
  throw new Error('Export is not a glTF 2.0 GLB.');
const json = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)).trim());
const kinds = json.nodes.map((n) => n.extras?.mapedit?.kind);
if (
  kinds.filter((k) => k === 'structure').length !== 3 ||
  !kinds.includes('terrain') ||
  kinds.filter((k) => k === 'marker').length !== 2
)
  throw new Error('Export hierarchy/extras are incomplete.');
console.log(
  JSON.stringify({
    project: root,
    violations: 0,
    fileErrors: 0,
    structures: 3,
    modules: 24,
    glb: path.join(out, 'village.glb'),
    bytes: glb.length,
  }),
);
