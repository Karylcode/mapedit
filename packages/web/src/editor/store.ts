/** A tiny observable value holder; the HUD re-renders the parts whose inputs changed. */
export class Store<State extends object> {
  private listeners = new Set<(state: State, previous: State) => void>();
  constructor(private current: State) {}

  get state(): State {
    return this.current;
  }

  set(patch: Partial<State>): void {
    const previous = this.current;
    const next = { ...previous, ...patch };
    if ((Object.keys(patch) as (keyof State)[]).every((key) => previous[key] === next[key])) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener(next, previous);
  }

  subscribe(listener: (state: State, previous: State) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** True when any of the listed fields changed between two states. */
export function changed<State extends object>(
  state: State,
  previous: State,
  ...keys: (keyof State)[]
): boolean {
  return keys.some((key) => state[key] !== previous[key]);
}
