import { useState, type KeyboardEvent } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useKatex } from "../../lib/katex-lazy";
import { renderLatex } from "../../lib/render-latex";
import { focusLineAfterNode } from "./media-commands";

/** Mirrors MAX_LATEX_LEN in validate.rs. */
const MAX_LATEX_LEN = 10_000;

export function EquationBlockView({ node, updateAttributes, getPos, editor }: NodeViewProps) {
  const katex = useKatex();
  const latex = node.attrs.latex as string;
  // A fresh block opens straight into the editor; one that already has
  // content shows the rendered equation until clicked.
  const [editing, setEditing] = useState(!latex);
  // The draft lives here and reaches the node only on commit (Ctrl+Enter,
  // «Listo», blur) — never per keystroke (see the date-input lesson in CLAUDE.md).
  const [draft, setDraft] = useState(latex);

  const finish = () => {
    setEditing(false);
    focusLineAfterNode(editor, getPos());
  };

  const commit = () => {
    const value = draft.trim();
    if (value !== latex) updateAttributes({ latex: value });
    setDraft(value);
  };

  const removeSelf = () => {
    const pos = getPos();
    if (pos == null) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Plain Enter adds a line (\\ rows, aligned…); Ctrl/Cmd+Enter confirms.
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit();
      finish();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (!latex) removeSelf();
      else {
        setDraft(latex);
        finish();
      }
    }
  };

  if (editing) {
    return (
      <NodeViewWrapper className="equation-block-editing" contentEditable={false}>
        <textarea
          autoFocus
          rows={3}
          maxLength={MAX_LATEX_LEN}
          value={draft}
          placeholder="LaTeX…  (Ctrl+Enter para terminar)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            // Focus already went where the user clicked: don't pull it back.
            // Stay open while empty — Tiptap's deferred focus right after
            // insertion blurs this textarea a tick after it mounts.
            commit();
            if (draft.trim()) setEditing(false);
          }}
        />
        <div className="equation-block-actions">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              commit();
              finish();
            }}
          >
            Listo
          </button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={removeSelf}>
            Quitar
          </button>
        </div>
        {draft.trim() && katex && (
          <div
            className="equation-block-preview"
            dangerouslySetInnerHTML={{ __html: renderLatex(katex, draft, true) ?? "" }}
          />
        )}
      </NodeViewWrapper>
    );
  }

  // Committed to empty (blur with nothing typed): keep a clickable placeholder
  // rather than a zero-height dead zone.
  const html = latex && katex ? renderLatex(katex, latex, true) : null;

  return (
    <NodeViewWrapper
      className="equation-block"
      contentEditable={false}
      role="button"
      tabIndex={0}
      onClick={() => {
        setDraft(latex);
        setEditing(true);
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          setDraft(latex);
          setEditing(true);
        }
      }}
    >
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : latex ? (
        // KaTeX has not arrived yet: the raw LaTeX stands in for it
        <div className="equation-pending">{latex}</div>
      ) : (
        <span className="equation-block-empty">Añadir una ecuación</span>
      )}
    </NodeViewWrapper>
  );
}
