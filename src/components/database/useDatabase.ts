import { useCallback, useEffect, useState } from "react";
import { getDatabase, queryView } from "../../lib/db-client";
import { emitDatabaseChange, subscribeDatabaseChanges } from "../../lib/database-bus";
import type { DatabaseData, DatabaseRow, Property, ViewInfo, ViewResult } from "../../types";
import { useEditorAppContext } from "../editor/editor-app-context";

interface Loaded {
  /** null = the database no longer exists (its page was deleted) */
  data: DatabaseData | null;
  view: ViewInfo | null;
  result: ViewResult | null;
}

/**
 * Loads one database and keeps it fresh; shared by the table (view blocks and
 * the database page) and by a row's property panel. Writes go through `run`,
 * which re-reads afterwards so what's shown is what's stored.
 *
 * `viewId`: which saved view to evaluate — `null` picks the first, `undefined`
 * means "no view" (the row panel only needs the data, not a filtered list).
 */
export function useDatabase(databaseId: string, viewId?: string | null) {
  const { pages } = useEditorAppContext();

  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined); // undefined = loading
  const [targets, setTargets] = useState<Record<string, DatabaseData>>({});
  const [error, setError] = useState<string | null>(null);
  // Identifies this instance's own writes on the bus (see database-bus.ts).
  const [token] = useState(() => Symbol("database-view"));

  const load = useCallback(async (): Promise<Loaded> => {
    const data = await getDatabase(databaseId);
    if (!data || viewId === undefined) return { data, view: null, result: null };
    // a stale or foreign id (view deleted elsewhere) falls back to the first view
    const view = data.views.find((v) => v.id === viewId) ?? data.views[0] ?? null;
    return { data, view, result: view ? await queryView(view.id) : null };
  }, [databaseId, viewId]);

  const reload = useCallback(async () => {
    try {
      setLoaded(await load());
    } catch (e) {
      setError(String(e));
    }
  }, [load]);

  // Other views of this database (or a relation's target), a row's own page and
  // the database page's title all change what we show — App's page list is the
  // one thing they all reach, so re-read when the set of row/database pages or
  // any of their titles changes.
  const pagesSignature = pages
    .map((p) => (p.databaseId || p.ownDatabaseId ? p.id + p.title : ""))
    .join("|");
  useEffect(() => {
    let cancelled = false;
    load().then(
      (l) => !cancelled && setLoaded(l),
      (e) => !cancelled && setError(String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [load, pagesSignature]);

  const data = loaded?.data;

  // Rows of every *other* database this one relates to (own rows come from `data`).
  const targetIds = [
    ...new Set(data?.properties.filter((p) => p.type === "relation").map((p) => p.config.target!)),
  ]
    .filter((t) => t !== databaseId)
    .join(",");
  useEffect(() => {
    let cancelled = false;
    for (const id of targetIds ? targetIds.split(",") : []) {
      getDatabase(id).then(
        (d) => !cancelled && d && setTargets((prev) => ({ ...prev, [id]: d })),
        () => {},
      );
    }
    return () => {
      cancelled = true;
    };
  }, [targetIds, data]);

  // A write made by another view of this database (or of one we relate to) makes ours stale.
  useEffect(() => {
    const related = new Set([databaseId, ...(targetIds ? targetIds.split(",") : [])]);
    return subscribeDatabaseChanges((id, source) => {
      if (source !== token && related.has(id)) void reload();
    });
  }, [databaseId, targetIds, token, reload]);

  /** Runs a write, then re-reads and tells the other views. Resolves false if it failed (the error is in `error`). */
  const run = useCallback(
    async (write: () => Promise<unknown>): Promise<boolean> => {
      try {
        await write();
        setError(null);
        await reload();
        emitDatabaseChange(databaseId, token);
        return true;
      } catch (e) {
        setError(String(e));
        await reload();
        return false;
      }
    },
    [reload, databaseId, token],
  );

  /** Rows a relation property can point to (all of them — never a view's filtered subset). */
  const rowsOf = (p: Property): DatabaseRow[] =>
    (p.config.target === databaseId ? data : targets[p.config.target ?? ""])?.rows ?? [];

  return { data, view: loaded?.view ?? null, result: loaded?.result ?? null, error, run, rowsOf };
}
