import { useState, type KeyboardEvent } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { FileText } from "lucide-react";
import { useEditorAppContext } from "./editor-app-context";
import type { PageSummary } from "../../types";

export function PageLinkView({ node, updateAttributes }: NodeViewProps) {
  const { pages, currentPageId, onNavigate } = useEditorAppContext();
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

  const target = pages.find((p) => p.id === pageId);

  return (
    <NodeViewWrapper
      as="div"
      className="page-link"
      contentEditable={false}
      role="button"
      tabIndex={0}
      onClick={() => onNavigate(pageId)}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNavigate(pageId);
        }
      }}
    >
      <FileText size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>{target?.title ?? "Página eliminada"}</span>
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
  const results = pages.filter(
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
