import type { Command, Editor } from "@tiptap/core";
import { NodeSelection, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";

const LIST_ITEMS = ["listItem", "taskItem"];

export interface BlockAt {
  pos: number;
  node: PMNode;
}

/**
 * The block the selection is in, as Notion means it for «duplicate» and «move»: the textblock itself, or the
 * whole list item when it is the item's first line and the whole toggle when it is the toggle's summary.
 */
export function blockAt(state: EditorState): BlockAt | null {
  const { selection } = state;
  if (selection instanceof NodeSelection) return { pos: selection.from, node: selection.node };
  const { $from } = selection;
  let depth = $from.depth;
  if (depth < 1) return null;
  const parent = $from.node(depth - 1);
  if (
    (LIST_ITEMS.includes(parent.type.name) && $from.index(depth - 1) === 0) ||
    $from.parent.type.name === "toggleSummary"
  )
    depth -= 1;
  return { pos: $from.before(depth), node: $from.node(depth) };
}

/** The title (the page's first block) never moves, is never duplicated and is never turned into anything. */
export const isTitle = (state: EditorState, pos: number) => {
  const $p = state.doc.resolve(pos);
  return $p.depth === 0 && $p.index() === 0;
};

/** Puts a copy of the block (or of the blocks picked with the rubber band) right under it, and the cursor in the copy. */
export function duplicateBlock(editor: Editor, picked: { from: number; to: number } | null) {
  const { state } = editor;
  const b = picked ? { pos: picked.from, node: null } : blockAt(state);
  if (!b) return false;
  if (isTitle(state, b.pos)) return true;
  const end = picked ? picked.to : b.pos + b.node!.nodeSize;
  const copy = state.doc.slice(b.pos, end).content;
  const tr = state.tr.insert(end, copy);
  const first = tr.doc.nodeAt(end);
  if (picked || !first) {
    editor.view.dispatch(tr.scrollIntoView());
    return true;
  }
  const { selection } = state;
  tr.setSelection(
    selection instanceof NodeSelection
      ? NodeSelection.create(tr.doc, end)
      : TextSelection.create(tr.doc, end + selection.from - b.pos, end + selection.to - b.pos),
  );
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Swaps the block with the one above (-1) or below (1) it, in the same parent; the cursor travels with it. */
export function moveBlock(editor: Editor, dir: -1 | 1) {
  const { state } = editor;
  const b = blockAt(state);
  if (!b) return false;
  if (isTitle(state, b.pos)) return true;
  const $p = state.doc.resolve(b.pos);
  const index = $p.index();
  const sibling = $p.parent.maybeChild(index + dir);
  // nothing to swap with, and never above the title
  if (!sibling || ($p.depth === 0 && index + dir === 0)) return true;
  const target = dir < 0 ? b.pos - sibling.nodeSize : b.pos + sibling.nodeSize;
  const tr = state.tr.delete(b.pos, b.pos + b.node.nodeSize).insert(target, b.node);
  const { selection } = state;
  tr.setSelection(
    selection instanceof NodeSelection
      ? NodeSelection.create(tr.doc, target)
      : TextSelection.create(
          tr.doc,
          target + selection.from - b.pos,
          target + selection.to - b.pos,
        ),
  );
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Turns the line under the cursor into a toggle that holds its text as the summary. */
export const toggleFromBlock: Command = ({ tr, state }) => {
  const { $from } = tr.selection;
  const node = $from.parent;
  if (!["paragraph", "heading"].includes(node.type.name) || $from.depth < 1) return false;
  const { toggle, toggleSummary, toggleContent, paragraph } = state.schema.nodes;
  if (!toggle || !$from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), toggle))
    return false;
  const pos = $from.before();
  const block = toggle.create({ open: true, headingLevel: null }, [
    toggleSummary.create(null, node.content),
    toggleContent.create(null, paragraph.create()),
  ]);
  tr.replaceWith(pos, pos + node.nodeSize, block);
  // the cursor stays at the end of the text, now the summary (one step into the toggle, one into the summary)
  tr.setSelection(TextSelection.create(tr.doc, pos + 2 + node.content.size));
  return true;
};

export type TurnKind =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "task"
  | "bullet"
  | "ordered"
  | "toggle"
  | "code"
  | "quote"
  | "callout";

/** Notion's «Turn into»: the current block becomes that kind, or plain text again if it already is one. */
export function turnInto(editor: Editor, kind: TurnKind): boolean {
  const c = () => editor.chain().focus();
  const flip = (active: boolean, set: () => boolean) => (active ? c().clearNodes().run() : set());
  switch (kind) {
    case "paragraph":
      return c().clearNodes().run();
    case "h1":
    case "h2":
    case "h3":
    case "h4": {
      const level = Number(kind[1]) as 1 | 2 | 3 | 4;
      return flip(editor.isActive("heading", { level }), () =>
        c().clearNodes().setHeading({ level }).run(),
      );
    }
    case "task":
      return flip(editor.isActive("taskList"), () => c().clearNodes().toggleTaskList().run());
    case "bullet":
      return flip(editor.isActive("bulletList"), () => c().clearNodes().toggleBulletList().run());
    case "ordered":
      return flip(editor.isActive("orderedList"), () => c().clearNodes().toggleOrderedList().run());
    case "code":
      return flip(editor.isActive("codeBlock"), () => c().clearNodes().toggleCodeBlock().run());
    case "quote":
      return flip(editor.isActive("blockquote"), () => c().clearNodes().toggleBlockquote().run());
    case "callout":
      return flip(editor.isActive("callout"), () => c().clearNodes().toggleWrap("callout").run());
    case "toggle":
      return c().command(toggleFromBlock).run();
  }
}
