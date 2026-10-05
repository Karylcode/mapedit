import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { BUILTIN_MATERIALS, type ModelGeometry } from '@mapedit/core';
import type { Vec3 } from '@mapedit/protocol';
import type { ModelWorkerRequest, ModelWorkerResponse } from './worker-request.js';

export interface ModelRunOptions {
  size: Vec3;
  material?: string;
  timeoutMs?: number;
}

/** Compile only the public modelling API, then evaluate untrusted code in a disposable VM and process. */
export async function runModel(source: string, options: ModelRunOptions): Promise<ModelGeometry> {
  if (source.length > 1024 * 1024) throw new Error('model.ts exceeds the 1 MiB source limit.');
  const coreEntry = fileURLToPath(import.meta.resolve('@mapedit/core'));
  const apiPath = resolve(dirname(coreEntry), 'model-api.js');
  const apiSource = await readFile(apiPath, 'utf8');
  const bundle = await build({
    stdin: { contents: source, loader: 'ts', sourcefile: 'model.ts' },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'mapeditModel',
    target: 'es2022',
    platform: 'neutral',
    logLevel: 'silent',
    plugins: [
      {
        name: 'model-only-imports',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) =>
            args.path === '@mapedit/model'
              ? { path: args.path, namespace: 'model-api' }
              : {
                  errors: [
                    {
                      text: `Import '${args.path}' is forbidden. model.ts can only import @mapedit/model.`,
                    },
                  ],
                },
          );
          builder.onLoad({ filter: /.*/, namespace: 'model-api' }, () => ({
            contents: apiSource,
            loader: 'js',
          }));
        },
      },
    ],
  });
  const quickjsEntry = fileURLToPath(import.meta.resolve('quickjs-emscripten'));
  const protocolEntry = fileURLToPath(import.meta.resolve('@mapedit/protocol'));
  // Package exports resolve dist both in source-driven tests and installed packages.
  const workerPath = resolve(
    dirname(fileURLToPath(import.meta.resolve('@mapedit/server'))),
    'model-worker.js',
  );
  // pnpm links dependencies into .pnpm; allow reads only under installed package roots.
  const readRoots = new Set<string>();
  for (const filename of [coreEntry, protocolEntry, quickjsEntry, workerPath]) {
    const canonical = await realpath(filename);
    const parts = canonical.split(/[\\/]/);
    const nodeModules = parts.indexOf('node_modules');
    readRoots.add(
      nodeModules >= 0 ? parts.slice(0, nodeModules + 1).join('/') : dirname(dirname(canonical)),
    );
  }
  readRoots.add(resolve(dirname(coreEntry), '..'));
  const timeoutMs = Math.max(10, Math.min(options.timeoutMs ?? 10000, 30000));
  const args = [
    '--permission',
    '--max-old-space-size=256',
    ...[...readRoots].map((root) => `--allow-fs-read=${root}`),
    workerPath,
  ];
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: parse(coreEntry).root,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { SYSTEMROOT: process.env.SYSTEMROOT, PATH: process.env.PATH },
    });
    let output = '',
      errorOutput = '',
      settled = false;
    const finish = (error?: Error, geometry?: ModelGeometry): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolveResult(geometry!);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`Model execution timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
      if (output.length > 32 * 1024 * 1024) {
        child.kill();
        finish(new Error('Model output exceeds 32 MiB.'));
      }
    });
    child.stderr.on('data', (data: Buffer) => {
      if (errorOutput.length < 8192) errorOutput += data.toString();
    });
    child.on('error', (error) => finish(error));
    child.on('close', () => {
      if (settled) return;
      try {
        const response = JSON.parse(output) as ModelWorkerResponse;
        if (!response.ok) throw new Error(response.error);
        if (!response.geometry) throw new Error('Model execution failed.');
        finish(undefined, response.geometry);
      } catch (error) {
        finish(
          new Error(errorOutput.trim() || (error instanceof Error ? error.message : String(error))),
        );
      }
    });
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') finish(error);
    });
    child.stdin.end(
      JSON.stringify({
        code: bundle.outputFiles[0]!.text,
        size: options.size,
        material: options.material ?? 'white',
        timeoutMs,
      } satisfies ModelWorkerRequest),
    );
  });
}

let texturesPromise: Promise<Record<string, Uint8Array>> | undefined;
export function loadBuiltinTextures(): Promise<Record<string, Uint8Array>> {
  texturesPromise ??= (async () => {
    const coreEntry = fileURLToPath(import.meta.resolve('@mapedit/core'));
    const directory = resolve(dirname(coreEntry), '../materials');
    const entries = await Promise.all(
      [
        ...new Set(
          BUILTIN_MATERIALS.flatMap((material) => (material.texture ? [material.texture] : [])),
        ),
      ].map(
        async (filename) =>
          [filename, new Uint8Array(await readFile(resolve(directory, filename)))] as const,
      ),
    );
    return Object.fromEntries(entries);
  })();
  return texturesPromise;
}
