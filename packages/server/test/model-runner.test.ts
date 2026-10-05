import { describe, expect, it } from 'vitest';
import { runModel, loadBuiltinTextures } from '../src/model-runner.js';
import { modelToGlb } from '@mapedit/core';

describe('isolated model execution', () => {
  it('compiles TypeScript in a restricted child and returns real geometry', async () => {
    const geometry = await runModel(
      `import {box,material} from '@mapedit/model'; const size:[number,number,number]=[2,2,2]; export default () => material('wood_planks',box(size));`,
      { size: [2, 2, 2] },
    );
    expect(geometry.volume).toBeCloseTo(8);
    expect(geometry.primitives[0]!.material).toBe('wood_planks');
    const textures = await loadBuiltinTextures();
    expect(Object.keys(textures)).toHaveLength(9);
    const glb = await modelToGlb(geometry, { textures });
    expect(glb.length).toBeGreaterThan(textures['wood_planks.jpg']!.length);
  });
  it('does not expose Node, filesystem, network, or process escape paths', async () => {
    for (const expression of [
      `process.env`,
      `fetch('https://example.com')`,
      `Function('return process')()`,
      `require('node:fs')`,
    ]) {
      await expect(
        runModel(`export default ${expression};`, { size: [2, 2, 2] }),
      ).rejects.toThrow();
    }
    await expect(
      runModel(`import fs from 'node:fs'; export default fs.readFileSync('secret');`, {
        size: [2, 2, 2],
      }),
    ).rejects.toThrow('forbidden');
    await expect(
      runModel(`import file from './other.ts'; export default file;`, { size: [2, 2, 2] }),
    ).rejects.toThrow('forbidden');
  });
  it('kills infinite loops and validates model dimensions', async () => {
    await expect(
      runModel(`while(true){} export default {};`, { size: [2, 2, 2], timeoutMs: 400 }),
    ).rejects.toThrow(/timed out|interrupted/);
    await expect(
      runModel(`import {box} from '@mapedit/model';export default box([3,2,2]);`, {
        size: [2, 2, 2],
      }),
    ).rejects.toThrow('exceeds');
  });
});
