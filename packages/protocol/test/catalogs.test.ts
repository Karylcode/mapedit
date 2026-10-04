import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  EDIT_FAILURES,
  HISTORY_ACTIONS,
  MISSING_REFERENCE_REASONS,
  NOTICE_CODES,
  OFF_GRID_FIELDS,
  ROTATION_FIELDS,
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

/** The `- \`value\`：…` items listed under a `\`Name\`：` heading in protocol section 3. */
function documentedList(name: string): string[] {
  const block = protocol.split(`\`${name}\`：`)[1]?.split(/\n\n(?!- )/)[0] ?? '';
  return [...block.matchAll(/^- `([a-z_]+)`：/gm)].map((match) => match[1]!);
}

it('F37 derives each params enumeration from one list, as protocol section 3 lists it', () => {
  expect(OFF_GRID_FIELDS).toEqual(documentedList('OffGridField'));
  expect(ROTATION_FIELDS).toEqual(documentedList('RotationField'));
  expect(MISSING_REFERENCE_REASONS).toEqual(documentedList('MissingReferenceReason'));
  const params = (kind: 'off_grid' | 'bad_rotation' | 'missing_reference', value: string) =>
    kind === 'off_grid'
      ? { field: value, values: [1], nearest: [1] }
      : kind === 'bad_rotation'
        ? { field: value, rotation: 7, step: 15, nearest: 0 }
        : { reason: value, reference: 'x' };
  for (const [kind, values] of [
    ['off_grid', OFF_GRID_FIELDS],
    ['bad_rotation', ROTATION_FIELDS],
    ['missing_reference', MISSING_REFERENCE_REASONS],
  ] as const)
    for (const value of values)
      expect(
        violationParamsProblems({
          id: 'x',
          kind,
          message: 'm',
          refs: [],
          params: params(kind, value),
        }),
        `${kind} ${value}`,
      ).toEqual([]);
});

it('keeps every catalog identical to its union in docs/protocol.md', () => {
  expect(VIOLATION_KINDS).toEqual(documentedUnion('ViolationKind'));
  expect(NOTICE_CODES).toEqual(documentedUnion('NoticeCode'));
  expect(EDIT_FAILURES).toEqual(documentedUnion('EditFailure'));
  expect(HISTORY_ACTIONS).toEqual(documentedUnion('HistoryAction'));
  expect(NOTICE_CODES).toContain('unknown_map');
});
