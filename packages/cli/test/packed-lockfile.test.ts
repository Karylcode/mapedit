import { expect, it } from 'vitest';
import { packedLockfile } from '../../../scripts/packed-lockfile.mjs';

function fixture() {
  const lock = {
    lockfileVersion: '9.0',
    settings: { autoInstallPeers: true, excludeLinksFromLockfile: false },
    importers: {
      'packages/protocol': {},
      'packages/server': {
        dependencies: {
          '@mapedit/protocol': { specifier: 'workspace:*', version: 'link:../protocol' },
          sdk: { specifier: '^1.0.0', version: '1.0.0(zod@4.0.0)' },
        },
        optionalDependencies: { legacy: { specifier: '^2.0.0', version: '2.0.0' } },
      },
    },
    packages: {
      'sdk@1.0.0': { resolution: { integrity: 'sha512-sdk' }, peerDependencies: { zod: '^4' } },
      'zod@4.0.0': { resolution: { integrity: 'sha512-zod' } },
      'hono@4.13.12': { resolution: { integrity: 'sha512-locked-hono' } },
      'hono@3.0.0': { resolution: { integrity: 'sha512-legacy-hono' } },
      'legacy@2.0.0': { resolution: { integrity: 'sha512-legacy' }, os: ['linux'] },
    },
    snapshots: {
      'sdk@1.0.0(zod@4.0.0)': { dependencies: { hono: '4.13.12', zod: '4.0.0' } },
      'zod@4.0.0': {},
      'hono@4.13.12': {},
      'hono@3.0.0': {},
      'legacy@2.0.0': { dependencies: { hono: '3.0.0' }, optional: true },
    },
  };
  const packages = [
    {
      importer: 'packages/protocol',
      manifest: { name: '@mapedit/protocol', version: '0.1.0', dependencies: {} },
      packed: { name: '@mapedit/protocol', version: '0.1.0', dependencies: {} },
      specifier: 'file:../artifacts/protocol.tgz',
      integrity: 'sha512-real-protocol',
    },
    {
      importer: 'packages/server',
      manifest: {
        name: '@mapedit/server',
        version: '0.1.0',
        dependencies: { '@mapedit/protocol': 'workspace:*', sdk: '^1.0.0' },
        optionalDependencies: { legacy: '^2.0.0' },
      },
      packed: {
        name: '@mapedit/server',
        version: '0.1.0',
        dependencies: { '@mapedit/protocol': '0.1.0', sdk: '^1.0.0' },
        optionalDependencies: { legacy: '^2.0.0' },
      },
      specifier: 'file:../artifacts/server.tgz',
      integrity: 'sha512-real-server',
    },
  ];
  return { lock, packages };
}

it('preserves locked transitive versions, peers and optional variants instead of resolving ranges', () => {
  const { lock, packages } = fixture();
  const before = structuredClone(lock);
  const consumer = packedLockfile(lock, packages);
  for (const [key, value] of Object.entries(lock.packages))
    expect(consumer.packages[key]).toEqual(value);
  for (const [key, value] of Object.entries(lock.snapshots))
    expect(consumer.snapshots[key]).toEqual(value);
  expect(consumer.snapshots['@mapedit/server@file:../artifacts/server.tgz']).toEqual({
    dependencies: {
      '@mapedit/protocol': 'file:../artifacts/protocol.tgz',
      sdk: '1.0.0(zod@4.0.0)',
    },
    optionalDependencies: { legacy: '2.0.0' },
  });
  expect(consumer.packages['@mapedit/server@file:../artifacts/server.tgz']).toEqual({
    resolution: { integrity: 'sha512-real-server', tarball: 'file:../artifacts/server.tgz' },
    version: '0.1.0',
  });
  expect(Object.keys(consumer.importers)).toEqual(['.']);
  expect(lock).toEqual(before);
});

it.each(['missing', 'changed', 'added'] as const)(
  'rejects a packed dependency that is %s instead of hiding it with a synthetic snapshot',
  (change) => {
    const { lock, packages } = fixture();
    const actual = { ...packages[1]!.packed.dependencies };
    if (change === 'missing') delete actual.sdk;
    if (change === 'changed') actual.sdk = '^2.0.0';
    if (change === 'added') Object.assign(actual, { unexpected: '^1.0.0' });
    packages[1]!.packed.dependencies = actual;
    expect(() => packedLockfile(lock, packages)).toThrow(/packed dependencies changed/);
  },
);

it('rejects missing optional declarations and newly added packed peer declarations', () => {
  const { lock, packages } = fixture();
  packages[1]!.packed.optionalDependencies = undefined;
  expect(() => packedLockfile(lock, packages)).toThrow(/packed optionalDependencies changed/);
  const peerFixture = fixture();
  Object.assign(peerFixture.packages[1]!.packed, { peerDependencies: { unexpected: '^1.0.0' } });
  expect(() => packedLockfile(peerFixture.lock, peerFixture.packages)).toThrow(
    /packed peerDependencies changed/,
  );
});

it('rejects a stale repository specifier or workspace link target', () => {
  const { lock, packages } = fixture();
  lock.importers['packages/server'].dependencies.sdk.specifier = '^2.0.0';
  expect(() => packedLockfile(lock, packages)).toThrow(/stale dependency sdk/);
  const linkFixture = fixture();
  linkFixture.lock.importers['packages/server'].dependencies['@mapedit/protocol'].version =
    'link:../other';
  expect(() => packedLockfile(linkFixture.lock, linkFixture.packages)).toThrow(
    /unexpected workspace target/,
  );
});
