import { useCallback, useEffect, useState } from "react";
import { Database, FileText, RotateCcw, Trash2, X } from "lucide-react";
import { PageIcon } from "./PageIcon";
import { askConfirm, pendingQuestion } from "../lib/confirm";
import { emptyTrash, listTrash, purgeTrash, restoreTrash } from "../lib/db-client";
import type { TrashItem } from "../types";
import "./trash-dialog.css";

// SQLite's `datetime('now')` is UTC without a zone mark.
const when = (utc: string) =>
  new Date(`${utc.replace(" ", "T")}Z`).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
  });

/** The trash: what was deleted in the last days, to put back or to erase for good. */
export function TrashDialog({
  onClose,
  onRestored,
}: {
  onClose: () => void;
  /** A page came back (its id): the page list and the views of databases need reading again. */
  onRestored: (pageId: string) => void;
}) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listTrash()
      .then(setItems)
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    // while a question is open on top (erase for good), Esc answers that one only
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !pendingQuestion() && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Runs one change of the trash, then reads it again; a refusal is shown, not lost. */
  const run = async (change: () => Promise<void>) => {
    setError(null);
    try {
      await change();
    } catch (e) {
      setError(String(e));
    }
    load();
  };

  const restore = (item: TrashItem) =>
    run(async () => {
      onRestored(await restoreTrash(item.id));
    });

  const erase = async (item: TrashItem) => {
    const ok = await askConfirm({
      title: `¿Borrar «${item.title}» para siempre?`,
      detail: "No se podrá recuperar.",
      confirmLabel: "Borrar para siempre",
    });
    if (ok) await run(() => purgeTrash(item.id));
  };

  const empty = async () => {
    const ok = await askConfirm({
      title: "¿Vaciar la papelera?",
      detail: "Todo lo que contiene se borrará para siempre.",
      confirmLabel: "Vaciar la papelera",
    });
    if (ok) await run(emptyTrash);
  };

  return (
    <div className="trash-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="trash-dialog" role="dialog" aria-modal="true" aria-label="Papelera">
        <div className="trash-head">
          <h3>Papelera</h3>
          {items && items.length > 0 && (
            <button type="button" className="trash-empty" onClick={() => void empty()}>
              Vaciar la papelera
            </button>
          )}
          <button type="button" className="trash-close" onClick={onClose} aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>
        <p className="trash-note">
          Lo borrado se guarda 30 días y después se elimina para siempre.
        </p>
        {error && (
          <p className="trash-error" role="alert">
            {error}
          </p>
        )}
        {items && items.length === 0 && <p className="trash-none">La papelera está vacía.</p>}
        <ul className="trash-list">
          {items?.map((item) => (
            <li key={item.id}>
              <span className="trash-icon" aria-hidden="true">
                {item.icon ? (
                  <PageIcon icon={item.icon} size={16} />
                ) : item.kind === "database" ? (
                  <Database size={16} strokeWidth={1.75} />
                ) : (
                  <FileText size={16} strokeWidth={1.75} />
                )}
              </span>
              <span className="trash-text">
                <span className="trash-title">{item.title}</span>
                <span className="trash-meta">
                  Borrada el {when(item.deletedAt)}
                  {item.pageCount > 1 && ` · con ${item.pageCount - 1} más dentro`} · se elimina el{" "}
                  {when(item.expiresAt)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void restore(item)}
                title="Restaurar"
                aria-label={`Restaurar «${item.title}»`}
              >
                <RotateCcw size={15} />
              </button>
              <button
                type="button"
                onClick={() => void erase(item)}
                title="Borrar para siempre"
                aria-label={`Borrar «${item.title}» para siempre`}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
