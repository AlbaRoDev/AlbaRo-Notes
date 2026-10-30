import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import { ChevronRight, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { selectBlock } from "./BlockSelect";
import { turnInto, type TurnKind } from "./block-commands";
import "./BlockHandle.css";

// A constant, not an inline object: the handle re-registers its plugin (and hides) whenever this changes.
const POSITION = { placement: "left-start" } as const;

// What «Convertir en» offers, and the blocks it applies to (the text ones: not media, tables or databases).
const TURN_OPTIONS: { kind: TurnKind; label: string }[] = [
  { kind: "paragraph", label: "Texto" },
  { kind: "h1", label: "Encabezado 1" },
  { kind: "h2", label: "Encabezado 2" },
  { kind: "h3", label: "Encabezado 3" },
  { kind: "h4", label: "Encabezado 4" },
  { kind: "task", label: "Checklist" },
  { kind: "bullet", label: "Lista con viñetas" },
  { kind: "ordered", label: "Lista numerada" },
  { kind: "toggle", label: "Lista desplegable" },
  { kind: "code", label: "Bloque de código" },
  { kind: "quote", label: "Cita" },
  { kind: "callout", label: "Destacado" },
];
const TURNABLE = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "listItem",
  "taskItem",
  "blockquote",
  "callout",
  "codeBlock",
];

/**
 * Notion's block handles: hovering a block shows a «+» (adds an empty line under it and opens the «/» menu) and a
 * grip to drag the block to another place. The page's title (its first block) has none: it is not a block to move.
 */
export function BlockHandle({ editor }: { editor: Editor }) {
  const [target, setTarget] = useState<{ node: PMNode | null; pos: number }>({
    node: null,
    pos: -1,
  });
  const isTitle = target.pos <= 0;

  // The handle always sits outside the block. A list item's text starts after its bullet or checkbox, so the
  // handle is placed at the edge of the list instead (the bullet stays between the handle and the text).
  const posRef = useRef(-1);
  const reference = useCallback(() => {
    const dom = posRef.current >= 0 ? editor.view.nodeDOM(posRef.current) : null;
    const item = dom instanceof HTMLElement ? dom.closest("li") : null;
    if (!(dom instanceof HTMLElement) || !item?.parentElement) return null;
    const rect = dom.getBoundingClientRect();
    const left =
      item.getBoundingClientRect().left -
      parseFloat(getComputedStyle(item.parentElement).paddingLeft);
    return { getBoundingClientRect: () => new DOMRect(left, rect.top, rect.width, rect.height) };
  }, [editor]);

  // Clicking the grip (not dragging it) picks the block and opens its menu, like Notion's. The block is kept
  // here because the handle forgets its target as soon as the pointer leaves the page.
  const [menu, setMenu] = useState<{ node: PMNode; pos: number; x: number; y: number } | null>(
    null,
  );
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      const outside =
        e instanceof KeyboardEvent
          ? ["Escape", "Delete", "Backspace"].includes(e.key)
          : !(e.target as Element).closest(".handle-menu");
      if (outside) setMenu(null);
    };
    document.addEventListener("mousedown", close, true);
    document.addEventListener("keydown", close, true);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("keydown", close, true);
    };
  }, [menu]);
  const [turning, setTurning] = useState(false);
  // Opened or expanded near the bottom of the window, the menu moves up until it fits.
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const over = el.getBoundingClientRect().bottom - (window.innerHeight - 8);
    if (over > 0) el.style.top = `${Math.max(8, el.getBoundingClientRect().top - over)}px`;
  }, [menu, turning]);
  const openMenu = (e: React.MouseEvent) => {
    const { node, pos } = target;
    if (!node || pos < 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    selectBlock(editor.view, pos);
    setTurning(false);
    setMenu({
      node,
      pos,
      x: Math.min(r.left, window.innerWidth - 168),
      y: Math.min(r.bottom + 4, window.innerHeight - 84),
    });
  };
  const turnBlock = (kind: TurnKind) => {
    if (!menu) return;
    // the cursor goes into the block first: «turn into» works on the line the cursor is in
    const inside = Selection.findFrom(editor.state.doc.resolve(menu.pos + 1), 1, true);
    if (inside) editor.commands.setTextSelection(inside.from);
    turnInto(editor, kind);
    setMenu(null);
  };
  const removeBlock = () => {
    if (!menu) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: menu.pos, to: menu.pos + menu.node.nodeSize })
      .run();
    setMenu(null);
  };
  const duplicateBlock = () => {
    if (!menu) return;
    editor
      .chain()
      .focus()
      .insertContentAt(menu.pos + menu.node.nodeSize, menu.node.toJSON())
      .run();
    setMenu(null);
  };

  const addBelow = () => {
    const { node, pos } = target;
    if (!node || pos < 0) return;
    const after = pos + node.nodeSize;
    // an empty line right under the block, with «/» typed so the command menu opens where it is
    editor
      .chain()
      .insertContentAt(after, { type: "paragraph" })
      .focus(after + 1)
      .insertContent("/")
      .run();
  };

  return (
    <DragHandle
      editor={editor}
      nested={{ edgeDetection: "none" }}
      onNodeChange={({ node, pos }) => {
        posRef.current = pos;
        setTarget({ node, pos });
      }}
      getReferencedVirtualElement={reference}
      computePositionConfig={POSITION}
    >
      <div className="block-handle" data-hidden={isTitle || undefined}>
        <button
          type="button"
          className="block-handle-plus"
          aria-label="Añadir un bloque debajo"
          title="Añadir un bloque debajo"
          onMouseDown={(e) => e.preventDefault()}
          onClick={addBelow}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
        <span
          className="block-handle-grip"
          title="Arrastra para mover el bloque; pulsa para ver las opciones"
          role="button"
          aria-label="Opciones del bloque"
          onClick={openMenu}
        >
          <GripVertical size={16} />
        </span>
      </div>
      {menu &&
        createPortal(
          <div
            className="handle-menu"
            role="menu"
            ref={menuRef}
            style={{ left: menu.x, top: menu.y }}
          >
            {TURNABLE.includes(menu.node.type.name) && (
              <button
                type="button"
                role="menuitem"
                aria-expanded={turning}
                onClick={() => setTurning((t) => !t)}
              >
                <ChevronRight size={14} aria-hidden="true" /> Convertir en
              </button>
            )}
            {turning &&
              TURN_OPTIONS.map(({ kind, label }) => (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  className="handle-menu-sub"
                  onClick={() => turnBlock(kind)}
                >
                  {label}
                </button>
              ))}
            <button type="button" role="menuitem" onClick={duplicateBlock}>
              <Copy size={14} aria-hidden="true" /> Duplicar
            </button>
            <button type="button" role="menuitem" onClick={removeBlock}>
              <Trash2 size={14} aria-hidden="true" /> Borrar
            </button>
          </div>,
          document.body,
        )}
    </DragHandle>
  );
}
