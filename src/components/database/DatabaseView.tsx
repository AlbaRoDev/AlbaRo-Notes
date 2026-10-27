import { useEffect, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { listDatabases } from "../../lib/db-client";
import type { DatabaseSummary } from "../../types";
import { focusLineAfterNode } from "../editor/media-commands";
import { DatabaseTable } from "./DatabaseTable";
import "./DatabaseView.css";

/** Shown while the view has no source yet («Vista de base de datos»): pick one of the existing databases. */
function SourcePicker({
  onPick,
  onCancel,
}: {
  onPick: (id: string) => void;
  onCancel: () => void;
}) {
  // undefined = loading
  const [databases, setDatabases] = useState<DatabaseSummary[] | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void listDatabases().then((all) => !cancelled && setDatabases(all));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="db-root db-panel" role="group" aria-label="Elegir base de datos">
      {databases === undefined ? (
        <p className="db-loading">Cargando…</p>
      ) : databases.length === 0 ? (
        <p className="db-loading">Aún no hay bases de datos: crea una desde el «+» del sidebar.</p>
      ) : (
        <label>
          Base de datos de origen
          <select
            autoFocus
            defaultValue=""
            onChange={(e) => e.target.value && onPick(e.target.value)}
          >
            <option value="" disabled>
              Elegir…
            </option>
            {databases.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="db-panel-actions">
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/**
 * The `database` block: a *view* of a database that lives in its own page.
 * It holds only `databaseId`; `null` means it is still choosing its source.
 */
export function DatabaseView({
  node,
  editor,
  getPos,
  updateAttributes,
  deleteNode,
}: NodeViewProps) {
  const databaseId = node.attrs.databaseId as string | null;
  const viewId = node.attrs.viewId as string | null;

  // Drops this view only — the database and its rows belong to their own page.
  const remove = () => {
    deleteNode();
    editor.commands.focus();
  };

  return (
    <NodeViewWrapper className="db-block" contentEditable={false}>
      {databaseId ? (
        <DatabaseTable
          databaseId={databaseId}
          onRemove={remove}
          viewId={viewId}
          onViewChange={(id) => updateAttributes({ viewId: id })}
        />
      ) : (
        <SourcePicker
          onPick={(id) => {
            updateAttributes({ databaseId: id, viewId: null });
            focusLineAfterNode(editor, getPos());
          }}
          onCancel={remove}
        />
      )}
    </NodeViewWrapper>
  );
}
