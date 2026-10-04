import { expect, it } from 'vitest';
import { NOTICE_CODES, VIOLATION_KINDS, violationParamsProblems } from '../src/index.js';

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
  expect(NOTICE_CODES).toHaveLength(5);
  // Every kind has a params table entry, so none is reported as unknown.
  for (const kind of VIOLATION_KINDS)
    expect(
      violationParamsProblems({ id: 'x', kind, message: 'm', refs: [], params: {} }),
    ).not.toContain(`Unknown violation kind "${kind}".`);
});
