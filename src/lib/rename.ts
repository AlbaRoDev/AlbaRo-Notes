import { invoke } from "@tauri-apps/api/core";

export const RENAME_EVENT = "albaro-rename-page";

export interface RenameDetail {
  pageId: string;
  title: string;
  handled: boolean;
}

/**
 * Renames a page from outside its editor (the sidebar). An editor that has the page open takes it
 * (it owns the document, and its autosave would overwrite a write behind its back); otherwise SQLite is written.
 */
export async function renamePage(pageId: string, title: string): Promise<void> {
  const detail: RenameDetail = { pageId, title, handled: false };
  window.dispatchEvent(new CustomEvent(RENAME_EVENT, { detail }));
  if (!detail.handled) await invoke("rename_page", { pageId, title });
}
