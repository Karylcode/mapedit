import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

it('F12 installs packed artifacts from the repository store despite an empty consumer default store', async () => {
  const script = fileURLToPath(new URL('../../../scripts/test-packed-cli.mjs', import.meta.url));
  const emptyStore = await mkdtemp(path.join(tmpdir(), 'mapedit-empty-default-store-'));
  try {
    const result = await promisify(execFile)(process.execPath, [script], {
      windowsHide: true,
      timeout: 240000,
      maxBuffer: 4 * 1024 * 1024,
      // Simulates a different default chosen for a consumer on another Windows drive.
      env: { ...process.env, pnpm_config_store_dir: emptyStore },
    });
    expect(JSON.parse(result.stdout)).toMatchObject({ maps: ['village'], checked: true });
  } finally {
    await rm(emptyStore, { recursive: true, force: true });
  }
}, 250000);
