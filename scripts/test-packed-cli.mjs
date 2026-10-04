import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { packedLockfile, packedManifest } from './packed-lockfile.mjs';

// Build-time tooling uses the already installed parser; the consumer resolves only packed packages.
const { parse, stringify } = createRequire(
  new URL('../packages/core/package.json', import.meta.url),
)('yaml');

const execute = promisify(execFile);
const repository = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'mapedit-packed-')));
const artifacts = path.join(temporary, 'artifacts');
const consumer = path.join(temporary, 'consumer');
const project = path.join(temporary, 'project');
const packageFolders = ['protocol', 'core', 'server', 'cli'];
const keep = process.argv.includes('--keep');
const isWithin = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const run = async (executable, args, cwd) => {
  try {
    return await execute(executable, args, {
      cwd,
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(
      `${executable} ${args.join(' ')} failed:\n${error.stdout ?? ''}\n${error.stderr ?? error.message}`,
    );
  }
};
const pnpm = async (args, cwd) => {
  const script = process.env.npm_execpath;
  if (script && /\.[cm]?js$/i.test(script)) return run(process.execPath, [script, ...args], cwd);
  if (process.platform !== 'win32') return run('pnpm', args, cwd);
  // Invoke .cmd launchers through PowerShell's literal argument array, without cmd string interpolation.
  const literals = args.map((arg) => `'${arg.replaceAll("'", "''")}'`).join(', ');
  return run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `& pnpm @(${literals}); exit $LASTEXITCODE`],
    cwd,
  );
};

try {
  assert(!isWithin(repository, temporary), 'Package acceptance must run outside the repository.');
  await mkdir(artifacts);
  await mkdir(consumer);
  const dependencies = {};
  const names = [];
  const packedPackages = [];
  for (const folder of packageFolders) {
    const source = path.join(repository, 'packages', folder);
    const metadata = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
    assert.equal(
      metadata.private,
      true,
      `${metadata.name} stays private until publication is authorized.`,
    );
    const tarball = path.join(artifacts, `${folder}.tgz`);
    await pnpm(['pack', '--out', tarball], source);
    const archive = await readFile(tarball);
    assert.deepEqual([...archive.subarray(0, 2)], [31, 139], `${folder} must be a packed tarball.`);
    names.push(metadata.name);
    dependencies[metadata.name] = `file:../artifacts/${folder}.tgz`;
    packedPackages.push({
      importer: `packages/${folder}`,
      manifest: metadata,
      packed: packedManifest(archive),
      specifier: dependencies[metadata.name],
      integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
    });
  }
  await writeFile(
    path.join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'mapedit-packed-consumer',
        private: true,
        type: 'module',
        dependencies,
      },
      null,
      2,
    ),
  );
  const repositoryLock = parse(await readFile(path.join(repository, 'pnpm-lock.yaml'), 'utf8'));
  const locked = packedLockfile(repositoryLock, packedPackages);
  const lockText = stringify(locked);
  await writeFile(path.join(consumer, 'pnpm-lock.yaml'), lockText);
  await writeFile(
    path.join(consumer, 'pnpm-workspace.yaml'),
    stringify({ overrides: locked.overrides }),
  );
  await writeFile(path.join(consumer, '.npmrc'), 'enable-global-virtual-store=false\n');
  await pnpm(
    [
      'install',
      '--offline',
      '--frozen-lockfile',
      '--ignore-scripts',
      '--cache-dir',
      path.join(temporary, 'registry-cache'),
    ],
    consumer,
  );
  assert.equal(
    await readFile(path.join(consumer, 'pnpm-lock.yaml'), 'utf8'),
    lockText,
    'The isolated installation must not resolve or rewrite the frozen dependency graph.',
  );
  const installed = {};
  for (const name of names) {
    const packageRoot = await realpath(path.join(consumer, 'node_modules', name));
    assert(
      isWithin(consumer, packageRoot),
      `${name} must resolve inside the isolated consumer: ${packageRoot}`,
    );
    assert(!isWithin(repository, packageRoot), `${name} must not link into the repository.`);
    installed[name] = path.join(packageRoot, 'dist/index.js');
  }
  const cli = installed.mapedit;
  await run(process.execPath, [cli, 'init', project], consumer);
  for (const name of names) {
    const entry = await realpath(installed[name]);
    const metadata = JSON.parse(
      await readFile(path.resolve(path.dirname(entry), '../package.json'), 'utf8'),
    );
    const resolver = createRequire(entry);
    for (const dependency of Object.keys(metadata.dependencies ?? {}).filter((id) =>
      names.includes(id),
    )) {
      assert(
        isWithin(consumer, await realpath(resolver.resolve(dependency))),
        `${name}'s ${dependency} must resolve in the isolated installation.`,
      );
    }
  }
  const packagedGuide = await readFile(
    path.resolve(path.dirname(cli), '../templates/project/AGENTS.md'),
    'utf8',
  );
  assert.equal(await readFile(path.join(project, 'AGENTS.md'), 'utf8'), packagedGuide);
  const config = JSON.parse(await readFile(path.join(project, '.mcp.stdio.json'), 'utf8'));
  assert.equal(await realpath(config.mcpServers.mapedit.args[0]), cli);
  assert.equal(config.mcpServers.mapedit.command, process.execPath);
  const { stdout } = await run(process.execPath, [cli, 'check', '--json'], project);
  const report = JSON.parse(stdout);
  assert.deepEqual(
    report.maps.map((map) => map.map),
    ['village'],
  );
  assert(report.maps.every((map) => map.violations.length === 0 && map.fileErrors.length === 0));
  process.stdout.write(
    `${JSON.stringify({ temporary, installed, project, maps: report.maps.map((map) => map.map), checked: true })}\n`,
  );
} finally {
  if (keep) process.stderr.write(`Packed CLI acceptance files retained at ${temporary}\n`);
  else await rm(temporary, { recursive: true, force: true });
}
