import { Extension } from "@tiptap/react";
import { Plugin } from "@tiptap/pm/state";

/**
 * Keeps the document's first block a heading — it doubles as the page's
 * title — even when the user tries to delete or replace it entirely.
 * The heading's text can still become empty; only the node itself is protected.
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
      }),
    ];
  },
});
