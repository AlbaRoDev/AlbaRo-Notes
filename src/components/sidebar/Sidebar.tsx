import { useEffect, useState } from "react";
import { PageIcon } from "../PageIcon";
import { createPortal } from "react-dom";
import {
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Circle,
  Database,
  FileText,
  Leaf,
  Monitor,
  Moon,
  MousePointer,
  MousePointer2,
  Plus,
  Search,
  Sparkles,
  Sun,
  Trash2,
} from "lucide-react";
import type { PageSummary } from "../../types";
import { Fold } from "../Fold";
import { startItemDrag } from "../../lib/drag-item";
import { readPref, writePref } from "../../lib/prefs";
import {
  getCursorPref,
  getStylePref,
  getThemePref,
  onCursorPrefChange,
  onStylePrefChange,
  onThemePrefChange,
  setCursorPref,
  setStylePref,
  setThemePref,
  type CursorPref,
  type StylePref,
  type ThemePref,
} from "../../lib/theme";
import appIcon from "../../../src-tauri/icons/128x128.png";
import "./Sidebar.css";

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 240;

const STYLES: { pref: StylePref; label: string; title: string; Icon: typeof Sun }[] = [
  { pref: "themed", label: "Estaciones", title: "Los colores de la estación del año", Icon: Leaf },
  { pref: "sober", label: "Sobrio", title: "La paleta sobria de siempre", Icon: Circle },
];

const CURSORS: { pref: CursorPref; label: string; title: string; Icon: typeof Sun }[] = [
  {
    pref: "system",
    label: "Puntero del sistema",
    title: "El puntero de siempre",
    Icon: MousePointer,
  },
  {
    pref: "minimal",
    label: "Puntero minimalista",
    title: "La flecha fina del botón, sin color",
    Icon: MousePointer2,
  },
];

const THEMES: { pref: ThemePref; label: string; Icon: typeof Sun }[] = [
  { pref: "system", label: "Sistema", Icon: Monitor },
  { pref: "light", label: "Claro", Icon: Sun },
  { pref: "dark", label: "Oscuro", Icon: Moon },
];

// Size of the «+» menu, to keep it inside the window.
const MENU_W = 208;
const MENU_H = 84;

const clampWidth = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));

interface SidebarProps {
  pages: PageSummary[];
  selectedPageId: string | null;
  onSelect: (pageId: string) => void;
  onCreate: (kind: PageSummary["kind"]) => void;
  onDelete: (pageId: string) => void;
  onRename: (pageId: string, title: string) => Promise<void>;
  /** Opens the search dialog. */
  onSearch: () => void;
  /** Opens the AI assistant. */
  onAskAi: () => void;
}

/** Maps each page to its direct children, in `pages` order. */
function groupByParent(pages: PageSummary[]): Map<string | null, PageSummary[]> {
  const byParent = new Map<string | null, PageSummary[]>();
  for (const page of pages) {
    if (page.databaseId) continue; // database rows are reached through their database block
    const siblings = byParent.get(page.parentId) ?? [];
    siblings.push(page);
    byParent.set(page.parentId, siblings);
  }
  return byParent;
}

/** Every ancestor id of `pageId`, so a deep-linked sub-page reveals itself. */
function ancestorIds(pages: PageSummary[], pageId: string | null): string[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const ids: string[] = [];
  let current = pageId ? byId.get(pageId)?.parentId : undefined;
  while (current) {
    ids.push(current);
    current = byId.get(current)?.parentId ?? undefined;
  }
  return ids;
}

export function Sidebar({
  pages,
  selectedPageId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  onSearch,
  onAskAi,
}: SidebarProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // The «+» offers the two kinds of page; a database page is its own kind, not a sub-page.
  // Drawn in a portal at fixed coordinates: the sidebar clips whatever overflows it.
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null);
  const menuOpen = menuAt !== null;
  const setMenuOpen = (open: boolean) => !open && setMenuAt(null);
  const [width, setWidth] = useState(() =>
    clampWidth(Number(readPref("sidebar.width")) || DEFAULT_WIDTH),
  );
  const [resizing, setResizing] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readPref("sidebar.collapsed") === "1");
  const [theme, setTheme] = useState(getThemePref);
  const [style, setStyle] = useState(getStylePref);
  const [cursor, setCursor] = useState(getCursorPref);
  // The two groups of the list fold away; Notion remembers which ones.
  const [pagesOpen, setPagesOpen] = useState(() => readPref("sidebar.pages") !== "0");
  const [databasesOpen, setDatabasesOpen] = useState(() => readPref("sidebar.databases") !== "0");
  const [favoritesOpen, setFavoritesOpen] = useState(() => readPref("sidebar.favorites") !== "0");
  useEffect(() => writePref("sidebar.favorites", favoritesOpen ? "1" : "0"), [favoritesOpen]);
  useEffect(() => writePref("sidebar.pages", pagesOpen ? "1" : "0"), [pagesOpen]);
  useEffect(() => writePref("sidebar.databases", databasesOpen ? "1" : "0"), [databasesOpen]);

  useEffect(() => writePref("sidebar.width", String(width)), [width]);
  useEffect(() => writePref("sidebar.collapsed", collapsed ? "1" : "0"), [collapsed]);

  // The selector follows the theme wherever it's changed (here, Ctrl+Shift+L, the Ctrl+K palette).
  useEffect(() => onThemePrefChange(setTheme), []);
  useEffect(() => onStylePrefChange(setStyle), []);
  useEffect(() => onCursorPrefChange(setCursor), []);

  // Notion's shortcut: Ctrl+\ toggles the sidebar (Cmd on macOS). Ctrl+Shift+L lives in App, which outlasts the sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The «+» menu floats, so a click anywhere else closes it.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".sidebar-header, .sidebar-menu")) setMenuAt(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault(); // no text selection while dragging
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = width;
    setResizing(true);
    const onMove = (ev: PointerEvent) => setWidth(clampWidth(startWidth + ev.clientX - startX));
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

  // Reveal a deep-linked sub-page (navigated to via a pageLink/breadcrumb
  // click) by expanding its ancestors — adjusted during render, React's own
  // recommended pattern for "state derived from a prop change", rather than
  // an effect that would set state after an extra render.
  const [lastSelectedForExpand, setLastSelectedForExpand] = useState(selectedPageId);
  if (selectedPageId !== lastSelectedForExpand) {
    setLastSelectedForExpand(selectedPageId);
    const ancestors = ancestorIds(pages, selectedPageId);
    if (ancestors.length > 0) {
      setExpandedIds((prev) => new Set([...prev, ...ancestors]));
    }
  }

  const byParent = groupByParent(pages);

  const toggleExpanded = (pageId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  };

  // The page being renamed in place (double-click its name): Enter or leaving saves, Esc cancels.
  const [renaming, setRenaming] = useState<string | null>(null);
  const finishRename = (page: PageSummary, input: HTMLInputElement, save: boolean) => {
    setRenaming(null);
    const title = input.value.trim();
    if (save && title && title !== page.title) void onRename(page.id, title);
  };

  const handleDelete = (page: PageSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    const extra = page.kind === "database" ? " Se borrarán también todas sus filas." : "";
    if (window.confirm(`¿Borrar "${page.title}"?${extra} Esta acción no se puede deshacer.`)) {
      onDelete(page.id);
    }
  };

  const renderNode = (page: PageSummary): React.ReactNode => {
    const children = byParent.get(page.id) ?? [];
    const hasChildren = children.length > 0;
    const expanded = expandedIds.has(page.id);

    return (
      <li key={page.id}>
        <div
          className="sidebar-item"
          data-selected={page.id === selectedPageId}
          onClick={() => onSelect(page.id)}
          // an ordinary page can be dragged onto a task (to link them) or into a note (as a mention)
          draggable={page.kind === "page" && !page.databaseId}
          onDragStart={(e) => startItemDrag(e, { kind: "page", id: page.id })}
        >
          <button
            type="button"
            className="sidebar-item-disclosure"
            data-visible={hasChildren}
            data-expanded={expanded}
            onClick={(e) => toggleExpanded(page.id, e)}
            aria-label={expanded ? "Contraer" : "Expandir"}
            tabIndex={hasChildren ? 0 : -1}
          >
            <ChevronRight size={14} />
          </button>
          {page.icon ? (
            <span className="sidebar-item-icon sidebar-item-emoji" aria-hidden="true">
              <PageIcon icon={page.icon} size={16} />
            </span>
          ) : page.kind === "database" ? (
            <Database
              size={16}
              strokeWidth={1.75}
              className="sidebar-item-icon"
              aria-label="Base de datos"
            />
          ) : (
            <FileText size={16} strokeWidth={1.75} className="sidebar-item-icon" aria-hidden />
          )}
          {renaming === page.id ? (
            <input
              className="sidebar-item-rename"
              defaultValue={page.title}
              maxLength={200}
              aria-label="Nombre de la página"
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => finishRename(page, e.currentTarget, true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") finishRename(page, e.currentTarget, true);
                else if (e.key === "Escape") finishRename(page, e.currentTarget, false);
              }}
            />
          ) : (
            <span
              className="sidebar-item-title"
              title={page.title}
              onDoubleClick={() => setRenaming(page.id)}
            >
              {page.title}
            </span>
          )}
          {/* The Gestor's task database can't be deleted (Rust refuses too). */}
          {page.role !== "tasks" && (
            <button
              type="button"
              className="sidebar-item-delete"
              onClick={(e) => handleDelete(page, e)}
              title="Borrar página"
              aria-label="Borrar página"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        {hasChildren && expanded && (
          <ul className="sidebar-list sidebar-list-nested">{children.map(renderNode)}</ul>
        )}
      </li>
    );
  };

  const topLevel = byParent.get(null) ?? [];
  const rootPages = topLevel.filter((p) => p.kind !== "database");
  const rootDatabases = topLevel.filter((p) => p.kind === "database");
  const favorites = pages.filter((p) => p.favorite);

  const openButton = collapsed && (
    <button
      type="button"
      className="sidebar-open"
      onClick={() => setCollapsed(false)}
      title="Abrir barra lateral (Ctrl+\)"
      aria-label="Abrir barra lateral"
    >
      <ChevronsRight size={18} />
    </button>
  );

  // Folding slides the width to 0 instead of unmounting, so closing and opening glide; the content keeps its
  // own width inside, so it is clipped rather than squashed on the way.
  return (
    <>
      <nav
        className="sidebar"
        data-collapsed={collapsed || undefined}
        data-resizing={resizing || undefined}
        style={{ width: collapsed ? 0 : width }}
        inert={collapsed}
      >
        <div className="sidebar-inner" style={{ width }}>
          <div className="sidebar-workspace">
            <img src={appIcon} alt="" className="sidebar-workspace-icon" />
            <span className="sidebar-workspace-name">AlbaRo Notes</span>
            <button
              type="button"
              className="sidebar-close"
              onClick={() => setCollapsed(true)}
              title="Cerrar barra lateral (Ctrl+\)"
              aria-label="Cerrar barra lateral"
            >
              <ChevronsLeft size={18} />
            </button>
          </div>
          <div className="sidebar-body">
            <button type="button" className="sidebar-item sidebar-search" onClick={onSearch}>
              <Search
                size={16}
                strokeWidth={1.75}
                className="sidebar-item-icon"
                aria-hidden="true"
              />
              <span className="sidebar-item-title">Buscar</span>
              <kbd className="sidebar-hint">Ctrl+K</kbd>
            </button>
            <button type="button" className="sidebar-item sidebar-search" onClick={onAskAi}>
              <Sparkles
                size={16}
                strokeWidth={1.75}
                className="sidebar-item-icon"
                aria-hidden="true"
              />
              <span className="sidebar-item-title">Asistente IA</span>
              <kbd className="sidebar-hint">Ctrl+J</kbd>
            </button>
            {favorites.length > 0 && (
              <>
                <div className="sidebar-header">
                  <button
                    type="button"
                    className="sidebar-fold"
                    aria-expanded={favoritesOpen}
                    onClick={() => setFavoritesOpen((o) => !o)}
                  >
                    <ChevronRight size={13} aria-hidden="true" />
                    Favoritos
                  </button>
                </div>
                <Fold open={favoritesOpen}>
                  <ul className="sidebar-list">{favorites.map(renderNode)}</ul>
                </Fold>
              </>
            )}
            <div className="sidebar-header">
              <button
                type="button"
                className="sidebar-fold"
                aria-expanded={pagesOpen}
                onClick={() => setPagesOpen((o) => !o)}
              >
                <ChevronRight size={13} aria-hidden="true" />
                Páginas
              </button>
              <button
                type="button"
                className="sidebar-add"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  // Keep the menu inside the window: right-aligned to the button, above it if there is no room below.
                  setMenuAt((at) =>
                    at
                      ? null
                      : {
                          top: Math.min(r.bottom + 4, window.innerHeight - MENU_H - 8),
                          left: Math.max(
                            8,
                            Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8),
                          ),
                        },
                  );
                }}
                title="Nueva página"
                aria-label="Nueva página"
                aria-expanded={menuOpen}
              >
                <Plus size={16} />
              </button>
              {menuAt &&
                createPortal(
                  <div
                    className="sidebar-menu"
                    style={menuAt}
                    role="menu"
                    onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}
                  >
                    {(["page", "database"] as const).map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          onCreate(kind);
                        }}
                      >
                        {kind === "page" ? <FileText size={16} /> : <Database size={16} />}
                        {kind === "page" ? "Página" : "Base de datos"}
                      </button>
                    ))}
                  </div>,
                  document.body,
                )}
            </div>
            <Fold open={pagesOpen}>
              <ul className="sidebar-list">{rootPages.map(renderNode)}</ul>
            </Fold>
            {rootDatabases.length > 0 && (
              <>
                <div className="sidebar-header">
                  <button
                    type="button"
                    className="sidebar-fold"
                    aria-expanded={databasesOpen}
                    onClick={() => setDatabasesOpen((o) => !o)}
                  >
                    <ChevronRight size={13} aria-hidden="true" />
                    Bases de datos
                  </button>
                </div>
                <Fold open={databasesOpen}>
                  <ul className="sidebar-list">{rootDatabases.map(renderNode)}</ul>
                </Fold>
              </>
            )}
          </div>
          <div className="sidebar-footer" role="radiogroup" aria-label="Estilo">
            {STYLES.map(({ pref, label, title, Icon }) => (
              <button
                key={pref}
                type="button"
                role="radio"
                aria-checked={style === pref}
                onClick={() => setStylePref(pref)}
                title={title}
              >
                <Icon size={13} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <div
            className="sidebar-footer sidebar-footer--icons"
            role="radiogroup"
            aria-label="Puntero"
          >
            {CURSORS.map(({ pref, label, title, Icon }) => (
              <button
                key={pref}
                type="button"
                role="radio"
                aria-checked={cursor === pref}
                onClick={() => setCursorPref(pref)}
                aria-label={label}
                title={title}
              >
                <Icon size={15} />
              </button>
            ))}
          </div>
          <div className="sidebar-footer" role="radiogroup" aria-label="Tema">
            {THEMES.map(({ pref, label, Icon }) => (
              <button
                key={pref}
                type="button"
                role="radio"
                aria-checked={theme === pref}
                onClick={() => setThemePref(pref)}
                aria-label={label}
                title={pref === "system" ? "Tema del sistema" : `${label} (Ctrl+Shift+L)`}
              >
                <Icon size={15} />
              </button>
            ))}
          </div>
        </div>
        <div
          className="sidebar-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionar barra lateral"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setWidth((w) => clampWidth(w - 16));
            if (e.key === "ArrowRight") setWidth((w) => clampWidth(w + 16));
          }}
        />
      </nav>
      {openButton}
    </>
  );
}
