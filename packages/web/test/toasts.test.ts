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
