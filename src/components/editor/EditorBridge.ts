import { Extension } from "@tiptap/react";
import type { PageSummary } from "../../types";

export interface EditorBridgeStorage {
  currentPageId: string;
  createChildPage: () => Promise<PageSummary>;
  /** Creates a root-level database page (and registers it in the app's page list). */
  createDatabasePage: () => Promise<PageSummary>;
  /** Shows a short transient message below the editor (e.g. a failed file drop). */
  notify: (message: string) => void;
}

declare module "@tiptap/core" {
  interface Storage {
    editorBridge: EditorBridgeStorage;
  }
}

/**
 * Slash-menu commands (items.ts) run outside React and can't use a context
 * hook — this extension's storage is the one thing they can reach through
 * `editor.storage`. PageEditor mutates it imperatively (see its useEffect)
 * whenever `pageId`/callbacks change, so it stays current without recreating
 * the editor.
 */
export const EditorBridge = Extension.create({
  name: "editorBridge",
  addStorage(): EditorBridgeStorage {
    return {
      currentPageId: "",
      createChildPage: () => {
        throw new Error("editorBridge.createChildPage not configured");
      },
      createDatabasePage: () => {
        throw new Error("editorBridge.createDatabasePage not configured");
      },
      notify: () => {},
    };
  },
});
