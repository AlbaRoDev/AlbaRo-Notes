import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** Where the in-page AI works: a selection to edit, or a cursor to write at. */
export interface AiAssistState {
  open: boolean;
  mode: "selection" | "cursor";
  from: number;
  to: number;
}

/** Window event that asks the open page's editor to open its in-page AI (Ctrl+J from App). */
export const AI_INLINE_EVENT = "albaro:ai-inline";

const CLOSED: AiAssistState = { open: false, mode: "cursor", from: 0, to: 0 };
const key = new PluginKey<AiAssistState>("aiAssist");

export const getAiAssist = (state: EditorState): AiAssistState => key.getState(state) ?? CLOSED;

/**
 * Opens the in-page AI on the current selection, or at the cursor if nothing is selected. A
 * selection that covers whole blocks (every bit of their text) is widened to those blocks, so
 * «convertir en checklist» replaces the list itself instead of leaving empty items around.
 */
export function openAiAssist(editor: Editor) {
  const { state } = editor;
  let { from, to } = state.selection;
  if (from !== to) {
    const $from = state.doc.resolve(from);
    const $to = state.doc.resolve(to);
    if ($from.depth >= 1 && $to.depth >= 1) {
      const start = $from.before(1);
      const end = $to.after(1);
      if (!state.doc.textBetween(start, from).trim() && !state.doc.textBetween(to, end).trim()) {
        from = start;
        to = end;
      }
    }
  }
  const next: AiAssistState = { open: true, mode: from === to ? "cursor" : "selection", from, to };
  editor.view.dispatch(state.tr.setMeta(key, next));
}

export function closeAiAssist(editor: Editor) {
  if (getAiAssist(editor.state).open) editor.view.dispatch(editor.state.tr.setMeta(key, CLOSED));
}

export const AiAssist = Extension.create({
  name: "aiAssist",

  addProseMirrorPlugins() {
    return [
      new Plugin<AiAssistState>({
        key,
        state: {
          init: () => CLOSED,
          apply(tr, value) {
            const meta = tr.getMeta(key) as AiAssistState | undefined;
            if (meta) return meta;
            if (!value.open || !tr.docChanged) return value;
            // the user may edit elsewhere while the AI writes: keep the range on its text
            return {
              ...value,
              from: tr.mapping.map(value.from, 1),
              to: tr.mapping.map(value.to, -1),
            };
          },
        },
        props: {
          // the text the AI is working on stays highlighted while the selection itself moves on
          decorations(state) {
            const s = getAiAssist(state);
            if (!s.open || s.mode !== "selection" || s.from >= s.to) return null;
            return DecorationSet.create(state.doc, [
              Decoration.inline(s.from, s.to, { class: "ai-selection" }),
            ]);
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Like Notion: Space on an empty top-level line asks the AI to write there (what the line's
      // placeholder says). Inside lists, tables, toggles or columns Space is just a space.
      Space: ({ editor }) => {
        const { empty, $from } = editor.state.selection;
        const emptyLine =
          $from.depth === 1 &&
          $from.parent.type.name === "paragraph" &&
          $from.parent.content.size === 0;
        if (!empty || !emptyLine) return false;
        openAiAssist(editor);
        return true;
      },
    };
  },
});
