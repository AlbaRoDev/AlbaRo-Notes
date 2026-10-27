import { useEffect, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

interface HeadingEntry {
  pos: number;
  level: number;
  text: string;
}

function collectHeadings(editor: NodeViewProps["editor"]): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      headings.push({ pos, level: node.attrs.level as number, text: node.textContent });
    }
    return true;
  });
  return headings;
}

/** Reads headings straight from the live document — no separate index to keep in sync, just a subscription to editor updates. */
export function TableOfContentsView({ editor }: NodeViewProps) {
  const [headings, setHeadings] = useState<HeadingEntry[]>(() => collectHeadings(editor));

  useEffect(() => {
    const refresh = () => setHeadings(collectHeadings(editor));
    editor.on("update", refresh);
    refresh();
    return () => {
      editor.off("update", refresh);
    };
  }, [editor]);

  const goToHeading = (pos: number) => {
    editor
      .chain()
      .focus()
      .setTextSelection(pos + 1)
      .scrollIntoView()
      .run();
  };

  return (
    <NodeViewWrapper className="toc-block" contentEditable={false}>
      <div className="toc-title">Índice</div>
      {headings.length === 0 ? (
        <p className="toc-empty">Sin encabezados en esta página</p>
      ) : (
        <ul>
          {headings.map((h) => (
            <li key={h.pos}>
              <button type="button" data-level={h.level} onClick={() => goToHeading(h.pos)}>
                {h.text || "Sin título"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </NodeViewWrapper>
  );
}
