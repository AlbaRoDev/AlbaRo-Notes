import { Extension } from "@tiptap/react";
import { Plugin, PluginKey, Selection, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { hits, isPageBlank, startMarquee, type Box } from "../../lib/marquee";
import { blockAt, isTitle } from "./block-commands";

interface Range {
  from: number;
  to: number;
}

// The blocks picked by the rubber band, as a document range; any other selection change or edit drops it.
const key = new PluginKey<Range | null>("blockSelect");

/** Picks the blocks of this range (or none), with the text selection that copy and the cursor follow. */
function pickRange(view: EditorView, range: Range | null) {
  const { state } = view;
  const tr = state.tr.setMeta(key, range);
  if (range) {
    // deleting is handled by whole blocks (below); the text selection is for copying
    const a = Selection.findFrom(state.doc.resolve(range.from), 1, true);
    const b = Selection.findFrom(state.doc.resolve(range.to), -1, true);
    if (a && b && a.from <= b.to) tr.setSelection(TextSelection.create(state.doc, a.from, b.to));
  }
  view.dispatch(tr);
}

/** Ctrl+A: every block under the title. */
export function selectAllBlocks(view: EditorView) {
  const { doc } = view.state;
  if (doc.childCount < 2) return false;
  pickRange(view, { from: doc.child(0).nodeSize, to: doc.content.size });
  return true;
}

/** Selects the top-level blocks (never the title) that `box` touches. */
function selectBlocks(view: EditorView, box: Box) {
  const { state } = view;
  let from = -1;
  let to = -1;
  state.doc.forEach((node, pos, index) => {
    if (index === 0) return;
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement) || !hits(dom, box)) return;
    if (from < 0) from = pos;
    to = pos + node.nodeSize;
  });
  const prev = key.getState(state);
  if ((prev?.from ?? -1) === from && (prev?.to ?? -1) === to) return;
  pickRange(view, from < 0 ? null : { from, to });
}

/** The blocks picked right now (with the rubber band, a handle or Esc), as a document range, or null. */
export const blockSelection = (state: EditorState) => key.getState(state) ?? null;

/** Picks one block (at any depth) as the selection: it is tinted, and Delete or Backspace removes it. */
export function selectBlock(view: EditorView, pos: number) {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  view.dispatch(view.state.tr.setMeta(key, { from: pos, to: pos + node.nodeSize }));
  view.focus();
}

/** Esc picks the block the cursor is in (Notion's «select this block»); Delete then removes it. */
export const EscapeSelectsBlock = Extension.create({
  name: "escapeSelectsBlock",
  // After the menus and boxes that close on Esc (the slash menu, the AI box): they get the key first.
  priority: 1,
  addKeyboardShortcuts() {
    return {
      Escape: ({ editor }) => {
        const b = blockAt(editor.state);
        if (!b || blockSelection(editor.state) || isTitle(editor.state, b.pos)) return false;
        selectBlock(editor.view, b.pos);
        return true;
      },
    };
  },
});

/** Notion's rubber band over a page: press on the blank space around the text and drag across blocks. */
export const BlockSelect = Extension.create({
  name: "blockSelect",
  addProseMirrorPlugins() {
    return [
      new Plugin<Range | null>({
        key,
        state: {
          init: () => null,
          apply: (tr, value) => {
            const meta = tr.getMeta(key);
            if (meta !== undefined) return meta;
            return tr.docChanged || tr.selectionSet ? null : value;
          },
        },
        props: {
          decorations: (state) => {
            const range = key.getState(state);
            if (!range) return null;
            const marks: Decoration[] = [];
            state.doc.nodesBetween(range.from, range.to, (node, pos) => {
              if (pos < range.from || pos + node.nodeSize > range.to) return true;
              marks.push(Decoration.node(pos, pos + node.nodeSize, { class: "block-selected" }));
              return false; // the blocks inside are covered by their container
            });
            return DecorationSet.create(state.doc, marks);
          },
          attributes: (state): Record<string, string> =>
            key.getState(state) ? { class: "has-block-selection" } : {},
          handleKeyDown: (view, event) => {
            const range = key.getState(view.state);
            if (!range || (event.key !== "Backspace" && event.key !== "Delete")) return false;
            view.dispatch(view.state.tr.delete(range.from, range.to));
            return true;
          },
        },
        view: (view) => {
          const down = (e: MouseEvent) => {
            const t = e.target;
            // Only this editor's own blank space (not another page's, nor a table's).
            if (!(t instanceof Element) || !isPageBlank(t)) return;
            if (t !== view.dom && !t.contains(view.dom)) return;
            startMarquee(
              e,
              (box) => selectBlocks(view, box),
              (dragged) => dragged && view.focus(),
            );
          };
          document.addEventListener("mousedown", down, true);
          return { destroy: () => document.removeEventListener("mousedown", down, true) };
        },
      }),
    ];
  },
});
