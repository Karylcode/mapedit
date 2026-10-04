import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { mockScene } from '../src/mock.js';

it('F24 mock violation messages call Modules modules, not blocks', () => {
  for (const violation of mockScene().violations)
    expect(violation.message, violation.kind).not.toMatch(/\bblocks?\b/i);
});

it('F24 the MCP pager names its pages instead of a vague bound()', async () => {
  const file = 'mcp-paging.ts';
  const text = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const identifiers = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
  expect(identifiers.has('bound')).toBe(false);
  for (const required of ['firstPage', 'nextPage']) expect(identifiers.has(required)).toBe(true);
});
