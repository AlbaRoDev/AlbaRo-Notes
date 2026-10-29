import { Extension } from "@tiptap/react";
import { Plugin } from "@tiptap/pm/state";

/**
 * Keeps the document's first block a heading — it doubles as the page's
 * title — even when the user tries to delete or replace it entirely.
 * The heading's text can still become empty; only the node itself is protected.
 *
 * Like Notion, a page also always keeps an (empty) block under the title, so there is always a line of
 * content to click or type in: deleting everything (or opening a page saved with only a title, as a new
 * task is) leaves that empty paragraph instead of a document that is just the title.
 */
export const ProtectedTitle = Extension.create({
  name: "protectedTitle",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        filterTransaction: (tr) => {
          if (!tr.docChanged) return true;
          return tr.doc.firstChild?.type.name === "heading";
        },
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((tr) => tr.docChanged) || state.doc.childCount > 1) return null;
          return state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph.create());
        },
      }),
    ];
  },
});
