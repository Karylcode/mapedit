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

async function identifiersOf(file: string): Promise<Set<string>> {
  const text = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const identifiers = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return identifiers;
}

it('F24 geometry and compiler identifiers avoid vague or aliased names', async () => {
  const suggestions = await identifiersOf('geometry-suggestions.ts');
  for (const avoided of ['groups', 'Candidate', 'candidate', 'AdviceSolid'])
    expect(suggestions.has(avoided), avoided).toBe(false);
  expect(suggestions.has('solidsByStructure')).toBe(true);
  const geometry = await identifiersOf('geometry.ts');
  expect(geometry.has('SolidInstance')).toBe(false);
  // The grid check states its minimum instead of taking an unexplained boolean.
  expect((await identifiersOf('compiler.ts')).has('positive')).toBe(false);
});

it('F24 the map format describes map-space coordinates', async () => {
  const text = await readFile(new URL('../../../docs/map-format.md', import.meta.url), 'utf8');
  expect(text).not.toMatch(/world[- ]space/i);
});
