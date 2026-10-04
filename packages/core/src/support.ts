/**
 * Modules that have Support: every seed (on terrain or canFloat) plus everything linked
 * from a supported Module. `accepts` limits the search, for example to keep a moving
 * Structure out of the support it would rest on.
 */
export function supportedFrom(
  seeds: Iterable<string>,
  links: ReadonlyMap<string, ReadonlySet<string>>,
  accepts: (ref: string) => boolean = () => true,
): Set<string> {
  const result = new Set([...seeds].filter(accepts));
  const queue = [...result];
  for (let index = 0; index < queue.length; index++) {
    for (const next of links.get(queue[index]!) ?? []) {
      if (accepts(next) && !result.has(next)) {
        result.add(next);
        queue.push(next);
      }
    }
  }
  return result;
}
