/** A key press, as far as the editor's shortcuts care. */
export interface KeyPress {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
}

export type Shortcut =
  | { action: 'undo' | 'redo' | 'delete' | 'focus' | 'escape' | 'firstPerson' }
  | { action: 'rotate'; direction: 1 | -1 }
  /** Swallowed without acting, such as a held key that must not repeat. */
  | { action: 'none' };

/**
 * The Latin letter a shortcut reads. A Latin layout gives the letter printed on
 * the key (`event.key`), so Ctrl+Z undoes on QWERTZ and AZERTY. A key printing
 * a letter of another script, as on Russian, Greek or Hebrew keyboards, falls
 * back to its position (`event.code`). Digits and symbols never fall back: on
 * Dvorak the Z position prints ";", and its own Z key already gives "z".
 */
function letterOf(press: KeyPress): string | undefined {
  if (/^[a-z]$/i.test(press.key)) return press.key.toLowerCase();
  if (!/^\p{L}$/u.test(press.key)) return undefined;
  return /^Key([A-Z])$/.exec(press.code)?.[1]!.toLowerCase();
}

/**
 * What a key press asks the editor to do. Letter shortcuts read `letterOf`;
 * WASD stays positional and is handled with the camera.
 */
export function shortcutFor(press: KeyPress, dragging: boolean): Shortcut | undefined {
  const letter = letterOf(press);
  if (press.ctrlKey || press.metaKey) {
    if (press.altKey || (letter !== 'z' && letter !== 'y')) return undefined;
    // Undo and redo act on the whole project, Agent edits included: never repeat them.
    if (press.repeat) return { action: 'none' };
    return { action: letter === 'y' || press.shiftKey ? 'redo' : 'undo' };
  }
  if (press.altKey) return undefined;
  if (press.key === 'Escape') return { action: 'escape' };
  if (letter === 'r')
    // Holding R keeps turning a dragged preview, but never re-applies edits.
    return press.repeat && !dragging
      ? { action: 'none' }
      : { action: 'rotate', direction: press.shiftKey ? -1 : 1 };
  if (press.key === 'Delete' || press.key === 'Backspace')
    return { action: press.repeat ? 'none' : 'delete' };
  if (letter === 'f') return { action: press.repeat ? 'none' : 'focus' };
  if (letter === 'v') return { action: press.repeat ? 'none' : 'firstPerson' };
  return undefined;
}
