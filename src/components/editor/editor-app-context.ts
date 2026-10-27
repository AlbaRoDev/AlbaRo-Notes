import { createContext, useContext } from "react";
import type { PageSummary } from "../../types";

export interface EditorAppContextValue {
  pages: PageSummary[];
  currentPageId: string;
  onNavigate: (pageId: string) => void;
  /** Re-reads the page list (a database row was created or deleted). */
  onPagesChanged: () => void;
}

export const EditorAppContext = createContext<EditorAppContextValue | null>(null);

/** Used by NodeViews (PageLink, Breadcrumb) that need live page titles/hierarchy — data the Tiptap schema itself doesn't hold. */
export function useEditorAppContext(): EditorAppContextValue {
  const ctx = useContext(EditorAppContext);
  if (!ctx) throw new Error("useEditorAppContext must be used within EditorAppProvider");
  return ctx;
}
