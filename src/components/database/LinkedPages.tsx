import { useCallback, useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import { linkPage, pagesOfTask, unlinkPage } from "../../lib/db-client";
import { hasDragItem, readDragItem } from "../../lib/drag-item";
import { emitLinkChange, subscribeLinkChanges } from "../../lib/links-bus";
import type { PageRef, PageSummary } from "../../types";

/**
 * The pages linked to a task, under its properties: chips that open the page, a × to unlink and a
 * list to link another — or drag a page from the sidebar onto the task, which is the usual way.
 */
export function LinkedPages({
  taskId,
  pages,
  onOpen,
}: {
  taskId: string;
  pages: PageSummary[];
  onOpen: (pageId: string) => void;
}) {
  const [linked, setLinked] = useState<PageRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const load = useCallback(() => {
    pagesOfTask(taskId)
      .then(setLinked)
      .catch((e) => setError(String(e)));
  }, [taskId]);
  useEffect(() => {
    load();
    return subscribeLinkChanges(load);
  }, [load]);

  const change = (write: () => Promise<void>) => {
    setError(null);
    write()
      .then(emitLinkChange)
      .catch((e) => setError(String(e)));
  };

  const taken = new Set(linked.map((l) => l.id));
  const candidates = pages.filter((p) => p.kind === "page" && !p.databaseId && !taken.has(p.id));

  return (
    <div
      className="linked-pages"
      data-over={over || undefined}
      onDragOver={(e) => {
        if (!hasDragItem(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const item = readDragItem(e);
        if (item?.kind !== "page") return;
        e.preventDefault();
        change(() => linkPage(taskId, item.id));
      }}
    >
      <span className="linked-pages-title">Páginas enlazadas</span>
      <div className="linked-pages-chips">
        {linked.map((page) => (
          <span key={page.id} className="db-chip linked-chip">
            <button
              type="button"
              className="linked-chip-open"
              onClick={() => onOpen(page.id)}
              title="Abrir la página"
            >
              <FileText size={12} aria-hidden="true" /> {page.title}
            </button>
            <button
              type="button"
              aria-label={`Desenlazar ${page.title}`}
              title="Quitar el enlace"
              onClick={() => change(() => unlinkPage(taskId, page.id))}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
        <select
          className="db-input linked-add"
          value=""
          aria-label="Enlazar una página"
          onChange={(e) => e.target.value && change(() => linkPage(taskId, e.target.value))}
        >
          <option value="">
            {linked.length === 0 ? "Enlazar una página… (o arrástrala aquí)" : "+ Enlazar"}
          </option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p className="db-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
