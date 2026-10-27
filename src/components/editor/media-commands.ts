import { Selection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor, JSONContent } from "@tiptap/react";

type CommandProps = { tr: Transaction; state: EditorState };

/**
 * Makes sure a textblock follows the block ending at `end` — inside the SAME
 * parent (a toggle's content, a column), not just somewhere at the end of the
 * doc — and puts the caret in it. Without a line below the block, typing
 * after it would either replace the block (when the block itself is the
 * selection) or, found in testing, jump out of the toggle to the next
 * paragraph after it.
 */
function ensureLineAfter({ tr, state }: CommandProps, end: number) {
  if (!tr.doc.resolve(end).nodeAfter?.isTextblock) {
    tr.insert(end, state.schema.nodes.paragraph.create());
  }
}

function lineAfterWithCaret(props: CommandProps, end: number) {
  ensureLineAfter(props, end);
  props.tr.setSelection(Selection.near(props.tr.doc.resolve(end), 1));
}

/**
 * Inserts a block node below the cursor's block — replacing that block if
 * it's an empty paragraph, e.g. just after the "/imagen" text was deleted —
 * and leaves the caret on a fresh line under it. Never replaces a non-paragraph
 * (the first block is the protected title heading). With `caret: "inside"`
 * (tables, tabs) the caret goes into the block's first textblock instead; the
 * line below is still guaranteed so the block is never the last child of its
 * container.
 */
export function insertBlockWithLineAfter(json: JSONContent, caret: "after" | "inside" = "after") {
  return (props: CommandProps) => {
    const { tr, state } = props;
    const { $from } = tr.selection;
    const node = state.schema.nodeFromJSON(json);

    let at: number;
    if ($from.depth === 0) {
      at = $from.pos;
      tr.insert(at, node);
    } else if ($from.parent.type.name === "paragraph" && $from.parent.content.size === 0) {
      at = $from.before();
      tr.replaceWith(at, $from.after(), node);
    } else {
      at = $from.after();
      tr.insert(at, node);
    }
    if (caret === "inside") {
      ensureLineAfter(props, at + node.nodeSize);
      tr.setSelection(Selection.near(tr.doc.resolve(at + 1), 1));
    } else {
      lineAfterWithCaret(props, at + node.nodeSize);
    }
    return true;
  };
}

/** For a block that already exists at `pos` (a picker that just finished): focus the editor with the caret on the line below it. */
export function focusLineAfterNode(editor: Editor, pos: number | undefined) {
  if (pos == null) return;
  editor
    .chain()
    .focus()
    .command((props) => {
      const node = props.tr.doc.nodeAt(pos);
      if (node) lineAfterWithCaret(props, pos + node.nodeSize);
      return true;
    })
    .run();
}
