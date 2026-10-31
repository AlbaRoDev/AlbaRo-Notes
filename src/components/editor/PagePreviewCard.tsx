import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Database } from "lucide-react";
import { pagePreview } from "../../lib/page-preview";
import type { PreviewItem } from "../../lib/markdown-blocks";
import type { PageSummary } from "../../types";
import { PageCover } from "./PageHeader";
import { PageIcon } from "../PageIcon";
import { PageRef } from "./PageRef";
import "./PagePreviewCard.css";

const WIDTH = 320;
const HEIGHT = 280; // the card's most; used to decide whether it fits under the link
const GAP = 6;
const MARGIN = 8;

/** Notion's hover card for a link to a page: its cover, icon, title and the first lines of its text. */
export function PagePreviewCard({
  page,
  pages,
  anchor,
  onPointer,
  onOpen,
}: {
  page: PageSummary;
  /** Every page, to name the ones this page links to. */
  pages: PageSummary[];
  anchor: HTMLElement;
  /** The pointer entered (true) or left (false) the card, so it does not close under it. */
  onPointer: (inside: boolean) => void;
  /** Go to a page: this one (the card itself) or one of those listed in it. */
  onOpen: (pageId: string) => void;
}) {
  const [items, setItems] = useState<PreviewItem[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    pagePreview(page.id)
      .then((found) => !cancelled && setItems(found))
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [page.id]);

  // Under the link; above it when there is no room below, so it never covers the line being written under it.
  const rect = anchor.getBoundingClientRect();
  const left = Math.max(MARGIN, Math.min(rect.left, window.innerWidth - WIDTH - MARGIN));
  const below = rect.bottom + GAP + HEIGHT <= window.innerHeight;
  const place = below
    ? { top: rect.bottom + GAP }
    : { bottom: window.innerHeight - rect.top + GAP };

  return createPortal(
    <div
      className="page-preview"
      role="tooltip"
      style={{ left, width: WIDTH, maxHeight: HEIGHT, ...place }}
      onMouseEnter={() => onPointer(true)}
      onMouseLeave={() => onPointer(false)}
      onClick={() => onOpen(page.id)}
    >
      {page.cover && (
        <div className="page-preview-cover">
          <PageCover cover={page.cover} />
        </div>
      )}
      <div className="page-preview-head">
        {page.icon && (
          <span className="page-preview-icon" aria-hidden="true">
            <PageIcon icon={page.icon} size={20} />
          </span>
        )}
        <strong>{page.title || "Sin título"}</strong>
      </div>
      <div className="page-preview-body">
        {items === null ? (
          <span className="page-preview-note">Cargando…</span>
        ) : page.kind === "database" ? (
          <span className="page-preview-note">
            <Database size={13} aria-hidden="true" /> Base de datos
          </span>
        ) : items.length === 0 ? (
          <span className="page-preview-note">Página vacía</span>
        ) : (
          items.map((item, i) => {
            if ("text" in item)
              return (
                <p key={i} data-heading={item.heading || undefined}>
                  {item.text}
                </p>
              );
            const child = pages.find((p) => p.id === item.pageId);
            // a page of its own: it opens from here, as the parents do from the path
            return child ? (
              <button
                key={i}
                type="button"
                className="page-preview-page"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(child.id);
                }}
              >
                <PageRef page={child} />
              </button>
            ) : null;
          })
        )}
      </div>
    </div>,
    document.body,
  );
}
