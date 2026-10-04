import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

it('F10 compiler identifiers use Socket and map-coordinate terminology', async () => {
  const text = await readFile(new URL('../src/compiler.ts', import.meta.url), 'utf8');
  const source = ts.createSourceFile('compiler.ts', text, ts.ScriptTarget.Latest, true);
  const identifiers = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const avoided of ['SocketAnchor', 'targetAnchor', 'localAnchor', 'world'])
    expect(identifiers.has(avoided), avoided).toBe(false);
  for (const required of ['PlacedSocket', 'targetSocket', 'localSocket'])
    expect(identifiers.has(required), required).toBe(true);
});
