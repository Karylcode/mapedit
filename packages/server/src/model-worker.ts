import { readFileSync } from 'node:fs';
import { getQuickJS } from 'quickjs-emscripten';
import { buildModel, type Shape } from '@mapedit/core';
import type { ModelWorkerRequest, ModelWorkerResponse } from './worker-request.js';

/** Trusted child entry point. Model JavaScript only runs inside the isolated QuickJS VM. */
async function run(request: ModelWorkerRequest): Promise<ModelWorkerResponse> {
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(32 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + request.timeoutMs;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const context = runtime.newContext();
  let shape: Shape;
  try {
    const result = context.evalCode(
      request.code +
        '\n;JSON.stringify(typeof mapeditModel.default === "function" ? mapeditModel.default() : mapeditModel.default)',
      'model.ts',
    );
    if (result.error) {
      const problem: unknown = context.dump(result.error);
      result.error.dispose();
      const message =
        typeof problem === 'object' && problem !== null && 'message' in problem
          ? String(problem.message)
          : String(problem);
      throw new Error(message);
    }
    const json = context.getString(result.value);
    result.value.dispose();
    if (json.length > 4 * 1024 * 1024) throw new Error('Model recipe exceeds 4 MiB.');
    // buildModel validates the untrusted recipe before constructing any solids.
    shape = JSON.parse(json) as Shape;
  } finally {
    context.dispose();
    runtime.dispose();
  }
  return { ok: true, geometry: await buildModel(shape, request.size, request.material) };
}

let response: ModelWorkerResponse;
try {
  response = await run(JSON.parse(readFileSync(0, 'utf8')) as ModelWorkerRequest);
} catch (error) {
  response = { ok: false, error: error instanceof Error ? error.message : String(error) };
  process.exitCode = 1;
}
process.stdout.write(JSON.stringify(response));
