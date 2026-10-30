import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  PanelRight,
  ChevronDown,
  ChevronRight,
  Copy,
  Database as DatabaseIcon,
  GripVertical,
  Plus,
  Trash2,
  Type,
} from "lucide-react";
import {
  addProperty,
  createRow,
  createView,
  deletePage,
  duplicateRow,
  deleteProperty,
  deleteView,
  renameProperty,
  renameSelectOption,
  renameView,
  reorderProperties,
  reorderRows,
  setRowTitle,
  setSelectOptions,
  setValue,
  submitForm,
  updateViewConfig,
} from "../../lib/db-client";
import type {
  CellValue,
  DatabaseRow,
  PageSummary,
  Property,
  PropertyKind,
  ViewConfig,
  ViewKind,
} from "../../types";
import { useEditorAppContext } from "../editor/editor-app-context";
import { Cell } from "./DatabaseCells";
import { handleGridKeyDown } from "./grid-nav";
import { hasDragItem, readDragItem, type DragItem } from "../../lib/drag-item";
import { cellKey, commitOnBlur } from "./cell-commit";
import { useDragReorder } from "./drag-reorder";
import { fitColumn } from "./fit-column";
import { hits, isPageBlank, startMarquee } from "../../lib/marquee";
import { moveItem } from "../../lib/reorder";
import { AddPropertyPanel, PropertyPanel } from "./DatabaseProperties";
import { DatabaseCalendar } from "./DatabaseCalendar";
import { ChartPanel, DatabaseChart } from "./DatabaseChart";
import { DatabaseDashboard } from "./DatabaseDashboard";
import { DatabaseForm, FormBuilder } from "./DatabaseForm";
import { resolveFields } from "./form-fields";
import { DatabaseCards, type Section } from "./DatabaseCards";
import { DatabaseMap } from "./DatabaseMap";
import { DatabaseTimeline } from "./DatabaseTimeline";
import {
  DatePropertyPanel,
  FilterPanel,
  GroupPanel,
  PlacePropertyPanel,
  PropertiesPanel,
  SortPanel,
  ViewSettingsPanel,
  ViewTabs,
} from "./DatabaseViewConfig";
import { PropIcon } from "./PropIcon";
import { typeChoiceOf } from "./property-types";
import { calcLabel, computeCalc } from "./calculations";
import { PropertyMenu, type MenuView } from "./PropertyMenu";
import { useDatabase } from "./useDatabase";
import { TITLE_ID, VIEW_KIND_LABELS, normalizeConfig } from "./view-config";
import "./DatabaseView.css";

const UNTITLED = "Sin título";
// Column widths in px, like Notion's defaults; Rust accepts 60–1000 for a resized column.
const TITLE_WIDTH = 280;
const COLUMN_WIDTH = 200;
const ACTION_WIDTH = 40;
const clampColumn = (w: number) => Math.min(1000, Math.max(60, Math.round(w)));

type Panel =
  | { kind: "add" }
  | { kind: "prop"; id: string }
  | { kind: "view" }
  | { kind: "props" }
  | { kind: "date" }
  | { kind: "place" }
  | { kind: "form" }
  | { kind: "chart" }
  | { kind: "sort" }
  | { kind: "filter" }
  | { kind: "group" };

/** Drag payload of a column header: the property's id. */
const COLUMN_MIME = "application/x-albaro-column";

interface DatabaseTableProps {
  databaseId: string;
  /** Set when shown as a view inside another page: adds a header with «Quitar vista» (drops the view only). */
  onRemove?: () => void;
  /** Which saved view to show. A block passes its own (and `onViewChange` to remember it); a database page leaves both out. */
  viewId?: string | null;
  onViewChange?: (viewId: string) => void;
  /** Rows accept a dropped page or task (the Gestor's task table links pages this way). */
  onDropItem?: (rowId: string, item: DragItem) => void;
}

/**
 * The editable table of one database, through one of its saved views (sort,
 * filter, group). Used both as a view block inside any page (`onRemove` set)
 * and as the body of the database's own page. All data lives in SQLite under
 * `databaseId`; editing here edits the database itself.
 */
export function DatabaseTable({
  databaseId,
  onRemove,
  viewId,
  onViewChange,
  onDropItem,
}: DatabaseTableProps) {
  const [dropRow, setDropRow] = useState<string | null>(null);
  // The view bar's panels float over the table (Notion's menus): a press outside them closes the open one.
  const toolbarWrap = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [columnDrop, setColumnDrop] = useState<{ id: string; side: "left" | "right" } | null>(null);
  const { currentPageId, onNavigate, onPagesChanged } = useEditorAppContext();

  // A block remembers its view in its node; a database page just keeps it while open.
  const [localViewId, setLocalViewId] = useState<string | null>(null);
  const requestedView = onViewChange ? (viewId ?? null) : localViewId;
  const selectView = onViewChange ?? setLocalViewId;

  const { data, view, result, error, run, rowsOf } = useDatabase(databaseId, requestedView);

  const [panel, setPanel] = useState<Panel | null>(null);
  useEffect(() => {
    if (!panel || panel.kind === "form") return; // the form builder is a page, not a menu
    const down = (e: MouseEvent) => {
      const target = e.target as Element;
      if (toolbarWrap.current?.contains(target) || target.closest(".option-pop, .prop-menu"))
        return;
      setPanel(null);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [panel]);
  // The menu of a row's grip (open, duplicate, delete); the row it belongs to is picked.
  const [rowMenu, setRowMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // A form view has two faces, like Notion's: the form itself and the answers (the database's rows).
  const [formTab, setFormTab] = useState<"form" | "responses">("form");
  // A column being dragged: its live width, until the saved config catches up.
  const [dragWidth, setDragWidth] = useState<{ id: string; width: number } | null>(null);
  // The open column menu (Notion's): which column, where it was clicked, and which page of the menu.
  const [menu, setMenu] = useState<{
    column: string;
    anchor: DOMRect;
    view?: MenuView;
    fresh?: boolean;
  } | null>(null);

  // Dragging a row by its grip reorders the database's rows (when no sort or group overrides that order).
  // A selection of rows travels together when one of them is grabbed.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const lastPicked = useRef<string | null>(null);
  const rowReorder = useDragReorder(
    data?.rows.map((r) => r.pageId) ?? [],
    (next) => {
      void run(() => reorderRows(databaseId, next));
    },
    (id) => (selected.has(id) ? [...selected] : [id]),
  );

  // Dragging a band from the blank space around the table ticks the rows it touches (Shift or Ctrl adds to the picked ones).
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  });
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const root = tableRef.current?.closest(".db-root");
      const t = e.target;
      if (!root || !(t instanceof Element)) return;
      // A table inside a page owns only its own blank space; a database page's table also owns the page's.
      const mine = root.contains(t)
        ? t.matches(".db-root, .db-scroll")
        : !!root.closest(".db-page") && isPageBlank(t);
      if (!mine) return;
      const base = new Set(e.shiftKey || e.ctrlKey || e.metaKey ? selectedRef.current : []);
      startMarquee(
        e,
        (box) => {
          const next = new Set(base);
          tableRef.current?.querySelectorAll<HTMLElement>("tr[data-row-id]").forEach((tr) => {
            if (hits(tr, box)) next.add(tr.dataset.rowId!);
          });
          setConfirmBulk(false);
          setSelected((prev) =>
            prev.size === next.size && [...prev].every((id) => next.has(id)) ? prev : next,
          );
        },
        (dragged) => dragged && scrollRef.current?.focus({ preventScroll: true }),
      );
    };
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, []);

  // With rows picked and the focus on the table (not in a cell), Delete asks to remove them and Esc lets go.
  // Captured on the document so a page's editor never sees the key (it would delete its own selection).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target;
      if (!selectedRef.current.size || !(t instanceof Element)) return;
      if (!scrollRef.current?.contains(t) || t.closest("input, textarea, select, [role=combobox]"))
        return;
      if (e.key === "Delete" || e.key === "Backspace") {
        setRowMenu(null);
        setConfirmBulk(true);
      } else if (e.key === "Escape" && !document.querySelector(".handle-menu"))
        setSelected(new Set());
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, []);

  // The row menu closes on a press outside it or Esc.
  useEffect(() => {
    if (!rowMenu) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !(e.target as Element).closest(".handle-menu")
      )
        setRowMenu(null);
    };
    document.addEventListener("mousedown", close, true);
    document.addEventListener("keydown", close, true);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("keydown", close, true);
    };
  }, [rowMenu]);

  if (data === undefined) {
    return (
      <div className="db-root">
        {error ? (
          <p className="db-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="db-loading">Cargando base de datos…</p>
        )}
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="db-root">
        <p className="db-loading">Base de datos eliminada</p>
        {onRemove && (
          <button type="button" className="db-add-row" onClick={onRemove}>
            Quitar vista
          </button>
        )}
      </div>
    );
  }

  const togglePanel = (next: Panel) =>
    setPanel(
      panel?.kind === next.kind && (next.kind !== "prop" || (panel as typeof next).id === next.id)
        ? null
        : next,
    );
  const editing =
    panel?.kind === "prop" ? data.properties.find((p) => p.id === panel.id) : undefined;
  // Inside its own page the title heading above already names it.
  const showHeader = data.pageId !== currentPageId;

  const config = normalizeConfig(view?.config);
  const saveConfig = (next: ViewConfig) => {
    if (view) void run(() => updateViewConfig(view.id, next));
  };
  const hiddenIds = new Set(config.hiddenProperties ?? []);
  // New properties appear everywhere by default: a view stores what it *hides*.
  const visibleProps = data.properties.filter((p) => !hiddenIds.has(p.id));
  const active = {
    props: data.properties.filter((p) => hiddenIds.has(p.id)).length,
    sort: config.sorts.length,
    filter: config.filter.rules.length,
    group: config.group ? 1 : 0,
  };

  // The view (Rust) decides which rows, in which order and groups; we map ids back to the rows.
  const byId = new Map(data.rows.map((r) => [r.pageId, r]));
  const rowsFor = (ids: string[]) =>
    ids.map((id) => byId.get(id)).filter((r): r is DatabaseRow => !!r);
  const shown = result ? rowsFor(result.rowIds) : data.rows;
  const groups = result?.groups?.map((g) => ({ ...g, rows: rowsFor(g.rowIds) })) ?? null;

  const addRow = () =>
    run(async () => {
      await createRow(databaseId);
      onPagesChanged();
    });

  // Only rows that still exist count as selected (a deleted row may linger in the set).
  const picked = data.rows.map((r) => r.pageId).filter((id) => selected.has(id));
  const clearPicked = () => {
    setSelected(new Set());
    setConfirmBulk(false);
    lastPicked.current = null;
  };
  // Ticks a row; with Shift, everything between it and the last ticked row, in the order on screen.
  const pick = (id: string, on: boolean, range: boolean) => {
    const shownIds =
      groups && kind !== "form"
        ? groups.flatMap((g) => (collapsed.has(g.key) ? [] : g.rows.map((r) => r.pageId)))
        : tableRows.map((r) => r.pageId);
    const a = range && lastPicked.current ? shownIds.indexOf(lastPicked.current) : -1;
    const b = shownIds.indexOf(id);
    const ids = a >= 0 && b >= 0 ? shownIds.slice(Math.min(a, b), Math.max(a, b) + 1) : [id];
    const next = new Set(selected);
    for (const i of ids) {
      if (on) next.add(i);
      else next.delete(i);
    }
    lastPicked.current = id;
    setSelected(next);
    setConfirmBulk(false);
  };
  const removePicked = () =>
    run(async () => {
      for (const id of picked) await deletePage(id);
      clearPicked();
      onPagesChanged();
    });

  // The grip's click: it picks the row (Shift: the range up to it, Ctrl: adds or removes it) and, on a plain
  // click, opens the menu. The focus moves to the table so Delete reaches it.
  const gripClick = (e: React.MouseEvent<HTMLElement>, id: string) => {
    if (e.shiftKey) pick(id, true, true);
    else if (e.ctrlKey || e.metaKey) pick(id, !selected.has(id), false);
    else {
      setSelected(new Set([id]));
      setConfirmBulk(false);
      lastPicked.current = id;
      const r = e.currentTarget.getBoundingClientRect();
      setRowMenu({
        id,
        x: Math.min(r.left, window.innerWidth - 176),
        y: Math.min(r.bottom + 4, window.innerHeight - 120),
      });
    }
    scrollRef.current?.focus({ preventScroll: true });
  };
  // «+» on a row adds one under it (in the database's own order; with a sort or a group it lands at the end).
  const addBelow = (id: string, ordered: boolean) =>
    run(async () => {
      const created = await createRow(databaseId);
      if (ordered) {
        const ids = [...data.rows.map((r) => r.pageId), created.id];
        await reorderRows(databaseId, moveItem(ids, created.id, id, true));
      }
      onPagesChanged();
    });
  const duplicate = (id: string) =>
    run(async () => {
      await duplicateRow(id);
      onPagesChanged();
    });

  const addProp = (name: string, kind: PropertyKind, config: Property["config"]) =>
    run(async () => {
      await addProperty(databaseId, name, kind, config);
      setPanel(null);
    });

  const moveProp = (id: string, by: -1 | 1) => {
    const ids = data.properties.map((p) => p.id);
    const from = ids.indexOf(id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    void run(() => reorderProperties(databaseId, ids));
  };

  // Dragging a column header to another place reorders the columns (the same order the «Mover» buttons write).
  const dropColumn = (movedId: string, targetId: string, side: "left" | "right") => {
    if (movedId === targetId) return;
    const ids = data.properties.map((p) => p.id).filter((id) => id !== movedId);
    const at = ids.indexOf(targetId);
    if (at < 0) return;
    ids.splice(side === "left" ? at : at + 1, 0, movedId);
    void run(() => reorderProperties(databaseId, ids));
  };

  const addView = (kind: ViewKind) =>
    run(async () => {
      const created = await createView(databaseId, VIEW_KIND_LABELS[kind], kind);
      selectView(created.id);
      setPanel({ kind: "view" });
    });

  // A board's columns: the select the view groups by (Rust refuses anything else).
  const boardProp = config.group
    ? (data.properties.find((p) => p.id === config.group!.property && p.type === "select") ?? null)
    : null;
  const sections: Section[] = groups
    ? groups.map((g) => ({ key: g.key, label: g.label, rows: g.rows }))
    : [{ key: "", label: null, rows: shown }];
  const toggleSection = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  // Calendar / timeline: laid out by a date property (the first one unless the view picked another).
  const dateProps = data.properties.filter((p) => p.type === "date");
  const dateProp = dateProps.find((p) => p.id === config.dateProperty) ?? dateProps[0] ?? null;
  const addOnDay = (iso: string) =>
    run(async () => {
      const row = await createRow(databaseId);
      if (dateProp) await setValue(row.id, dateProp.id, iso);
      onPagesChanged();
    });
  // Map: pins come from a place property (the first one unless the view picked another).
  const placeProps = data.properties.filter((p) => p.type === "place");
  const placeProp = placeProps.find((p) => p.id === config.placeProperty) ?? placeProps[0] ?? null;
  const addPinAt = (lat: number, lng: number) =>
    run(async () => {
      const row = await createRow(databaseId);
      if (placeProp)
        await setValue(row.id, placeProp.id, {
          name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          lat,
          lng,
        });
      onPagesChanged();
    });
  const addToColumn = (columnKey: string) =>
    run(async () => {
      const row = await createRow(databaseId);
      if (columnKey && boardProp) await setValue(row.id, boardProp.id, columnKey);
      onPagesChanged();
    });

  const renderRow = (row: DatabaseRow, key: string) => {
    const title = row.title === UNTITLED ? "" : row.title;
    // The title lives in the row page's first heading; Rust rewrites it.
    const titleField = {
      maxLength: 200,
      defaultValue: title,
      placeholder: UNTITLED,
      "aria-label": `Título de la fila ${row.title}`,
      ...commitOnBlur(
        title,
        (v) => run(() => setRowTitle(row.pageId, String(v ?? ""))),
        (raw) => raw,
      ),
    };
    // A sort or a group decides the order on screen, so there is nothing to drag into.
    const reorderRow =
      kind === "table" && config.sorts.length === 0 && !config.group
        ? rowReorder.row(row.pageId)
        : null;
    return (
      <tr
        key={key}
        data-grid-row
        data-row-id={row.pageId}
        data-reorder-row={reorderRow ? "" : undefined}
        data-drop={dropRow === row.pageId ? "true" : reorderRow?.["data-drop"]}
        data-selected={selected.has(row.pageId) || undefined}
        onDragOver={(e) => {
          reorderRow?.onDragOver(e);
          if (!onDropItem || !hasDragItem(e)) return;
          e.preventDefault(); // this row accepts it
          setDropRow(row.pageId);
        }}
        onDragLeave={onDropItem && (() => setDropRow((r) => (r === row.pageId ? null : r)))}
        onDrop={(e) => {
          reorderRow?.onDrop(e);
          if (!onDropItem) return;
          const item = readDragItem(e);
          setDropRow(null);
          if (!item) return;
          e.preventDefault();
          onDropItem(row.pageId, item);
        }}
      >
        <td {...stickyOf(0)} data-wrap={wrappedIds.has(TITLE_ID) || undefined}>
          <div className="db-row-title-cell">
            {kind === "table" && (
              <button
                type="button"
                className="db-row-add"
                title="Añadir una fila debajo"
                aria-label={`Añadir una fila debajo de ${row.title}`}
                onClick={() => void addBelow(row.pageId, reorderRow !== null)}
              >
                <Plus size={14} aria-hidden="true" />
              </button>
            )}
            <input
              type="checkbox"
              className="db-row-check"
              checked={selected.has(row.pageId)}
              readOnly
              aria-label={`Seleccionar ${row.title}`}
              onClick={(e) => pick(row.pageId, e.currentTarget.checked, e.shiftKey)}
            />
            <span
              className="db-row-grip"
              title={
                reorderRow
                  ? "Arrastra para mover; pulsa para ver las opciones"
                  : "Opciones de la fila"
              }
              role="button"
              aria-label={`Opciones de ${row.title}`}
              {...(reorderRow ? rowReorder.handle(row.pageId) : {})}
              onClick={(e) => gripClick(e, row.pageId)}
            >
              <GripVertical size={14} aria-hidden="true" />
            </span>
            {wrappedIds.has(TITLE_ID) ? (
              <textarea key={row.title} className="db-input db-wrap" rows={1} {...titleField} />
            ) : (
              <input key={row.title} className="db-input" type="text" {...titleField} />
            )}
            <button
              type="button"
              className="db-icon-btn db-open-btn"
              aria-label={`Abrir ${row.title}`}
              title="Abrir"
              onClick={() => onNavigate(row.pageId)}
            >
              <PanelRight size={13} strokeWidth={1.75} aria-hidden="true" />
              Abrir
            </button>
          </div>
        </td>
        {tableProps.map((p, i) => {
          const value = row.values[p.id];
          return (
            <td key={p.id} {...stickyOf(i + 1)} data-wrap={wrappedIds.has(p.id) || undefined}>
              <Cell
                key={cellKey(p, value)}
                prop={p}
                value={value}
                wrap={wrappedIds.has(p.id)}
                targetRows={p.type === "relation" ? rowsOf(p) : []}
                commit={(v: CellValue | null) => run(() => setValue(row.pageId, p.id, v))}
              />
            </td>
          );
        })}
        <td className="db-col-action" />
      </tr>
    );
  };

  const kind = view?.type ?? "table";
  // The answers table shows the form's own questions, newest first; a plain table shows the view's visible properties.
  const responses = kind === "form" && formTab === "responses";
  const tableProps =
    kind === "form"
      ? resolveFields(config.form, data.properties)
          .filter((f) => f.prop.id !== TITLE_ID)
          .map((f) => f.prop)
      : visibleProps;
  const tableRows = kind === "form" ? [...shown].reverse() : shown;
  const columns = tableProps.length + 2;

  const widthOf = (id: string) =>
    dragWidth?.id === id
      ? dragWidth.width
      : (config.columnWidths?.[id] ?? (id === TITLE_ID ? TITLE_WIDTH : COLUMN_WIDTH));
  const tableWidth =
    widthOf(TITLE_ID) + tableProps.reduce((sum, p) => sum + widthOf(p.id), 0) + ACTION_WIDTH;
  // Dragging a header's right edge resizes its column live; the view's config is written once, on release.
  const startColumnResize = (id: string) => (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!view) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = widthOf(id);
    let width = startWidth;
    const onMove = (ev: PointerEvent) => {
      width = clampColumn(startWidth + ev.clientX - startX);
      setDragWidth({ id, width });
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      if (width === startWidth) return setDragWidth(null);
      const next = { ...config, columnWidths: { ...config.columnWidths, [id]: width } };
      void run(() => updateViewConfig(view.id, next)).then(() => setDragWidth(null));
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };
  // A double click on the edge fits the column to its widest content (and writes it once, like a drag).
  const fitColumnTo = (id: string) => {
    const table = tableRef.current;
    if (!view || !table) return;
    const width = clampColumn(
      fitColumn(table, [TITLE_ID, ...tableProps.map((p) => p.id)].indexOf(id)),
    );
    if (width === widthOf(id)) return;
    const next = { ...config, columnWidths: { ...config.columnWidths, [id]: width } };
    void run(() => updateViewConfig(view.id, next));
  };
  const resizeHandle = (id: string, name: string) => (
    <span
      className="db-col-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Ancho de la columna ${name}`}
      title="Arrastrar para cambiar el ancho; doble clic para ajustarlo al contenido"
      onPointerDown={startColumnResize(id)}
      onDoubleClick={() => fitColumnTo(id)}
    />
  );

  // «Fijar»: the columns up to the frozen one stick to the left while the table scrolls sideways.
  const order = [TITLE_ID, ...tableProps.map((p) => p.id)];
  const frozenIndex = config.frozenUpTo ? order.indexOf(config.frozenUpTo) : -1;
  const stickyOf = (index: number): { style?: CSSProperties; className?: string } => {
    if (index > frozenIndex) return {};
    const left = order.slice(0, index).reduce((sum, id) => sum + widthOf(id), 0);
    return {
      style: { position: "sticky", left, zIndex: 1 },
      className: index === frozenIndex ? "db-frozen db-frozen-edge" : "db-frozen",
    };
  };
  const wrappedIds = new Set(config.wrapped ?? []);
  const openMenu = (column: string, el: Element, menuView?: MenuView) =>
    setMenu(
      menu?.column === column && menu.view === menuView
        ? null
        : { column, anchor: el.getBoundingClientRect(), view: menuView },
    );
  // «+» in the header adds a text column and opens its menu, name selected, to rename or retype it.
  const addColumn = (el: Element) => {
    const anchor = el.getBoundingClientRect();
    let id = "";
    void run(async () => {
      id = (await addProperty(databaseId, "Texto", "text")).id;
    }).then((ok) => ok && setMenu({ column: id, anchor, fresh: true }));
  };

  return (
    <div className="db-root">
      {showHeader && (
        <div className="db-header">
          <DatabaseIcon size={14} strokeWidth={1.75} aria-hidden="true" />
          <button
            type="button"
            className="db-title"
            title="Abrir la base de datos"
            onClick={() => onNavigate(data.pageId)}
          >
            {data.name}
          </button>
          {onRemove && (
            <span className="db-header-actions">
              <button
                type="button"
                onClick={onRemove}
                title="Quitar esta vista de la página (la base de datos no se borra)"
              >
                Quitar vista
              </button>
            </span>
          )}
        </div>
      )}

      {error && (
        <p className="db-error" role="alert">
          {error}
        </p>
      )}

      {view && (
        <>
          <ViewTabs
            views={data.views}
            activeId={view.id}
            settingsOpen={panel?.kind === "view"}
            onSelect={(id) => {
              selectView(id);
              setPanel(null);
            }}
            onToggleSettings={() => togglePanel({ kind: "view" })}
            onAdd={(kind) => void addView(kind)}
            onDelete={(v) => {
              if (!window.confirm(`¿Borrar la vista «${v.name}»? Los datos no se borran.`)) return;
              void run(async () => {
                await deleteView(v.id);
                if (v.id === view.id) {
                  setPanel(null);
                  selectView(data.views.find((o) => o.id !== v.id)!.id);
                }
              });
            }}
          />
          <div className="db-toolbar-wrap" ref={toolbarWrap}>
            <div className="db-toolbar" role="toolbar" aria-label="Ordenar, filtrar y agrupar">
              {(kind === "form"
                ? ([["form", "Editar formulario", 0]] as const)
                : kind === "dashboard"
                  ? ([["filter", "Filtrar", active.filter]] as const)
                  : kind === "chart"
                    ? ([
                        ["chart", "Gráfico", 0],
                        ...(config.chart?.type === "number"
                          ? []
                          : ([["group", "Eje X", active.group]] as const)),
                        ["filter", "Filtrar", active.filter],
                      ] as const)
                    : ([
                        ["props", "Propiedades", active.props],
                        ...(kind === "calendar" || kind === "timeline"
                          ? ([["date", "Fecha", config.dateProperty ? 1 : 0]] as const)
                          : []),
                        ...(kind === "map"
                          ? ([["place", "Lugar", config.placeProperty ? 1 : 0]] as const)
                          : []),
                        ["sort", "Ordenar", active.sort],
                        ["filter", "Filtrar", active.filter],
                        // calendar, timeline and map lay rows out by date / place, so grouping them makes no sense
                        ...(kind === "calendar" || kind === "timeline" || kind === "map"
                          ? []
                          : ([["group", "Agrupar", active.group]] as const)),
                      ] as const)
              ).map(([toolKind, label, count]) => (
                <button
                  key={toolKind}
                  type="button"
                  className="db-tool"
                  aria-expanded={panel?.kind === toolKind}
                  data-active={count > 0}
                  onClick={() => togglePanel({ kind: toolKind })}
                >
                  {label}
                  {count > 0 && <span className="db-tool-count">{count}</span>}
                </button>
              ))}
            </div>
            {panel?.kind === "view" && (
              <ViewSettingsPanel
                key={view.id}
                view={view}
                canDelete={data.views.length > 1}
                onRename={(name) => void run(() => renameView(view.id, name))}
                onDelete={() =>
                  void run(async () => {
                    await deleteView(view.id);
                    setPanel(null);
                    selectView(data.views.find((v) => v.id !== view.id)!.id);
                  })
                }
                onClose={() => setPanel(null)}
              />
            )}
            {panel?.kind === "sort" && (
              <SortPanel config={config} properties={data.properties} onChange={saveConfig} />
            )}
            {panel?.kind === "filter" && (
              <FilterPanel
                config={config}
                properties={data.properties}
                rowsOf={rowsOf}
                onChange={saveConfig}
              />
            )}
            {panel?.kind === "group" && (
              <GroupPanel
                config={config}
                properties={data.properties}
                kind={kind}
                onChange={saveConfig}
              />
            )}
            {panel?.kind === "date" && (
              <DatePropertyPanel
                config={config}
                properties={data.properties}
                onChange={saveConfig}
                onAdd={() => setPanel({ kind: "add" })}
              />
            )}
            {panel?.kind === "place" && (
              <PlacePropertyPanel
                config={config}
                properties={data.properties}
                onChange={saveConfig}
                onAdd={() => setPanel({ kind: "add" })}
              />
            )}
            {panel?.kind === "chart" && (
              <ChartPanel config={config} properties={data.properties} onChange={saveConfig} />
            )}
            {panel?.kind === "form" && (
              <FormBuilder database={data} config={config} onChange={saveConfig} />
            )}
            {panel?.kind === "props" && (
              <PropertiesPanel
                config={config}
                properties={data.properties}
                kind={kind}
                onChange={saveConfig}
                onEdit={(id) => setPanel({ kind: "prop", id })}
                onAdd={() => setPanel({ kind: "add" })}
              />
            )}
          </div>
        </>
      )}

      {kind === "form" && (
        <div className="db-toolbar" role="toolbar" aria-label="Formulario y respuestas">
          <button
            type="button"
            className="db-tool"
            aria-pressed={!responses}
            onClick={() => setFormTab("form")}
          >
            Formulario
          </button>
          <button
            type="button"
            className="db-tool"
            aria-pressed={responses}
            onClick={() => setFormTab("responses")}
          >
            Respuestas
            <span className="db-tool-count">{data.rows.length}</span>
          </button>
        </div>
      )}
      {kind === "form" && view && !responses && (
        <DatabaseForm
          key={view.id}
          database={data}
          config={config}
          rowsOf={rowsOf}
          onOpenRow={onNavigate}
          onSubmit={async (values) => {
            let created: PageSummary | null = null;
            const ok = await run(async () => {
              created = await submitForm(view.id, values);
              onPagesChanged();
            });
            return ok ? created : null;
          }}
        />
      )}
      {kind === "dashboard" && (
        <DatabaseDashboard
          config={config}
          result={result}
          properties={data.properties}
          rowsOf={rowsOf}
          onChange={saveConfig}
        />
      )}
      {kind === "chart" && (
        <DatabaseChart config={config} result={result} properties={data.properties} />
      )}
      {kind === "calendar" && (
        <DatabaseCalendar
          rows={shown}
          dateProp={dateProp}
          onOpen={onNavigate}
          onAddOn={(iso) => void addOnDay(iso)}
        />
      )}
      {kind === "timeline" && (
        <DatabaseTimeline rows={shown} dateProp={dateProp} onOpen={onNavigate} />
      )}
      {kind === "map" && (
        <DatabaseMap
          rows={shown}
          placeProp={placeProp}
          onOpen={onNavigate}
          onAddAt={(lat, lng) => void addPinAt(lat, lng)}
        />
      )}
      {kind !== "table" &&
        kind !== "calendar" &&
        kind !== "timeline" &&
        kind !== "map" &&
        kind !== "form" &&
        kind !== "chart" &&
        kind !== "dashboard" && (
          <DatabaseCards
            kind={kind}
            sections={sections}
            properties={visibleProps}
            previews={result?.previews ?? null}
            rowsOf={rowsOf}
            onOpen={onNavigate}
            collapsed={collapsed}
            onToggle={toggleSection}
            onCommit={(pageId, propertyId, value) => run(() => setValue(pageId, propertyId, value))}
            board={{ property: boardProp, onAdd: (key) => void addToColumn(key) }}
          />
        )}
      {(kind === "table" || responses) && picked.length > 0 && (
        <div className="db-bulk" role="toolbar" aria-label="Filas seleccionadas">
          <span>
            {picked.length} {picked.length === 1 ? "fila seleccionada" : "filas seleccionadas"}
          </span>
          {confirmBulk ? (
            <span className="db-confirm">
              ¿Borrar {picked.length === 1 ? "la fila" : `las ${picked.length} filas`}?
              <button type="button" autoFocus onClick={() => void removePicked()}>
                Borrar
              </button>
              <button type="button" onClick={() => setConfirmBulk(false)}>
                No
              </button>
            </span>
          ) : (
            <>
              <button type="button" onClick={() => setConfirmBulk(true)}>
                <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" /> Borrar
              </button>
              <button type="button" onClick={clearPicked}>
                Deseleccionar
              </button>
            </>
          )}
        </div>
      )}
      {rowMenu &&
        createPortal(
          <div className="handle-menu" role="menu" style={{ left: rowMenu.x, top: rowMenu.y }}>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setRowMenu(null);
                onNavigate(rowMenu.id);
              }}
            >
              <PanelRight size={14} aria-hidden="true" /> Abrir
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setRowMenu(null);
                void duplicate(rowMenu.id);
              }}
            >
              <Copy size={14} aria-hidden="true" /> Duplicar
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setRowMenu(null);
                setConfirmBulk(true);
              }}
            >
              <Trash2 size={14} aria-hidden="true" /> Borrar
            </button>
          </div>,
          document.body,
        )}
      {(kind === "table" || responses) && (
        <div
          className="db-scroll"
          ref={scrollRef}
          tabIndex={-1}
          data-picking={picked.length > 0 || undefined}
        >
          <table
            ref={tableRef}
            className="db-table"
            style={{ width: tableWidth }}
            onKeyDown={handleGridKeyDown}
          >
            <colgroup>
              <col style={{ width: widthOf(TITLE_ID) }} />
              {tableProps.map((p) => (
                <col key={p.id} style={{ width: widthOf(p.id) }} />
              ))}
              <col style={{ width: ACTION_WIDTH }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" {...stickyOf(0)}>
                  <button
                    type="button"
                    className="db-prop-name"
                    aria-haspopup="menu"
                    aria-expanded={menu?.column === TITLE_ID && !menu.view}
                    onClick={(e) => openMenu(TITLE_ID, e.currentTarget)}
                  >
                    <Type size={14} strokeWidth={1.75} aria-hidden="true" />
                    <span className="db-prop-label">Nombre</span>
                  </button>
                  {resizeHandle(TITLE_ID, "Nombre")}
                </th>
                {tableProps.map((p, i) => {
                  return (
                    <th
                      key={p.id}
                      scope="col"
                      {...stickyOf(i + 1)}
                      data-col-drop={columnDrop?.id === p.id ? columnDrop.side : undefined}
                      draggable={kind !== "form"}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(COLUMN_MIME, p.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        if (!e.dataTransfer.types.includes(COLUMN_MIME)) return;
                        e.preventDefault();
                        const box = e.currentTarget.getBoundingClientRect();
                        setColumnDrop({
                          id: p.id,
                          side: e.clientX < box.left + box.width / 2 ? "left" : "right",
                        });
                      }}
                      onDragLeave={() => setColumnDrop((d) => (d?.id === p.id ? null : d))}
                      onDragEnd={() => setColumnDrop(null)}
                      onDrop={(e) => {
                        const moved = e.dataTransfer.getData(COLUMN_MIME);
                        const side = columnDrop?.id === p.id ? columnDrop.side : "right";
                        setColumnDrop(null);
                        if (!moved) return;
                        e.preventDefault();
                        dropColumn(moved, p.id, side);
                      }}
                    >
                      <button
                        type="button"
                        className="db-prop-name"
                        aria-haspopup="menu"
                        aria-expanded={menu?.column === p.id && !menu.view}
                        title={typeChoiceOf(p).label}
                        onClick={(e) => openMenu(p.id, e.currentTarget)}
                      >
                        <PropIcon prop={p} />
                        <span className="db-prop-label">{p.name}</span>
                      </button>
                      {resizeHandle(p.id, p.name)}
                    </th>
                  );
                })}
                <th scope="col" className="db-col-action">
                  <button
                    type="button"
                    className="db-icon-btn"
                    aria-label="Añadir propiedad"
                    title="Añadir propiedad"
                    onClick={(e) => addColumn(e.currentTarget)}
                  >
                    <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {groups && kind !== "form"
                ? groups.map((g) => {
                    const closed = collapsed.has(g.key);
                    return (
                      <Fragment key={g.key || "__none__"}>
                        <tr className="db-group-row">
                          <td colSpan={columns}>
                            <button
                              type="button"
                              className="db-group-toggle"
                              aria-expanded={!closed}
                              onClick={() =>
                                setCollapsed((prev) => {
                                  const next = new Set(prev);
                                  if (closed) next.delete(g.key);
                                  else next.add(g.key);
                                  return next;
                                })
                              }
                            >
                              {closed ? (
                                <ChevronRight size={14} aria-hidden="true" />
                              ) : (
                                <ChevronDown size={14} aria-hidden="true" />
                              )}
                              <span className="db-group-label">{g.label}</span>
                              <span className="db-tool-count">{g.rows.length}</span>
                            </button>
                          </td>
                        </tr>
                        {!closed && g.rows.map((row) => renderRow(row, `${g.key}:${row.pageId}`))}
                      </Fragment>
                    );
                  })
                : tableRows.map((row) => renderRow(row, row.pageId))}
            </tbody>
            {/* Notion's «Calcular» row: each column's calculation over the rows the view shows. */}
            <tfoot>
              <tr>
                {order.map((id, i) => {
                  const calc = config.calculations?.[id];
                  const values =
                    id === TITLE_ID
                      ? tableRows.map((r) => (r.title === UNTITLED ? "" : r.title))
                      : tableRows.map((r) => r.values[id]);
                  return (
                    <td key={id} {...stickyOf(i)}>
                      <button
                        type="button"
                        className="db-calc-cell"
                        data-set={calc ? true : undefined}
                        aria-haspopup="menu"
                        onClick={(e) => openMenu(id, e.currentTarget, "calc")}
                      >
                        {calc ? (
                          <>
                            <span className="db-calc-label">
                              {
                                calcLabel(
                                  calc,
                                  data.properties.find((p) => p.id === id)?.type ?? "text",
                                ).short
                              }
                            </span>
                            {computeCalc(calc, values)}
                          </>
                        ) : (
                          "Calcular"
                        )}
                      </button>
                    </td>
                  );
                })}
                <td className="db-col-action" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {responses && data.rows.length === 0 && (
        <p className="db-loading">Todavía no hay respuestas.</p>
      )}
      {kind !== "form" &&
        kind !== "chart" &&
        kind !== "dashboard" &&
        !groups &&
        shown.length === 0 &&
        data.rows.length > 0 && (
          <p className="db-loading">Ninguna fila cumple los filtros de esta vista.</p>
        )}

      {menu && view && (
        <PropertyMenu
          key={`${menu.column}:${menu.view ?? ""}`}
          anchor={menu.anchor}
          column={menu.column}
          startView={menu.view}
          fresh={menu.fresh}
          data={data}
          config={config}
          viewKind={kind}
          run={run}
          onConfig={saveConfig}
          onOpenFilter={() => setPanel({ kind: "filter" })}
          onOpenColumn={(id) => setMenu({ column: id, anchor: menu.anchor, fresh: true })}
          onClose={() => setMenu(null)}
        />
      )}
      {panel?.kind === "add" && <AddPropertyPanel onAdd={addProp} onClose={() => setPanel(null)} />}
      {editing && (
        <PropertyPanel
          key={editing.id}
          prop={editing}
          position={{ index: data.properties.indexOf(editing), count: data.properties.length }}
          onRename={(name) => void run(() => renameProperty(editing.id, name))}
          onOptions={(options) => void run(() => setSelectOptions(editing.id, options))}
          onRenameOption={(from, to) => run(() => renameSelectOption(editing.id, from, to))}
          onMove={(by) => moveProp(editing.id, by)}
          onDelete={() =>
            void run(async () => {
              await deleteProperty(editing.id);
              setPanel(null);
            })
          }
          onClose={() => setPanel(null)}
        />
      )}

      {kind !== "form" && kind !== "chart" && kind !== "dashboard" && (
        <button type="button" className="db-add-row" onClick={() => void addRow()}>
          <Plus size={14} strokeWidth={1.75} aria-hidden="true" /> Nueva fila
        </button>
      )}
    </div>
  );
}
