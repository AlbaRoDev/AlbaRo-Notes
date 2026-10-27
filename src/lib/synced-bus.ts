import type { JSONContent } from "@tiptap/react";

type Listener = (doc: JSONContent) => void;

/**
 * In-memory fan-out between the instances of one synced block that are mounted
 * at the same time (e.g. two references on the same page). Persistence goes
 * through SQLite; this only keeps the visible copies in step without a
 * round-trip. Instances on other pages read the saved row when they mount.
 */
const listeners = new Map<string, Map<symbol, Listener>>();

export function subscribeSynced(syncId: string, token: symbol, listener: Listener): () => void {
  const forId = listeners.get(syncId) ?? new Map<symbol, Listener>();
  forId.set(token, listener);
  listeners.set(syncId, forId);
  return () => {
    forId.delete(token);
    if (forId.size === 0) listeners.delete(syncId);
  };
}

/** Sends `doc` to every instance of `syncId` except the one that made the edit. */
export function broadcastSynced(syncId: string, from: symbol, doc: JSONContent) {
  listeners.get(syncId)?.forEach((listener, token) => {
    if (token !== from) listener(doc);
  });
}
