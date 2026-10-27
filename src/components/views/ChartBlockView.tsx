import { useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { ChartColumn, Plus, X } from "lucide-react";
import type { ChartPoint, ChartType } from "../../types";
import { commitOnBlur } from "../database/cell-commit";
import { CHART_TYPE_LABELS } from "../database/view-config";
import { ChartCanvas } from "./ChartCanvas";
import { MAX_CHART_ENTRIES, MAX_CHART_VALUE, MAX_ITEM_TITLE, type StoredEntry } from "./view-items";
import "../database/DatabaseView.css"; // shared form controls

/**
 * The standalone chart block: its numbers live in the block itself, unrelated to any
 * database (a database view can chart real rows; this one is for a few figures typed by hand).
 */
export function ChartBlockView({ node, updateAttributes, deleteNode, editor }: NodeViewProps) {
  const entries = node.attrs.entries as StoredEntry[];
  const type = (
    node.attrs.chartType in CHART_TYPE_LABELS ? node.attrs.chartType : "bar"
  ) as ChartType;
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const save = (next: StoredEntry[]) => updateAttributes({ entries: next });
  const change = (id: string, patch: Partial<StoredEntry>) =>
    save(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const add = () => {
    if (entries.length >= MAX_CHART_ENTRIES) return;
    const created: StoredEntry = { id: crypto.randomUUID(), title: "", value: null };
    setFocusId(created.id);
    save([...entries, created]);
  };
  const remove = () => {
    deleteNode();
    editor.commands.focus();
  };

  const numbers = entries.flatMap((e) => (e.value === null ? [] : [e.value]));
  const points: ChartPoint[] =
    type === "number"
      ? [
          {
            key: "",
            label: "Total",
            value: numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) : null,
          },
        ]
      : entries.map((e) => ({ key: e.id, label: e.title || "Sin título", value: e.value }));

  return (
    <NodeViewWrapper className="db-block view-block" contentEditable={false}>
      <div className="db-header">
        <ChartColumn size={14} strokeWidth={1.75} aria-hidden="true" />
        <span className="db-title view-block-title">Gráfico</span>
        <span className="db-header-actions">
          <select
            value={type}
            aria-label="Tipo de gráfico"
            onChange={(e) => updateAttributes({ chartType: e.target.value })}
          >
            {Object.entries(CHART_TYPE_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          {confirmRemove ? (
            <>
              <span>¿Quitar (se pierden {entries.length})?</span>
              <button type="button" onClick={remove}>
                Sí, quitar
              </button>
              <button type="button" onClick={() => setConfirmRemove(false)}>
                No
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => (entries.length > 0 ? setConfirmRemove(true) : remove())}
            >
              Quitar
            </button>
          )}
        </span>
      </div>

      {entries.length > 0 && (
        <ChartCanvas
          type={type}
          points={points}
          measure={type === "number" ? "Total" : "Valores"}
          additive
        />
      )}

      <div className="chart-data" role="group" aria-label="Datos del gráfico">
        {entries.map((e) => {
          const current = e.value === null ? "" : String(e.value);
          return (
            <div key={e.id} className="chart-data-row">
              <input
                className="db-input"
                type="text"
                maxLength={MAX_ITEM_TITLE}
                autoFocus={focusId === e.id}
                defaultValue={e.title}
                placeholder="Etiqueta"
                aria-label="Etiqueta"
                {...commitOnBlur(
                  e.title,
                  (v) => (change(e.id, { title: String(v ?? "").trim() }), Promise.resolve(true)),
                  (raw) => raw,
                )}
              />
              <input
                className="db-input"
                type="number"
                step="any"
                key={current}
                defaultValue={current}
                placeholder="Valor"
                aria-label="Valor"
                {...commitOnBlur(
                  current,
                  (v) => {
                    if (
                      typeof v === "number" &&
                      (!Number.isFinite(v) || Math.abs(v) > MAX_CHART_VALUE)
                    ) {
                      setNote("El valor es demasiado grande");
                      return Promise.resolve(false);
                    }
                    setNote(null);
                    change(e.id, { value: typeof v === "number" ? v : null });
                    return Promise.resolve(true);
                  },
                  (raw) => (raw === "" ? null : Number(raw)),
                )}
              />
              <button
                type="button"
                className="db-icon-btn"
                aria-label="Borrar dato"
                title="Borrar dato"
                onClick={() => save(entries.filter((x) => x.id !== e.id))}
              >
                <X size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          );
        })}
        {note && <p className="db-error">{note}</p>}
        <button
          type="button"
          className="db-add-row"
          disabled={entries.length >= MAX_CHART_ENTRIES}
          onClick={add}
        >
          <Plus size={14} strokeWidth={1.75} aria-hidden="true" /> Añadir dato
        </button>
        {entries.length === 0 && (
          <p className="db-loading">Aún no hay datos: pulsa «Añadir dato».</p>
        )}
      </div>
    </NodeViewWrapper>
  );
}
