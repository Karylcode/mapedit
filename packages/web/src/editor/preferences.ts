/**
 * Choices remembered in this browser, such as whether a panel is open. Storage
 * may be missing or throw (private windows, blocked site data); then nothing is
 * remembered and the page works as before.
 */
export function rememberedFlag(key: string): boolean | undefined {
  try {
    const value = globalThis.localStorage?.getItem(key);
    return value === null || value === undefined ? undefined : value === 'true';
  } catch {
    return undefined;
  }
}

export function rememberFlag(key: string, value: boolean): void {
  try {
    globalThis.localStorage?.setItem(key, String(value));
  } catch {
    // Only a convenience; the choice still applies to this page.
  }
}
