/**
 * Node has no canvas. Marker icons and violation flags draw on one, so tests
 * that build them install a document whose 2D context accepts every call.
 */
export function installFakeCanvas(): void {
  if ((globalThis as { document?: unknown }).document) return;
  const context = new Proxy(
    {},
    {
      get: (_target, property) => (property === 'measureText' ? () => ({ width: 10 }) : () => {}),
      set: () => true,
    },
  );
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  };
}
