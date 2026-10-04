import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const workerPath = fileURLToPath(new URL('../dist/model-worker.js', import.meta.url));

function runCompiledWorker(code: string): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--permission', `--allow-fs-read=${projectRoot}`, '--max-old-space-size=256', workerPath],
      { cwd: tmpdir(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '',
      stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Compiled worker timed out.'));
    }, 10000);
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      if (!output && stderr) reject(new Error(stderr));
      else resolve({ status, output });
    });
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') reject(error);
    });
    child.stdin.end(JSON.stringify({ code, size: [2, 2, 2], material: 'red', timeoutMs: 1000 }));
  });
}

describe('F13 compiled model worker', () => {
  it('executes the built worker file from an unrelated working directory under Node permissions', async () => {
    const result = await runCompiledWorker(
      'var mapeditModel = { default: () => ({ op: "box", size: [2, 2, 2] }) };',
    );
    expect(result.status).toBe(0);
    expect(result.output).not.toBe('');
    expect(JSON.parse(result.output)).toMatchObject({
      ok: true,
      geometry: { volume: 8, primitives: [{ material: 'red' }] },
    });
  });

  it('keeps the trusted worker in checked TypeScript instead of an eval bootstrap string', async () => {
    const [runner, worker] = await Promise.all([
      readFile(new URL('../src/model-runner.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/model-worker.ts', import.meta.url), 'utf8'),
    ]);
    expect(runner.includes('--eval')).toBe(false);
    expect(runner.includes('modelWorkerSource')).toBe(false);
    expect(worker.includes('modelWorkerSource')).toBe(false);
  });
});
