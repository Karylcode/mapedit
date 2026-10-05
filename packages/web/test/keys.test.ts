import { describe, expect, it } from 'vitest';
import { shortcutFor, type KeyPress } from '../src/editor/keys.js';

const press = (init: Partial<KeyPress>): KeyPress => ({
  key: '',
  code: '',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  ...init,
});

describe('shortcutFor', () => {
  it('reads letters from the key, so other layouts undo and redo correctly (FE7)', () => {
    expect(shortcutFor(press({ key: 'z', code: 'KeyY', ctrlKey: true }), false)).toEqual({
      action: 'undo',
    });
    expect(shortcutFor(press({ key: 'y', code: 'KeyZ', ctrlKey: true }), false)).toEqual({
      action: 'redo',
    });
    expect(
      shortcutFor(press({ key: 'Z', code: 'KeyW', metaKey: true, shiftKey: true }), false),
    ).toEqual({
      action: 'redo',
    });
    expect(shortcutFor(press({ key: 'r', code: 'KeyR' }), false)).toEqual({
      action: 'rotate',
      direction: 1,
    });
    expect(shortcutFor(press({ key: 'R', code: 'KeyR', shiftKey: true }), false)).toEqual({
      action: 'rotate',
      direction: -1,
    });
    expect(shortcutFor(press({ key: 'f', code: 'KeyF' }), false)).toEqual({ action: 'focus' });
  });

  it('falls back to the key position on keyboards without Latin letters (FE27)', () => {
    // Russian, Greek and Hebrew: the printed letter is no ASCII letter, the position is.
    expect(shortcutFor(press({ key: 'я', code: 'KeyZ', ctrlKey: true }), false)).toEqual({
      action: 'undo',
    });
    expect(shortcutFor(press({ key: 'н', code: 'KeyY', ctrlKey: true }), false)).toEqual({
      action: 'redo',
    });
    expect(shortcutFor(press({ key: 'ζ', code: 'KeyZ', metaKey: true }), false)).toEqual({
      action: 'undo',
    });
    expect(shortcutFor(press({ key: 'ז', code: 'KeyZ', ctrlKey: true }), false)).toEqual({
      action: 'undo',
    });
    expect(shortcutFor(press({ key: 'к', code: 'KeyR' }), false)).toEqual({
      action: 'rotate',
      direction: 1,
    });
    expect(shortcutFor(press({ key: 'К', code: 'KeyR', shiftKey: true }), false)).toEqual({
      action: 'rotate',
      direction: -1,
    });
    expect(shortcutFor(press({ key: 'а', code: 'KeyF' }), false)).toEqual({ action: 'focus' });
    // A Latin layout still follows the printed letter: QWERTZ's Z sits where QWERTY has Y.
    expect(shortcutFor(press({ key: 'z', code: 'KeyY', ctrlKey: true }), false)).toEqual({
      action: 'undo',
    });
    // Non-letter keys never fall back: a digit on the Z position is no Z.
    expect(shortcutFor(press({ key: '6', code: 'KeyZ', ctrlKey: true }), false)).toBeUndefined();
  });

  it('never repeats undo, redo, delete or applied rotations (FE6)', () => {
    expect(shortcutFor(press({ key: 'z', ctrlKey: true, repeat: true }), false)).toEqual({
      action: 'none',
    });
    expect(shortcutFor(press({ key: 'Delete', repeat: true }), false)).toEqual({ action: 'none' });
    expect(shortcutFor(press({ key: 'r', repeat: true }), false)).toEqual({ action: 'none' });
    // A dragged preview may keep turning while R is held.
    expect(shortcutFor(press({ key: 'r', repeat: true }), true)).toEqual({
      action: 'rotate',
      direction: 1,
    });
  });

  it('leaves movement keys and other combinations to the camera and browser', () => {
    expect(shortcutFor(press({ key: 'w', code: 'KeyW' }), false)).toBeUndefined();
    expect(shortcutFor(press({ key: 'ArrowUp', code: 'ArrowUp' }), false)).toBeUndefined();
    expect(shortcutFor(press({ key: 'z', code: 'KeyW' }), false)).toBeUndefined();
    expect(shortcutFor(press({ key: 'c', ctrlKey: true }), false)).toBeUndefined();
    expect(shortcutFor(press({ key: 'z', ctrlKey: true, altKey: true }), false)).toBeUndefined();
    expect(shortcutFor(press({ key: 'Backspace' }), false)).toEqual({ action: 'delete' });
    expect(shortcutFor(press({ key: 'Escape' }), true)).toEqual({ action: 'escape' });
  });
});
