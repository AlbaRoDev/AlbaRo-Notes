import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { GripHorizontal, GripVertical, Plus } from "lucide-react";
import { MAX_TABLE_COLS, MAX_TABLE_ROWS } from "./LimitedTable";

interface Hover {
  table: HTMLTableElement;
  row: number;
  col: number;
}

interface Menu {
  kind: "row" | "col";
  hover: Hover;
  x: number;
  y: number;
}

/** How far outside the table the pointer can go (to reach a handle) before they hide. */
const REACH = 28;

/**
 * Notion's table handles, in place of a row of buttons: pointing at a cell shows a grip left of its row and one
 * above its column (each opens a menu: insert, delete, header), and a «+» strip under the table and one to its right
 * add a row or a column at the end. Drawn on the body at the table's place; they hide when the page scrolls.
 */
export function TableControls({ editor }: { editor: Editor | null }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuRef = useRef(menu);
  useEffect(() => {
    menuRef.current = menu;
  });

  // Which cell the pointer is over; near the table (on the way to a handle) the last one stays.
  useEffect(() => {
    if (!editor) return;
    const move = (e: MouseEvent) => {
      if (menuRef.current) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest(".table-ui")) return;
      const cell = t?.closest("td, th");
      const table = cell?.closest("table");
      if (cell instanceof HTMLTableCellElement && table && editor.view.dom.contains(table)) {
        const row = (cell.parentElement as HTMLTableRowElement).rowIndex;
        setHover((h) =>
          h?.table === table && h.row === row && h.col === cell.cellIndex
            ? h
            : { table, row, col: cell.cellIndex },
        );
        return;
      }
      setHover((h) => {
        if (!h) return h;
        const r = h.table.getBoundingClientRect();
        const near =
          e.clientX > r.left - REACH &&
          e.clientX < r.right + REACH &&
          e.clientY > r.top - REACH &&
          e.clientY < r.bottom + REACH;
        return near ? h : null;
      });
    };
    const hide = () => !menuRef.current && setHover(null);
    document.addEventListener("mousemove", move);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("mousemove", move);
      window.removeEventListener("scroll", hide, true);
    };
  }, [editor]);

  // The menu closes on a press outside it or Esc.
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !(e.target as Element).closest(".handle-menu")
      )
        setMenu(null);
    };
    document.addEventListener("mousedown", close, true);
    document.addEventListener("keydown", close, true);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("keydown", close, true);
    };
  }, [menu]);

  if (!editor || !hover || !hover.table.isConnected) return null;

  const { table } = hover;
  const rows = table.rows.length;
  const cols = table.rows[0]?.cells.length ?? 0;
  const box = table.getBoundingClientRect();
  const wrapper = table.closest(".tableWrapper")?.getBoundingClientRect() ?? box;
  const right = Math.min(box.right, wrapper.right);
  const rowBox = table.rows[hover.row]?.getBoundingClientRect();
  const cellBox = table.rows[hover.row]?.cells[hover.col]?.getBoundingClientRect();
  if (!rowBox || !cellBox) return null;

  // The table commands work on the cell the cursor is in, so the cursor goes to that cell first.
  const at = (row: number, col: number) => {
    const cell = table.rows[row]?.cells[Math.min(col, table.rows[row].cells.length - 1)];
    if (!cell) return editor.chain();
    const pos = editor.view.posAtDOM(cell, 0);
    const { tr, doc } = editor.state;
    editor.view.dispatch(tr.setSelection(TextSelection.near(doc.resolve(pos))));
    return editor.chain().focus();
  };
  const run = (go: () => void) => {
    go();
    setMenu(null);
    setHover(null);
  };
  const openMenu = (kind: "row" | "col", e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({
      kind,
      hover,
      x: Math.min(r.left, window.innerWidth - 230),
      y: Math.min(r.bottom + 4, window.innerHeight - 220),
    });
  };

  const items =
    menu?.kind === "row"
      ? [
          {
            label: "Insertar fila encima",
            off: rows >= MAX_TABLE_ROWS,
            go: () => at(menu.hover.row, 0).addRowBefore().run(),
          },
          {
            label: "Insertar fila debajo",
            off: rows >= MAX_TABLE_ROWS,
            go: () => at(menu.hover.row, 0).addRowAfter().run(),
          },
          ...(menu.hover.row === 0
            ? [
                {
                  label: "Fila de encabezado",
                  off: false,
                  go: () => at(0, 0).toggleHeaderRow().run(),
                },
              ]
            : []),
          {
            label: "Borrar fila",
            off: rows <= 1,
            go: () => at(menu.hover.row, 0).deleteRow().run(),
          },
        ]
      : menu
        ? [
            {
              label: "Insertar columna a la izquierda",
              off: cols >= MAX_TABLE_COLS,
              go: () => at(0, menu.hover.col).addColumnBefore().run(),
            },
            {
              label: "Insertar columna a la derecha",
              off: cols >= MAX_TABLE_COLS,
              go: () => at(0, menu.hover.col).addColumnAfter().run(),
            },
            ...(menu.hover.col === 0
              ? [
                  {
                    label: "Columna de encabezado",
                    off: false,
                    go: () => at(0, 0).toggleHeaderColumn().run(),
                  },
                ]
              : []),
            {
              label: "Borrar columna",
              off: cols <= 1,
              go: () => at(0, menu.hover.col).deleteColumn().run(),
            },
          ]
        : [];

  return createPortal(
    <div className="table-ui" contentEditable={false}>
      <button
        type="button"
        className="table-ui-grip"
        // on the table's left border, as Notion's (the block's own handle is further left)
        style={{ left: box.left - 6, top: rowBox.top + rowBox.height / 2 - 10 }}
        title="Opciones de la fila"
        aria-label="Opciones de la fila"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => openMenu("row", e)}
      >
        <GripVertical size={12} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="table-ui-grip table-ui-grip-col"
        style={{ left: cellBox.left + cellBox.width / 2 - 10, top: box.top - 6 }}
        title="Opciones de la columna"
        aria-label="Opciones de la columna"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => openMenu("col", e)}
      >
        <GripHorizontal size={12} aria-hidden="true" />
      </button>
      {rows < MAX_TABLE_ROWS && (
        <button
          type="button"
          className="table-ui-add"
          style={{ left: box.left, top: box.bottom + 2, width: right - box.left, height: 16 }}
          title="Añadir una fila"
          aria-label="Añadir una fila"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            run(() =>
              at(rows - 1, 0)
                .addRowAfter()
                .run(),
            )
          }
        >
          <Plus size={13} aria-hidden="true" />
        </button>
      )}
      {cols < MAX_TABLE_COLS && (
        <button
          type="button"
          className="table-ui-add"
          style={{ left: right + 2, top: box.top, width: 16, height: box.height }}
          title="Añadir una columna"
          aria-label="Añadir una columna"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            run(() =>
              at(0, cols - 1)
                .addColumnAfter()
                .run(),
            )
          }
        >
          <Plus size={13} aria-hidden="true" />
        </button>
      )}
      {menu && (
        <div className="handle-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          {items.map(({ label, off, go }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              disabled={off}
              onClick={() => run(go)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => run(() => at(0, 0).deleteTable().run())}
          >
            Borrar tabla
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
