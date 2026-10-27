import { ArrowLeft } from "lucide-react";
import { setValue } from "../../lib/db-client";
import type { CellValue } from "../../types";
import { useEditorAppContext } from "../editor/editor-app-context";
import { cellKey } from "./cell-commit";
import { Cell } from "./DatabaseCells";
import { LinkedPages } from "./LinkedPages";
import { TaskBoards } from "./TaskBoards";
import { PropIcon } from "./PropIcon";
import { typeChoiceOf } from "./property-types";
import { useDatabase } from "./useDatabase";
import "./DatabaseView.css";

/**
 * The properties of a database row, shown above its page content (Notion's
 * property panel). Same typed cells as the table, so validation is identical
 * and both always agree: they read and write the same `property_values`.
 */
export function RowProperties({ pageId, databaseId }: { pageId: string; databaseId: string }) {
  const { onNavigate, pages } = useEditorAppContext();
  const { data, error, run, rowsOf } = useDatabase(databaseId);

  const row = data?.rows.find((r) => r.pageId === pageId);
  // a task (a row of the Gestor's task database) can be linked to pages
  const isTask = pages.find((p) => p.ownDatabaseId === databaseId)?.role === "tasks";
  if (!data || !row) return null;

  return (
    <div className="row-props" role="group" aria-label="Propiedades de la fila">
      <button
        type="button"
        className="row-props-source"
        onClick={() => onNavigate(data.pageId)}
        title="Abrir la base de datos"
      >
        <ArrowLeft size={13} strokeWidth={1.75} aria-hidden="true" /> {data.name}
      </button>
      {error && (
        <p className="db-error" role="alert">
          {error}
        </p>
      )}
      {data.properties.length > 0 && (
        <dl className="row-props-list">
          {data.properties.map((p) => {
            const value = row.values[p.id];
            return (
              <div key={p.id} className="row-props-row">
                <dt title={typeChoiceOf(p).label}>
                  <PropIcon prop={p} />
                  {p.name}
                </dt>
                <dd>
                  <Cell
                    key={cellKey(p, value)}
                    prop={p}
                    value={value}
                    targetRows={p.type === "relation" ? rowsOf(p) : []}
                    commit={(v: CellValue | null) => run(() => setValue(pageId, p.id, v))}
                  />
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {isTask && <LinkedPages taskId={pageId} pages={pages} onOpen={onNavigate} />}
      {isTask && <TaskBoards taskId={pageId} />}
    </div>
  );
}
