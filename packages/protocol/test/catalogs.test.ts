import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  EDIT_FAILURES,
  NOTICE_CODES,
  VIOLATION_KINDS,
  violationParamsProblems,
} from '../src/index.js';

const protocol = readFileSync(new URL('../../../docs/protocol.md', import.meta.url), 'utf8');
/** The string members of a `type Name = | 'a' | 'b';` union in docs/protocol.md, in order. */
function documentedUnion(name: string): string[] {
  const block = protocol.split(`type ${name} =`)[1]?.split(';')[0] ?? '';
  return [...block.matchAll(/\|\s*'([a-z_]+)'/g)].map((match) => match[1]!);
}

it('exports the violation kinds and notice codes as runtime catalogs', () => {
  expect(VIOLATION_KINDS).toEqual([
    'overlap',
    'incompatible_socket',
    'unsupported',
    'off_grid',
    'bad_rotation',
    'out_of_bounds',
    'missing_reference',
  ]);
  // Every kind has a params table entry, so none is reported as unknown.
  for (const kind of VIOLATION_KINDS)
    expect(
      violationParamsProblems({ id: 'x', kind, message: 'm', refs: [], params: {} }),
    ).not.toContain(`Unknown violation kind "${kind}".`);
});

it('keeps every catalog identical to its union in docs/protocol.md', () => {
  expect(VIOLATION_KINDS).toEqual(documentedUnion('ViolationKind'));
  expect(NOTICE_CODES).toEqual(documentedUnion('NoticeCode'));
  expect(EDIT_FAILURES).toEqual(documentedUnion('EditFailure'));
  expect(NOTICE_CODES).toContain('unknown_map');
});
