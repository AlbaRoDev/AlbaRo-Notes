import { useRef, useState, type DragEvent } from "react";
import { moveItems } from "../../lib/reorder";

const TYPE = "application/x-albaro-reorder";

/**
 * Drag-to-reorder for a list of ids (the options of a select, the rows of a table). Spread
 * `handle(id)` on the grip and `row(id)` on its row; a line shows where the id will land, and
 * `onReorder` gets the new order once, when it is dropped (never when nothing would move). `withDragged`
 * lists the ids that travel with the grabbed one (a multi-row selection); they land together.
 */
export function useDragReorder(
  ids: string[],
  onReorder: (next: string[]) => void,
  withDragged?: (id: string) => string[],
) {
  const dragged = useRef<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);

  const reset = () => {
    dragged.current = null;
    setOver(null);
  };
  const isAfter = (e: DragEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return e.clientY > box.top + box.height / 2;
  };

  return {
    handle: (id: string) => ({
      draggable: true,
      onDragStart: (e: DragEvent<HTMLElement>) => {
        dragged.current = id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(TYPE, id);
        const row = e.currentTarget.closest("[data-reorder-row]");
        if (row) e.dataTransfer.setDragImage(row, 0, 0);
      },
      onDragEnd: reset,
    }),
    row: (id: string) => ({
      "data-reorder-row": "",
      "data-drop": over?.id === id ? (over.after ? "after" : "before") : undefined,
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (dragged.current === null) return;
        e.preventDefault();
        const after = isAfter(e);
        if (over?.id !== id || over.after !== after) setOver({ id, after });
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        e.preventDefault();
        const from = dragged.current;
        const after = isAfter(e);
        reset();
        if (from === null) return;
        const next = moveItems(ids, withDragged?.(from) ?? [from], id, after);
        if (next !== ids) onReorder(next);
      },
    }),
  };
}
