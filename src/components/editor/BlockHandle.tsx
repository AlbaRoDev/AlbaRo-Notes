import { useCallback, useRef, useState } from "react";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { GripVertical, Plus } from "lucide-react";
import { selectBlock } from "./BlockSelect";
import { BlockMenu, type BlockMenuTarget } from "./BlockMenu";
import { addBlockBelow } from "./block-commands";
import "./BlockHandle.css";
import { t } from "../../lib/i18n.ts";

// Constants, not inline objects: the handle re-registers its plugin (and hides) whenever these change.
const POSITION = { placement: "left-start" } as const;
// A toggle's summary is one line of the toggle: the handle (and the drag) is the toggle's, outside its arrow.
const NESTED = {
  edgeDetection: "none" as const,
  rules: [
    {
      id: "toggleSummary",
      evaluate: ({ node }: { node: { type: { name: string } } }) =>
        node.type.name === "toggleSummary" ? 1000 : 0,
    },
  ],
};

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
  const [menu, setMenu] = useState<BlockMenuTarget | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = (e: React.MouseEvent) => {
    const { node, pos } = target;
    if (!node || pos < 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    selectBlock(editor.view, pos);
    setMenu({
      node,
      pos,
      x: Math.min(r.left, window.innerWidth - 168),
      y: Math.min(r.bottom + 4, window.innerHeight - 84),
    });
  };
  const addBelow = () => {
    if (target.node && target.pos >= 0) addBlockBelow(editor, target.pos, target.node);
  };

  return (
    <DragHandle
      editor={editor}
      nested={NESTED}
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
          aria-label={t("Añadir un bloque debajo")}
          title={t("Añadir un bloque debajo")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={addBelow}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
        <span
          className="block-handle-grip"
          title={t("Arrastra para mover el bloque; pulsa para ver las opciones")}
          role="button"
          aria-label={t("Opciones del bloque")}
          onClick={openMenu}
        >
          <GripVertical size={16} />
        </span>
      </div>
      {menu && <BlockMenu editor={editor} target={menu} onClose={closeMenu} />}
    </DragHandle>
  );
}
