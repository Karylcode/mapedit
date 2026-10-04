import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { findBrowser } from '../src/screenshot.js';

const executablePath = await findBrowser();
it.skipIf(!executablePath)(
  'executes public core modelling, GLB, PNG and compilation APIs in a real browser',
  async () => {
    const coreDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../core');
    const bundle = await build({
      stdin: {
        contents: `import {box,buildModel,modelToGlb,createTerrain,encodeTerrain,decodeTerrain,parseProject,compileMap,checkGeometry} from ${JSON.stringify(resolve(coreDirectory, 'src/index.ts'))};
        globalThis.runCore = async () => {
          const geometry=await buildModel(box([2,2,2]));
          const glb=await modelToGlb(geometry);
          const encoded=encodeTerrain(createTerrain(100,100,1.5));
          const decoded=decodeTerrain(encoded.height,encoded.surface);
          const parsed=parseProject({'project.yaml':'name: Browser','modules/block/module.yaml':'id: block\\nsize: [2,2,2]','maps/test/map.yaml':'name: Test\\nsize: {x: 100, z: 100}','maps/test/structures/a.yaml':'structures: [{id: house, position: [10,10], modules: [{id: base, module: block, at: [0,0,0]}]}]'});
          const compiled=compileMap(parsed,'test');
          const checked=await checkGeometry(compiled,new Map([['block',geometry]]));
          return {volume:geometry.volume,magic:Array.from(glb.slice(0,4)),height:decoded.heights[0],errors:compiled.scene.fileErrors,violations:checked.violations};
        };`,
        loader: 'js',
        resolveDir: coreDirectory,
      },
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      external: ['node:*'],
      write: false,
      logLevel: 'silent',
    });
    const wasm = await readFile(resolve(coreDirectory, 'node_modules/manifold-3d/manifold.wasm'));
    const server = createServer((request, response) => {
      if (request.url === '/core.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(bundle.outputFiles[0]!.text);
      } else if (request.url === '/manifold.wasm') {
        response.setHeader('Content-Type', 'application/wasm');
        response.end(wasm);
      } else {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><script type="module" src="/core.js"></script>');
      }
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No browser fixture address.');
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${address.port}`);
      await page.waitForFunction(
        () => typeof (globalThis as unknown as { runCore: unknown }).runCore === 'function',
      );
      const result = await page.evaluate(() =>
        (globalThis as unknown as { runCore: () => Promise<unknown> }).runCore(),
      );
      expect(result).toEqual({
        volume: 8,
        magic: [103, 108, 84, 70],
        height: 1.5,
        errors: [],
        violations: [],
      });
    } finally {
      await browser.close();
      await new Promise<void>((done, error) =>
        server.close((problem) => (problem ? error(problem) : done())),
      );
    }
  },
);
