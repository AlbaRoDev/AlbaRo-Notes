import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { DatabaseView } from "./DatabaseView";
import { UUID_RE } from "../editor/button-actions";

/**
 * Vista de base de datos. The page document only stores a reference
 * (`databaseId`, null while choosing a source); the database itself is a page
 * of its own kind and its schema, rows and values live in SQLite (databases /
 * properties / property_values — see databases.rs). Page editor only.
 */
export const Database = Node.create({
  name: "database",
  group: "block",
  atom: true,
  addAttributes() {
    // viewId: which of the database's views this block shows (null = the first).
    return { databaseId: { default: null }, viewId: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-type="database"]',
        // A pasted reference with a malformed id would make the page unsavable (Rust rejects it).
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const id = el.getAttribute("data-database-id");
          const view = el.getAttribute("data-view-id");
          if (id && !UUID_RE.test(id)) return false;
          return { databaseId: id || null, viewId: view && UUID_RE.test(view) ? view : null };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "database",
        "data-database-id": node.attrs.databaseId ?? "",
        "data-view-id": node.attrs.viewId ?? "",
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(DatabaseView);
  },
});
