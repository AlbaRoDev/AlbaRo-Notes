import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { SyncedBlockView } from "./SyncedBlockView";
import { UUID_RE } from "./button-actions";

/**
 * Bloque sincronizado. The page document only stores a reference
 * (`syncId`); the content lives once in the `synced_blocks` table and every
 * instance — on this page or any other — edits and shows that same row.
 * There is no privileged "original": removing an instance just drops a
 * reference, and the row is swept at startup once nothing references it.
 */
export const SyncedBlock = Node.create({
  name: "syncedBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return { syncId: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-type="synced-block"]',
        // A pasted reference with a malformed id would make the page unsavable (Rust rejects it).
        getAttrs: (el) => {
          const id = el instanceof HTMLElement ? el.getAttribute("data-sync-id") : null;
          return id && UUID_RE.test(id) ? { syncId: id } : false;
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "synced-block",
        "data-sync-id": node.attrs.syncId ?? "",
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(SyncedBlockView);
  },
});
