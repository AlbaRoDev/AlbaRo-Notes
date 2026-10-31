import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ChevronsRight,
  Clock,
  Copy,
  CopyPlus,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Search,
  Sparkles,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { duplicateRow, getPageContent, pageInfo, setPageFavorite } from "../../lib/db-client";
import { blocksToMarkdown } from "../../lib/markdown-blocks";
import { readPref, writePref } from "../../lib/prefs";
import type { PageInfo, PageSummary } from "../../types";
import type { TaskHost } from "./Tasks";

const MIN_WIDTH = 380;
const DEFAULT_WIDTH = 680;
/** How long the slide-out takes (workspace.css has the same figure). */
const CLOSE_MS = 160;

interface MenuAction {
  id: string;
  label: string;
  keywords: string;
  Icon: LucideIcon;
  run: () => void | Promise<void>;
  danger?: boolean;
}

/** SQLite's UTC `YYYY-MM-DD HH:MM:SS` as the reader's local date and time. */
function formatEdited(updatedAt: string): string {
  const date = new Date(`${updatedAt.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime())
    ? updatedAt
    : date.toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
}

/** The «···» menu of a task's page, Notion's: a search box over the actions that make sense here, and the page's last edit. */
function TaskMenu({
  page,
  host,
  onClose,
  onDeleted,
}: {
  page: PageSummary;
  host: TaskHost;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [query, setQuery] = useState("");
  const [info, setInfo] = useState<PageInfo | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    pageInfo(page.id)
      .then((found) => !cancelled && setInfo(found))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [page.id]);

  const actions: MenuAction[] = [
    {
      id: "copy",
      label: "Copiar el contenido de la página",
      keywords: "copiar texto markdown portapapeles",
      Icon: Copy,
      run: async () => {
        const doc = await getPageContent(page.id);
        await navigator.clipboard.writeText(blocksToMarkdown(doc?.content ?? []));
        setNote("Copiado al portapapeles");
      },
    },
    {
      id: "duplicate",
      label: "Duplicar",
      keywords: "copia clonar",
      Icon: CopyPlus,
      run: async () => {
        const copy = await duplicateRow(page.id);
        host.onPagesChanged();
        setNote(`Duplicada como «${copy.title}»`);
      },
    },
    {
      id: "ai",
      label: "Usar con la IA",
      keywords: "asistente inteligencia artificial",
      Icon: Sparkles,
      run: () => {
        host.onOpenAi();
        onClose();
      },
    },
    {
      id: "delete",
      label: "Borrar la tarea",
      keywords: "papelera eliminar quitar",
      Icon: Trash2,
      danger: true,
      run: async () => {
        if (await host.onDelete(page.id)) onDeleted();
      },
    },
  ];
  const needle = query.trim().toLowerCase();
  const shown = actions.filter(
    (a) => !needle || `${a.label} ${a.keywords}`.toLowerCase().includes(needle),
  );

  return (
    <div className="peek-menu" role="menu" aria-label="Acciones de la tarea">
      <label className="peek-menu-search">
        <Search size={15} aria-hidden />
        <input
          autoFocus
          type="text"
          value={query}
          placeholder="Buscar acciones…"
          aria-label="Buscar acciones"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
            if (e.key === "Enter" && shown[0])
              void Promise.resolve(shown[0].run()).catch((err) => setNote(String(err)));
          }}
        />
      </label>
      {shown.map(({ id, label, Icon, run, danger }) => (
        <button
          key={id}
          type="button"
          role="menuitem"
          data-danger={danger || undefined}
          onClick={() => void Promise.resolve(run()).catch((err) => setNote(String(err)))}
        >
          <Icon size={16} strokeWidth={1.75} aria-hidden />
          {label}
        </button>
      ))}
      {shown.length === 0 && <p className="peek-menu-note">Ninguna acción coincide.</p>}
      {note && (
        <p className="peek-menu-note" role="status">
          {note}
        </p>
      )}
      {info && (
        <div className="peek-menu-info">
          <span>
            <Clock size={13} aria-hidden /> Última edición
          </span>
          <strong>{formatEdited(info.updatedAt)}</strong>
          <span>{info.words === 1 ? "1 palabra" : `${info.words} palabras`}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Notion's peek for a task, over the right of the window with the table still behind it. Drag its left
 * edge to resize it, ⤢ makes it full screen, and a click outside, Esc or ›› close it. The star pins the
 * task as a favourite; «···» holds the page's actions.
 */
export function TaskPeek({
  page,
  host,
  onClose,
  children,
}: {
  page: PageSummary;
  host: TaskHost;
  onClose: () => void;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(() =>
    Math.max(MIN_WIDTH, Number(readPref("peek.width")) || DEFAULT_WIDTH),
  );
  const [full, setFull] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [closing, setClosing] = useState(false);
  useEffect(() => writePref("peek.width", String(width)), [width]);

  // Closing slides it out first; the task is only released when that has played.
  const requestClose = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, CLOSE_MS);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) requestClose(); // a menu inside the page takes its own Esc first
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [requestClose]);

  // The «···» menu floats, so a click anywhere else closes it.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".peek-menu, .peek-menu-button")) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault(); // no text selection while dragging
    const handle = e.currentTarget;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* the drag still works without capture */
    }
    const startX = e.clientX;
    const startWidth = width;
    setResizing(true);
    const max = () => Math.max(MIN_WIDTH, window.innerWidth - 48);
    const onMove = (ev: PointerEvent) =>
      setWidth(Math.min(max(), Math.max(MIN_WIDTH, Math.round(startWidth + startX - ev.clientX))));
    const onUp = () => {
      setResizing(false);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  return createPortal(
    <div
      className="task-peek-backdrop"
      data-closing={closing || undefined}
      onMouseDown={(e) => e.target === e.currentTarget && requestClose()}
    >
      <aside
        className="task-peek"
        data-full={full || undefined}
        data-resizing={resizing || undefined}
        style={full ? undefined : { width: `min(${width}px, 100%)` }}
        role="dialog"
        aria-label="Tarea"
      >
        {!full && (
          <div
            className="task-peek-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Ajustar el ancho de la tarea"
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={startResize}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setWidth((w) => Math.min(window.innerWidth - 48, w + 32));
              if (e.key === "ArrowRight") setWidth((w) => Math.max(MIN_WIDTH, w - 32));
            }}
          />
        )}
        <div className="task-peek-bar">
          <button
            type="button"
            onClick={requestClose}
            aria-label="Cerrar la tarea"
            title="Cerrar (Esc)"
          >
            <ChevronsRight size={18} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setFull((f) => !f)}
            aria-label={full ? "Salir de pantalla completa" : "Pantalla completa"}
            title={full ? "Salir de pantalla completa" : "Pantalla completa"}
          >
            {full ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
          </button>
          <span className="task-peek-bar-gap" />
          <button
            type="button"
            data-on={page.favorite || undefined}
            aria-pressed={page.favorite}
            aria-label={page.favorite ? "Quitar de favoritos" : "Añadir a favoritos"}
            title={page.favorite ? "Quitar de favoritos" : "Añadir a favoritos"}
            onClick={() => void setPageFavorite(page.id, !page.favorite).then(host.onPagesChanged)}
          >
            <Star size={16} aria-hidden fill={page.favorite ? "currentColor" : "none"} />
          </button>
          <button
            type="button"
            className="peek-menu-button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Más acciones"
            title="Más acciones"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal size={18} aria-hidden />
          </button>
          {menuOpen && (
            <TaskMenu
              page={page}
              host={host}
              onClose={() => setMenuOpen(false)}
              onDeleted={onClose}
            />
          )}
        </div>
        <div className="task-peek-body">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
