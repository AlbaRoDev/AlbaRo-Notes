import { useState, type KeyboardEvent } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { AtSign } from "lucide-react";
import { useEditorAppContext } from "./editor-app-context";
import type { PageSummary } from "../../types";

export function PageMentionView({ node, updateAttributes, getPos, editor }: NodeViewProps) {
  const { pages, currentPageId, onNavigate } = useEditorAppContext();
  const pageId = node.attrs.pageId as string | null;

  if (!pageId) {
    return (
      <NodeViewWrapper as="span" className="page-mention-picker" contentEditable={false}>
        <PageMentionPicker
          pages={pages}
          currentPageId={currentPageId}
          onPick={(id) => {
            updateAttributes({ pageId: id });
            // Picking removes the focused result button from the DOM — with
            // nothing else claiming focus, it would fall back to <body> and
            // eat the user's next keystrokes.
            const pos = getPos();
            if (pos != null)
              editor
                .chain()
                .focus()
                .setTextSelection(pos + node.nodeSize)
                .run();
          }}
        />
      </NodeViewWrapper>
    );
  }

  const target = pages.find((p) => p.id === pageId);

  return (
    <NodeViewWrapper
      as="span"
      className="page-mention"
      data-missing={target ? undefined : "true"}
      contentEditable={false}
      role="button"
      tabIndex={0}
      onClick={() => target && onNavigate(pageId)}
      onKeyDown={(e: KeyboardEvent) => {
        if (!target) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNavigate(pageId);
        }
      }}
    >
      <AtSign size={13} strokeWidth={1.75} aria-hidden="true" />
      <span>{target?.title ?? "Página eliminada"}</span>
    </NodeViewWrapper>
  );
}

function PageMentionPicker({
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
    <span className="page-mention-picker-box" contentEditable={false}>
      <input
        autoFocus
        type="text"
        placeholder="Mencionar página…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <span className="page-mention-picker-list">
        {results.map((p) => (
          <button key={p.id} type="button" onClick={() => onPick(p.id)}>
            {p.title}
          </button>
        ))}
        {results.length === 0 && <span className="page-mention-picker-empty">Sin resultados</span>}
      </span>
    </span>
  );
}
