/**
 * Tells every mounted view of a database that someone else just changed it.
 * A page can hold several views of one database (and a row's property panel
 * shows the same values), each with its own copy of the data — without this a
 * cell edited in one would stay stale in the others until a reload.
 * In-memory and per-window, like synced-bus.ts: SQLite is the source of truth.
 */
type Listener = (databaseId: string, source: symbol) => void;

const listeners = new Set<Listener>();

export function subscribeDatabaseChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `source` is the emitter's own token, so it can skip the echo of its own write. */
export function emitDatabaseChange(databaseId: string, source: symbol): void {
  for (const listener of listeners) listener(databaseId, source);
}
