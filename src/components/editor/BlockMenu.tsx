import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import { ChevronRight, Copy, Trash2 } from "lucide-react";
import { turnInto, type TurnKind } from "./block-commands";
import { useBackLayer } from "../../hooks/useBackLayer.ts";
import { t } from "../../lib/i18n.ts";

// What «Convertir en» offers, and the blocks it applies to (the text ones: not media, tables or databases).
const TURN_OPTIONS: { kind: TurnKind; label: string }[] = [
  { kind: "paragraph", label: t("Texto") },
  { kind: "h1", label: t("Encabezado 1") },
  { kind: "h2", label: t("Encabezado 2") },
  { kind: "h3", label: t("Encabezado 3") },
  { kind: "h4", label: t("Encabezado 4") },
  { kind: "task", label: t("Checklist") },
  { kind: "bullet", label: t("Lista con viñetas") },
  { kind: "ordered", label: t("Lista numerada") },
  { kind: "toggle", label: t("Lista desplegable") },
  { kind: "code", label: t("Bloque de código") },
  { kind: "quote", label: t("Cita") },
  { kind: "callout", label: t("Destacado") },
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

/** Where the menu opens: `y` is its top edge, or `bottom` the gap between its lower edge and the window's (a menu opened from a bar at the foot). */
export interface BlockMenuTarget {
  node: PMNode;
  pos: number;
  x: number;
  y?: number;
  bottom?: number;
}

/** The block's options (turn into, duplicate, delete), drawn on the body so no zone clips it. */
export function BlockMenu({
  editor,
  target,
  onClose,
}: {
  editor: Editor;
  target: BlockMenuTarget;
  onClose: () => void;
}) {
  const { node, pos } = target;
  const [turning, setTurning] = useState(false);
  // the system's back button closes the menu (it is only mounted while open) instead of leaving the page
  useBackLayer(true, onClose);

  useEffect(() => {
    const close = (e: Event) => {
      const outside =
        e instanceof KeyboardEvent
          ? ["Escape", "Delete", "Backspace"].includes(e.key)
          : !(e.target as Element).closest(".handle-menu");
      if (outside) onClose();
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", close, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", close, true);
    };
  }, [onClose]);

  // Opened or expanded near the bottom of the window, the menu moves up until it fits.
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || target.y === undefined) return;
    const over = el.getBoundingClientRect().bottom - (window.innerHeight - 8);
    if (over > 0) el.style.top = `${Math.max(8, el.getBoundingClientRect().top - over)}px`;
  }, [target, turning]);

  const turnBlock = (kind: TurnKind) => {
    // the cursor goes into the block first: «turn into» works on the line the cursor is in
    const inside = Selection.findFrom(editor.state.doc.resolve(pos + 1), 1, true);
    if (inside) editor.commands.setTextSelection(inside.from);
    turnInto(editor, kind);
    onClose();
  };
  const removeBlock = () => {
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run();
    onClose();
  };
  const duplicateBlock = () => {
    editor
      .chain()
      .focus()
      .insertContentAt(pos + node.nodeSize, node.toJSON())
      .run();
    onClose();
  };

  return createPortal(
    <div
      className="handle-menu"
      role="menu"
      ref={menuRef}
      onMouseDown={(e) => e.preventDefault()} // the page keeps its focus (and the keyboard) while a button is pressed
      style={{
        left: target.x,
        top: target.y,
        bottom: target.bottom,
        maxHeight:
          target.bottom === undefined
            ? undefined
            : `calc(100dvh - ${target.bottom}px - 8px - env(safe-area-inset-top, 0px))`,
      }}
    >
      {TURNABLE.includes(node.type.name) && (
        <button
          type="button"
          role="menuitem"
          aria-expanded={turning}
          onClick={() => setTurning((v) => !v)}
        >
          <ChevronRight size={14} aria-hidden="true" /> {t("Convertir en")}
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
        <Copy size={14} aria-hidden="true" /> {t("Duplicar")}
      </button>
      <button type="button" role="menuitem" onClick={removeBlock}>
        <Trash2 size={14} aria-hidden="true" /> {t("Borrar")}
      </button>
    </div>,
    document.body,
  );
}
