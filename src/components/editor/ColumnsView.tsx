import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from "@tiptap/react";

const MIN_COLUMNS = 2;
const MAX_COLUMNS = 5;

/** Add/remove-column controls for the `columnList` node — the one piece of this block that needs a NodeView. */
export function ColumnsView({ node, editor, getPos }: NodeViewProps) {
  const columnCount = node.childCount;

  const addColumn = () => {
    const pos = getPos();
    if (pos == null || columnCount >= MAX_COLUMNS) return;
    const endOfContent = pos + node.nodeSize - 1;
    editor
      .chain()
      .focus()
      .insertContentAt(endOfContent, { type: "column", content: [{ type: "paragraph" }] })
      .run();
  };

  const removeColumn = () => {
    const pos = getPos();
    const lastChild = node.lastChild;
    if (pos == null || !lastChild || columnCount <= MIN_COLUMNS) return;
    const lastChildStart = pos + node.nodeSize - 1 - lastChild.nodeSize;
    editor
      .chain()
      .focus()
      .deleteRange({ from: lastChildStart, to: lastChildStart + lastChild.nodeSize })
      .run();
  };

  return (
    <NodeViewWrapper className="columns-block">
      <NodeViewContent
        className="columns-grid"
        style={{ "--column-count": columnCount } as React.CSSProperties}
      />
      <div className="columns-controls" contentEditable={false}>
        <button
          type="button"
          onClick={removeColumn}
          disabled={columnCount <= MIN_COLUMNS}
          aria-label="Quitar columna"
        >
          −
        </button>
        <span>{columnCount} columnas</span>
        <button
          type="button"
          onClick={addColumn}
          disabled={columnCount >= MAX_COLUMNS}
          aria-label="Añadir columna"
        >
          +
        </button>
      </div>
    </NodeViewWrapper>
  );
}
