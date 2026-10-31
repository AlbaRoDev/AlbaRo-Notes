import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

/** App sends this on Ctrl+F; the page's editor opens its find bar (and cancels the event, so only one does). */
export const FIND_EVENT = "albaro-find";

interface Match {
  from: number;
  to: number;
}

export interface FindState {
  query: string;
  matches: Match[];
  /** Index in `matches` of the one being shown. */
  current: number;
}

const key = new PluginKey<FindState>("pageSearch");

/** Lower case and without accents, one character for one, so positions found here are positions in the text. */
const fold = (text: string) => text.replace(/[À-ɏ]/g, (c) => c.normalize("NFD")[0]).toLowerCase();

/** Every place the words are found, line by line (a match may cross bold or links, never a line or an inline block). */
function findMatches(doc: PMNode, query: string): Match[] {
  const needle = fold(query);
  const found: Match[] = [];
  if (!needle) return found;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const parts: { start: number; pos: number; length: number }[] = [];
    node.forEach((child, offset) => {
      if (child.isText && child.text) {
        parts.push({ start: text.length, pos: pos + 1 + offset, length: child.text.length });
        text += child.text;
      } else text += "￼"; // an equation, a mention…: it takes one place and matches nothing
    });
    const hay = fold(text);
    if (hay.length !== text.length) return false; // a rare letter that folds to a different length: skip the line
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
      const last = i + needle.length - 1;
      const a = parts.find((p) => i >= p.start && i < p.start + p.length);
      const b = parts.find((p) => last >= p.start && last < p.start + p.length);
      if (a && b) found.push({ from: a.pos + (i - a.start), to: b.pos + (last - b.start) + 1 });
    }
    return false;
  });
  return found;
}

export const findState = (state: EditorState): FindState =>
  key.getState(state) ?? { query: "", matches: [], current: 0 };

/** Finds words in the page and tints them (the one shown stronger), like Notion's and every browser's Ctrl+F. */
export const PageSearch = Extension.create({
  name: "pageSearch",
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key,
        state: {
          init: () => ({ query: "", matches: [], current: 0 }),
          apply: (tr, value, _old, state) => {
            const meta = tr.getMeta(key) as { query?: string; current?: number } | undefined;
            if (!meta && !(tr.docChanged && value.query)) return value;
            const query = meta?.query ?? value.query;
            const matches = query ? findMatches(state.doc, query) : [];
            let current = meta?.current ?? value.current;
            if (meta?.query !== undefined && meta.current === undefined) {
              // a new search starts at the first match from the cursor on
              const from = state.selection.from;
              current = Math.max(
                0,
                matches.findIndex((m) => m.from >= from),
              );
            }
            return { query, matches, current: Math.min(current, Math.max(0, matches.length - 1)) };
          },
        },
        props: {
          decorations: (state) => {
            const { matches, current } = findState(state);
            if (matches.length === 0) return null;
            return DecorationSet.create(
              state.doc,
              matches.map((m, i) =>
                Decoration.inline(m.from, m.to, {
                  class: i === current ? "find-match find-current" : "find-match",
                }),
              ),
            );
          },
        },
      }),
    ];
  },
});

/** Opens the toggles around the match and scrolls it to the middle of the view. */
function reveal(editor: Editor) {
  const { matches, current } = findState(editor.state);
  const match = matches[current];
  if (!match) return;
  const { doc } = editor.state;
  const $from = doc.resolve(match.from);
  const tr = editor.state.tr;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "toggle" && !node.attrs.open)
      tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, open: true });
  }
  // The cursor goes to the match, which also brings up a hidden tab (Tabs reveals the one holding the cursor).
  tr.setSelection(TextSelection.create(tr.doc, match.from, match.to)).setMeta(
    "addToHistory",
    false,
  );
  editor.view.dispatch(tr);
  requestAnimationFrame(() => {
    const at = editor.view.domAtPos(match.from).node;
    const el = at instanceof Element ? at : at.parentElement;
    el?.scrollIntoView({ block: "center" });
  });
}

/** A new search, from the first match at the cursor; empty clears it. */
export function setFindQuery(editor: Editor, query: string) {
  editor.view.dispatch(editor.state.tr.setMeta(key, { query }));
  if (query) reveal(editor);
}

/** Shows the match at `index` (the page's own matches come before the cells of a table, see FindBar). */
export function goToMatch(editor: Editor, index: number) {
  editor.view.dispatch(editor.state.tr.setMeta(key, { current: index }));
  reveal(editor);
}
