import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.skipIf(process.platform !== 'win32')(
  'F14 updates the Unity manifest with Windows PowerShell 5.1',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mapedit-unity-script-'));
    temporary.push(root);
    await mkdir(path.join(root, 'ProjectSettings'));
    await mkdir(path.join(root, 'Packages'));
    await writeFile(
      path.join(root, 'ProjectSettings/ProjectVersion.txt'),
      'm_EditorVersion: 6000.0.75f1',
    );
    const manifestPath = path.join(root, 'Packages/manifest.json');
    await writeFile(
      manifestPath,
      JSON.stringify({
        dependencies: { 'com.example.keep': '1.2.3' },
        preservedLabel: '保留中文',
        scopedRegistries: [
          { name: 'Preserve', url: 'https://example.test', scopes: ['com.example'] },
        ],
      }),
    );
    const glbPath = path.join(root, 'input.glb');
    await writeFile(glbPath, 'fixture');
    const harness = path.join(root, 'run.ps1');
    // Only Unity is simulated. The complete production script and the real 5.1 JSON
    // cmdlets run unchanged; no Unity installation or license is needed in CI.
    await writeFile(
      harness,
      `param([string]$ScriptPath, [string]$FixturePath, [string]$NodePath)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ne 5) { throw 'Expected Windows PowerShell 5.1' }
function Start-Process {
  param($FilePath, $ArgumentList, [switch]$PassThru, $WindowStyle)
  if ($WindowStyle -ne 'Hidden') { throw 'Unity must run hidden' }
  '{"simulatedUnity":true}' | Set-Content -LiteralPath (Join-Path $FixturePath 'mapedit-verification.json')
  $process = [pscustomobject]@{ ExitCode = 0 }
  $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($timeout) return $true }
  return $process
}
& $ScriptPath -GlbPath (Join-Path $FixturePath 'input.glb') -ProjectPath $FixturePath -UnityPath $NodePath
`,
    );
    const scriptPath = fileURLToPath(new URL('../../../scripts/test-unity.ps1', import.meta.url));
    const powershell = path.join(
      process.env.WINDIR ?? 'C:/Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    );
    const result = await promisify(execFile)(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        harness,
        '-ScriptPath',
        scriptPath,
        '-FixturePath',
        root,
        '-NodePath',
        process.execPath,
      ],
      { windowsHide: true, timeout: 15000 },
    );
    expect(JSON.parse(result.stdout)).toEqual({ simulatedUnity: true });
    const manifest = JSON.parse((await readFile(manifestPath, 'utf8')).replace(/^\uFEFF/, ''));
    expect(manifest.dependencies).toMatchObject({
      'com.example.keep': '1.2.3',
      'org.khronos.unitygltf': 'https://github.com/KhronosGroup/UnityGLTF.git#release/2.21.0',
      'com.unity.shadergraph': '17.0.4',
      'com.mapedit.unity': expect.stringMatching(/^file:.*integrations\/unity$/),
    });
    expect(manifest.scopedRegistries).toEqual([
      { name: 'Preserve', url: 'https://example.test', scopes: ['com.example'] },
    ]);
    expect(manifest.preservedLabel).toBe('保留中文');
  },
);
