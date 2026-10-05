import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { ProjectHistory } from '../src/history.js';
import { MemoryState, canTriggerMockNotices, type StateStore } from '../src/state.js';

describe('F26 ProjectHistory owns undo and redo', () => {
  it('moves the cursor only after the checkpoint is restored', async () => {
    const history = new ProjectHistory('start');
    history.record({ author: 'agent', summary: 'one', files: ['a.yaml'] }, 'one');
    history.record({ author: 'human', summary: 'two', files: ['b.yaml'] }, 'two');
    const restored: string[] = [];
    expect(await history.travel(-1, (snapshot) => void restored.push(snapshot))).toBeUndefined();
    expect(history.cursor).toBe(1);
    await expect(
      history.travel(-1, () => {
        throw new Error('disk full');
      }),
    ).rejects.toThrow('disk full');
    expect(history.cursor).toBe(1);
    expect(await history.travel(-1, (snapshot) => void restored.push(snapshot))).toBeUndefined();
    expect(await history.travel(-1, () => {})).toEqual({
      reason: 'Nothing to undo.',
      failure: 'nothing_to_undo',
    });
    expect(await history.travel(1, (snapshot) => void restored.push(snapshot))).toBeUndefined();
    expect(restored).toEqual(['one', 'start', 'one']);
    expect(history.cursor).toBe(1);
  });

  it('does not let callers move the cursor directly', () => {
    const history = new ProjectHistory('start');
    expect(() => {
      (history as unknown as { cursor: number }).cursor = 5;
    }).toThrow(TypeError);
    expect(history.cursor).toBe(0);
  });
});

describe('F26 mock notices are a mock-only capability', () => {
  it('keeps triggerMockNotice out of the shared StateStore interface', async () => {
    const file = new URL('../src/state.ts', import.meta.url);
    const source = ts.createSourceFile(
      'state.ts',
      await readFile(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const members: string[] = [];
    source.forEachChild((node) => {
      if (ts.isInterfaceDeclaration(node) && node.name.text === 'StateStore')
        for (const member of node.members) members.push(member.name?.getText(source) ?? '');
    });
    expect(members).toContain('preview');
    expect(members).not.toContain('triggerMockNotice');
  });

  it('F37 exposes history entries and cursor read-only on StateStore', async () => {
    const file = new URL('../src/state.ts', import.meta.url);
    const source = ts.createSourceFile(
      'state.ts',
      await readFile(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const readonly = new Map<string, boolean>();
    source.forEachChild((node) => {
      if (ts.isInterfaceDeclaration(node) && node.name.text === 'StateStore')
        for (const member of node.members)
          readonly.set(
            member.name?.getText(source) ?? '',
            ts.isPropertySignature(member) &&
              (member.modifiers ?? []).some(
                (modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
              ),
          );
    });
    expect(readonly.get('cursor')).toBe(true);
    expect(readonly.get('entries')).toBe(true);
  });

  it('detects the capability on the mock state only', () => {
    expect(canTriggerMockNotices(new MemoryState())).toBe(true);
    const plain = { ...new MemoryState(), triggerMockNotice: undefined } as unknown as StateStore;
    expect(canTriggerMockNotices(plain)).toBe(false);
  });
});
