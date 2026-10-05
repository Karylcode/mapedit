import { describe, expect, it } from 'vitest';
import { overflowVictim } from '../src/editor/hud/toasts.js';

describe('toast overflow (FE19)', () => {
  // Levels are listed newest first, as the toasts are stacked.
  it('drops the oldest info toast before any warning or error', () => {
    expect(overflowVictim(['info', 'info', 'info', 'info', 'warning'])).toBe(3);
    expect(overflowVictim(['info', 'error', 'info', 'warning', 'info'])).toBe(4);
  });

  it('drops a new info toast when only warnings and errors are shown', () => {
    expect(overflowVictim(['info', 'warning', 'error', 'warning', 'error'])).toBe(0);
  });

  it('then drops the oldest warning, and errors last', () => {
    expect(overflowVictim(['warning', 'error', 'warning', 'error', 'error'])).toBe(2);
    expect(overflowVictim(['error', 'error', 'error', 'error', 'error'])).toBe(4);
  });
});

describe('toast overflow by standing (FE28)', () => {
  it('drops file errors, which the issues panel lists anyway, before a lost edit', () => {
    expect(overflowVictim(['listed', 'listed', 'listed', 'listed', 'lostEdit'])).toBe(3);
    expect(overflowVictim(['lostEdit', 'listed', 'listed', 'listed', 'listed'])).toBe(4);
  });

  it('keeps file errors over plain information, but under warnings and errors', () => {
    expect(overflowVictim(['listed', 'info', 'listed', 'warning', 'error'])).toBe(1);
    expect(overflowVictim(['warning', 'listed', 'error', 'warning', 'error'])).toBe(1);
  });

  it('drops a lost edit only when nothing else is left', () => {
    expect(overflowVictim(['lostEdit', 'error', 'lostEdit', 'error', 'error'])).toBe(4);
    expect(overflowVictim(['lostEdit', 'lostEdit', 'lostEdit', 'lostEdit', 'lostEdit'])).toBe(4);
  });
});
