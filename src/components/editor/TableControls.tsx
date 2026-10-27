import { useEditorState, type Editor } from "@tiptap/react";
import { MAX_TABLE_COLS, MAX_TABLE_ROWS } from "./LimitedTable";

type Grow = "row" | "col" | null;

const ACTIONS: { label: string; grows: Grow; run: (editor: Editor) => void }[] = [
  { label: "Fila ↑", grows: "row", run: (e) => e.chain().focus().addRowBefore().run() },
  { label: "Fila ↓", grows: "row", run: (e) => e.chain().focus().addRowAfter().run() },
  { label: "Columna ←", grows: "col", run: (e) => e.chain().focus().addColumnBefore().run() },
  { label: "Columna →", grows: "col", run: (e) => e.chain().focus().addColumnAfter().run() },
  { label: "Borrar fila", grows: null, run: (e) => e.chain().focus().deleteRow().run() },
  { label: "Borrar columna", grows: null, run: (e) => e.chain().focus().deleteColumn().run() },
  {
    label: "Fila de encabezado",
    grows: null,
    run: (e) => e.chain().focus().toggleHeaderRow().run(),
  },
  { label: "Borrar tabla", grows: null, run: (e) => e.chain().focus().deleteTable().run() },
];

/** Row/column controls, shown while the caret is inside a table. */
export function TableControls({ editor }: { editor: Editor | null }) {
  const size = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const { $from } = e.state.selection;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type.name === "table")
          return { rows: node.childCount, cols: node.firstChild?.childCount ?? 0 };
      }
      return null;
    },
  });
  if (!editor || !size) return null;

  return (
    <div className="table-controls" contentEditable={false} role="toolbar" aria-label="Tabla">
      {ACTIONS.map(({ label, grows, run }) => (
        // mousedown would move focus (and the selection) out of the cell before the click runs.
        <button
          key={label}
          type="button"
          disabled={
            (grows === "row" && size.rows >= MAX_TABLE_ROWS) ||
            (grows === "col" && size.cols >= MAX_TABLE_COLS)
          }
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run(editor)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
