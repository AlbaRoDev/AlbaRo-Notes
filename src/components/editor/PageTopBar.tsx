import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Clock,
  Copy,
  MoreHorizontal,
  Sparkles,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { getPageContent, pageInfo, setPageFavorite } from "../../lib/db-client";
import { blocksToMarkdown } from "../../lib/markdown-blocks";
import type { PageInfo, PageSummary } from "../../types";
import { CrumbStep } from "./PageCrumbs";
import "./PageTopBar.css";

interface Action {
  id: string;
  label: string;
  Icon: LucideIcon;
  danger?: boolean;
  run: () => void | Promise<void>;
}

/** SQLite's UTC `YYYY-MM-DD HH:MM:SS` as the reader's local date and time. */
function formatEdited(updatedAt: string): string {
  const date = new Date(`${updatedAt.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime())
    ? updatedAt
    : date.toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
}

/** The pages above this one, root first (a row's database, a sub-page's parents). */
function ancestorsOf(page: PageSummary, pages: PageSummary[]): PageSummary[] {
  const chain: PageSummary[] = [];
  let at = page.parentId ? pages.find((p) => p.id === page.parentId) : undefined;
  while (at && chain.length < 12 && !chain.includes(at)) {
    chain.unshift(at);
    at = at.parentId ? pages.find((p) => p.id === at!.parentId) : undefined;
  }
  return chain;
}

/**
 * The bar over a page, like Notion's: the path to it (click an ancestor to go there), a star to pin it as a favourite
 * and the «···» menu (copy the text as Markdown, ask the AI about it, delete it) with when it was last edited.
 */
export function PageTopBar({
  page,
  pages,
  onOpen,
  onChanged,
  onDelete,
  onAskAi,
}: {
  page: PageSummary;
  pages: PageSummary[];
  onOpen: (pageId: string) => void;
  onChanged: () => void;
  onDelete: (pageId: string) => void;
  onAskAi: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [info, setInfo] = useState<PageInfo | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const trail = ancestorsOf(page, pages);
  const deletable = page.role !== "tasks";

  useEffect(() => {
    if (!menuOpen) return;
    let cancelled = false;
    pageInfo(page.id)
      .then((found) => !cancelled && setInfo(found))
      .catch(() => undefined);
    const down = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      cancelled = true;
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, [menuOpen, page.id]);

  const actions: Action[] = [
    {
      id: "copy",
      label: "Copiar el contenido como Markdown",
      Icon: Copy,
      run: async () => {
        const doc = await getPageContent(page.id);
        await navigator.clipboard.writeText(blocksToMarkdown(doc?.content ?? []));
        setNote("Copiado al portapapeles");
      },
    },
    {
      id: "ai",
      label: "Usar con la IA",
      Icon: Sparkles,
      run: () => {
        setMenuOpen(false);
        onAskAi();
      },
    },
    ...(deletable
      ? [
          {
            id: "delete",
            label: "Borrar la página",
            Icon: Trash2,
            danger: true,
            run: () => {
              if (
                !window.confirm(
                  `¿Borrar «${page.title || "Sin título"}»? Esta acción no se puede deshacer.`,
                )
              )
                return;
              setMenuOpen(false);
              onDelete(page.id);
            },
          },
        ]
      : []),
  ];

  return (
    <div className="page-topbar">
      <nav className="page-crumbs" aria-label="Ruta de la página">
        {/* The pages above this one (each opens on click) and, last, this one. */}
        {trail.map((p, i) => (
          <span key={p.id} className="page-crumb">
            {i > 0 && <ChevronRight size={12} aria-hidden="true" />}
            <CrumbStep page={p} pages={pages} current={false} onOpen={onOpen} />
          </span>
        ))}
        <span className="page-crumb" aria-current="page">
          {trail.length > 0 && <ChevronRight size={12} aria-hidden="true" />}
          <CrumbStep page={page} pages={pages} current onOpen={onOpen} />
        </span>
      </nav>
      <div className="page-topbar-actions" ref={menuRef}>
        <button
          type="button"
          aria-label={page.favorite ? "Quitar de favoritos" : "Añadir a favoritos"}
          aria-pressed={page.favorite}
          title={page.favorite ? "Quitar de favoritos" : "Añadir a favoritos"}
          onClick={() => void setPageFavorite(page.id, !page.favorite).then(onChanged)}
        >
          <Star size={16} fill={page.favorite ? "currentColor" : "none"} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Más acciones"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Más acciones"
          onClick={() => {
            setNote(null);
            setMenuOpen((o) => !o);
          }}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
        {menuOpen && (
          <div className="page-menu" role="menu" aria-label="Acciones de la página">
            {actions.map(({ id, label, Icon, danger, run }) => (
              <button
                key={id}
                type="button"
                role="menuitem"
                data-danger={danger || undefined}
                onClick={() => void Promise.resolve(run()).catch((e) => setNote(String(e)))}
              >
                <Icon size={15} aria-hidden="true" /> {label}
              </button>
            ))}
            {note && (
              <p className="page-menu-note" role="status">
                {note}
              </p>
            )}
            {info && (
              <p className="page-menu-foot">
                <Clock size={12} aria-hidden="true" /> Última edición:{" "}
                {formatEdited(info.updatedAt)} · {info.words}{" "}
                {info.words === 1 ? "palabra" : "palabras"}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
