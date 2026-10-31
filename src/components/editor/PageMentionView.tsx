import type { KeyboardEvent } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useEditorAppContext } from "./editor-app-context";
import { PageRef } from "./PageRef";
import { useHoverPreview } from "./use-hover-preview";

export function PageMentionView({ node }: NodeViewProps) {
  const { pages, onNavigate } = useEditorAppContext();
  // A mention is made from the «@» list, so it always has a page; a null one (left by an older version) shows as a missing page.
  const pageId = node.attrs.pageId as string | null;
  const target = pageId ? pages.find((p) => p.id === pageId) : undefined;
  const { bind, card } = useHoverPreview(target, pages, onNavigate);

  return (
    <NodeViewWrapper
      as="span"
      className="page-mention"
      data-missing={target ? undefined : "true"}
      contentEditable={false}
      role="button"
      tabIndex={0}
      {...bind}
      onClick={() => target && onNavigate(target.id)}
      onKeyDown={(e: KeyboardEvent) => {
        if (!target) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNavigate(target.id);
        }
      }}
    >
      <PageRef page={target} size={15} />
      {card}
    </NodeViewWrapper>
  );
}
