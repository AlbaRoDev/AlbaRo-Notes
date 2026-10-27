import { NodeViewWrapper } from "@tiptap/react";
import { useEditorAppContext } from "./editor-app-context";
import type { PageSummary } from "../../types";

/** Walks `parentId` links from the current page up to the root — the hierarchy CLAUDE.md's data model already provides. */
function getAncestorChain(pages: PageSummary[], pageId: string): PageSummary[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const chain: PageSummary[] = [];
  let current = byId.get(pageId);
  while (current) {
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

export function BreadcrumbView() {
  const { pages, currentPageId, onNavigate } = useEditorAppContext();
  const chain = getAncestorChain(pages, currentPageId);

  return (
    <NodeViewWrapper className="breadcrumb-block" contentEditable={false}>
      {chain.map((page, i) => (
        <span key={page.id} className="breadcrumb-item">
          {i > 0 && <span className="breadcrumb-separator">/</span>}
          {i === chain.length - 1 ? (
            <span className="breadcrumb-current">{page.title}</span>
          ) : (
            <button type="button" onClick={() => onNavigate(page.id)}>
              {page.title}
            </button>
          )}
        </span>
      ))}
    </NodeViewWrapper>
  );
}
