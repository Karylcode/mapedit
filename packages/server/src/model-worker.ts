/** Trusted child bootstrap. Model JavaScript only runs inside the isolated QuickJS VM. */
export function modelWorkerSource(coreUrl: string, quickjsUrl: string): string {
  return `
import { readFileSync } from 'node:fs';
import { getQuickJS } from ${JSON.stringify(quickjsUrl)};
import { buildModel } from ${JSON.stringify(coreUrl)};
try {
  const request = JSON.parse(readFileSync(0, 'utf8'));
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(32 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + request.timeoutMs;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const context = runtime.newContext();
  let shape;
  try {
    const result = context.evalCode(request.code + '\\n;JSON.stringify(typeof mapeditModel.default === "function" ? mapeditModel.default() : mapeditModel.default)', 'model.ts');
    if (result.error) {
      const problem = context.dump(result.error);
      result.error.dispose();
      throw new Error(problem.message || String(problem));
    }
    const json = context.getString(result.value);
    result.value.dispose();
    if (json.length > 4 * 1024 * 1024) throw new Error('Model recipe exceeds 4 MiB.');
    shape = JSON.parse(json);
  } finally { context.dispose(); runtime.dispose(); }
  const geometry = await buildModel(shape, request.size, request.material);
  process.stdout.write(JSON.stringify({ok:true,geometry}));
} catch (error) {
  process.stdout.write(JSON.stringify({ok:false,error:error instanceof Error ? error.message : String(error)}));
  process.exitCode = 1;
}
`;
}
