import { useState, type KeyboardEvent } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useEditorAppContext } from "./editor-app-context";
import { PageRef } from "./PageRef";
import { useHoverPreview } from "./use-hover-preview";
import { linkablePages } from "../../lib/page-links";
import type { PageSummary } from "../../types";

export function PageLinkView({ node, updateAttributes }: NodeViewProps) {
  const { pages, currentPageId } = useEditorAppContext();
  const pageId = node.attrs.pageId as string | null;

  if (!pageId) {
    return (
      <NodeViewWrapper>
        <PageLinkPicker
          pages={pages}
          currentPageId={currentPageId}
          onPick={(id) => updateAttributes({ pageId: id })}
        />
      </NodeViewWrapper>
    );
  }

  return <ResolvedPageLink pageId={pageId} />;
}

/** A link to a page that is chosen: its icon and title, with the preview card on hover. */
function ResolvedPageLink({ pageId }: { pageId: string }) {
  const { pages, onNavigate } = useEditorAppContext();
  const target = pages.find((p) => p.id === pageId);
  const { bind, card } = useHoverPreview(target, pages, onNavigate);

  return (
    <NodeViewWrapper
      as="div"
      className="page-link"
      contentEditable={false}
      role="button"
      tabIndex={0}
      {...bind}
      onClick={() => onNavigate(pageId)}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNavigate(pageId);
        }
      }}
    >
      <PageRef page={target} />
      {card}
    </NodeViewWrapper>
  );
}

function PageLinkPicker({
  pages,
  currentPageId,
  onPick,
}: {
  pages: PageSummary[];
  currentPageId: string;
  onPick: (pageId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const results = linkablePages(pages).filter(
    (p) => p.id !== currentPageId && (!q || p.title.toLowerCase().includes(q)),
  );

  return (
    <div className="page-link-picker" contentEditable={false}>
      <input
        autoFocus
        type="text"
        placeholder="Buscar página…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul>
        {results.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onPick(p.id)}>
              {p.title}
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="page-link-picker-empty">Sin resultados</li>}
      </ul>
    </div>
  );
}
