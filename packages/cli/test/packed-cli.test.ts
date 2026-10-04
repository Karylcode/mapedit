import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

it('F12 initializes and checks packed artifacts offline with a frozen graph and empty registry metadata cache', async () => {
  const script = fileURLToPath(new URL('../../../scripts/test-packed-cli.mjs', import.meta.url));
  const result = await promisify(execFile)(process.execPath, [script], {
    windowsHide: true,
    timeout: 240000,
    maxBuffer: 4 * 1024 * 1024,
  });
  expect(JSON.parse(result.stdout)).toMatchObject({ maps: ['village'], checked: true });
}, 250000);
