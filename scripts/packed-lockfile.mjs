import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { posix } from 'node:path';

/** Read the manifest from the actual pnpm pack artifact, without unpacking code into the repo. */
export function packedManifest(tarball) {
  const archive = gunzipSync(tarball);
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    if (!name) break;
    const size = Number.parseInt(
      header.toString('ascii', 124, 136).replace(/\0.*$/s, '').trim(),
      8,
    );
    assert(Number.isSafeInteger(size) && size >= 0, 'Invalid packed tar entry size.');
    const start = offset + 512;
    assert(start + size <= archive.length, 'Truncated packed tar entry.');
    if (name === 'package/package.json')
      return JSON.parse(archive.toString('utf8', start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw new Error('Packed artifact has no package/package.json.');
}

/** Preserve the repository's exact external graph; replace only workspace roots with real tarballs. */
export function packedLockfile(repositoryLock, packages) {
  assert.equal(
    repositoryLock.lockfileVersion,
    '9.0',
    'Review packaging for a new pnpm lock format.',
  );
  const lock = structuredClone(repositoryLock);
  const byName = new Map(packages.map((item) => [item.manifest.name, item]));
  lock.importers = { '.': { dependencies: {} } };
  lock.overrides = { ...repositoryLock.overrides };
  for (const item of packages) lock.overrides[item.manifest.name] = item.specifier;
  for (const { importer, manifest, packed, specifier, integrity } of packages) {
    const source = repositoryLock.importers[importer];
    assert(source, `Missing locked importer: ${importer}`);
    assert.equal(packed.name, manifest.name, 'Packed package name differs from its source.');
    assert.equal(
      packed.version,
      manifest.version,
      'Packed package version differs from its source.',
    );
    const snapshot = {};
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      const declared = manifest[field] ?? {};
      const expected = Object.fromEntries(
        Object.entries(declared).map(([name, range]) => {
          if (!range.startsWith('workspace:')) return [name, range];
          const dependency = byName.get(name);
          assert(dependency, `Workspace dependency ${name} is not packed.`);
          assert.equal(range, 'workspace:*', `Unsupported packed workspace range: ${range}`);
          return [name, dependency.manifest.version];
        }),
      );
      assert.deepEqual(packed[field] ?? {}, expected, `${manifest.name}: packed ${field} changed.`);
      if (field === 'peerDependencies') {
        assert.equal(
          Object.keys(declared).length,
          0,
          'Direct workspace peers need an explicit lock projection.',
        );
        continue;
      }
      const locked = source[field] ?? {};
      assert.deepEqual(
        Object.keys(locked).sort(),
        Object.keys(declared).sort(),
        `${importer}: stale ${field}.`,
      );
      for (const [name, range] of Object.entries(declared)) {
        const edge = locked[name];
        assert.equal(edge.specifier, range, `${importer}: stale dependency ${name}.`);
        const dependency = byName.get(name);
        if (dependency)
          assert.equal(
            edge.version,
            `link:${posix.relative(importer, dependency.importer)}`,
            `${importer}: unexpected workspace target for ${name}.`,
          );
        else
          assert(
            repositoryLock.snapshots[`${name}@${edge.version}`],
            `Missing locked snapshot for ${name}@${edge.version}.`,
          );
        (snapshot[field] ??= {})[name] = dependency?.specifier ?? edge.version;
      }
    }
    const key = `${manifest.name}@${specifier}`;
    const metadata = {
      resolution: { integrity, tarball: specifier },
      version: packed.version,
      ...(packed.bin ? { hasBin: true } : {}),
    };
    for (const field of ['engines', 'os', 'cpu', 'libc'])
      if (packed[field]) metadata[field] = packed[field];
    lock.packages[key] = metadata;
    lock.snapshots[key] = snapshot;
    lock.importers['.'].dependencies[manifest.name] = { specifier, version: specifier };
  }
  return lock;
}
