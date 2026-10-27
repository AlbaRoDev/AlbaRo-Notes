import { useState } from "react";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { GripVertical, Plus } from "lucide-react";
import "./BlockHandle.css";

// A constant, not an inline object: the handle re-registers its plugin (and hides) whenever this changes.
const POSITION = { placement: "left-start" } as const;

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
      nested
      onNodeChange={({ node, pos }) => setTarget({ node, pos })}
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
          title="Arrastra para mover el bloque"
          aria-hidden="true"
        >
          <GripVertical size={16} />
        </span>
      </div>
    </DragHandle>
  );
}
