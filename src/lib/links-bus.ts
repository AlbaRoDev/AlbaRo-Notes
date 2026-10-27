/** Tells every mounted list of linked pages / related tasks that a link was made or removed. In memory, like database-bus.ts. */
const listeners = new Set<() => void>();

export function subscribeLinkChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitLinkChange(): void {
  for (const listener of listeners) listener();
}
