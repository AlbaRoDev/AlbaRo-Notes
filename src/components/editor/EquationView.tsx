import { useState, type KeyboardEvent } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useKatex } from "../../lib/katex-lazy";
import { renderLatex } from "../../lib/render-latex";

export function EquationView({ node, updateAttributes, getPos, editor }: NodeViewProps) {
  const katex = useKatex();
  const latex = node.attrs.latex as string;
  const [editing, setEditing] = useState(!latex);
  const [draft, setDraft] = useState(latex);

  const removeSelf = () => {
    const pos = getPos();
    if (pos == null) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run();
  };

  // Exiting edit mode unmounts this <input>. When that happens because the
  // user clicked elsewhere (blur), focus already correctly went there and
  // must be left alone. When it happens via a pure keystroke (Enter/Escape),
  // nothing else claims focus and it would fall back to <body>, silently
  // swallowing whatever the user types next — so those paths return focus
  // to the main doc themselves, right after this node.
  const returnFocusAfterSelf = () => {
    const pos = getPos();
    if (pos != null)
      editor
        .chain()
        .focus()
        .setTextSelection(pos + node.nodeSize)
        .run();
  };

  const commitAttrs = () => {
    const value = draft.trim();
    // An equation nobody ever typed into is a dead, unclickable zone once
    // rendered (an empty KaTeX span has no click target to re-enter edit
    // mode) — drop it instead of leaving that behind. Only on an explicit
    // Enter/Escape though: right after insertContent, Tiptap re-focuses the
    // editor on the next animation frame (see the "focus" core command),
    // which blurs this input a tick after it mounts — deleting on blur would
    // wipe the node before the user gets a chance to type anything.
    if (!value) return false;
    updateAttributes({ latex: value });
    return true;
  };

  if (editing) {
    return (
      <NodeViewWrapper as="span" className="equation-inline-editing" contentEditable={false}>
        <input
          autoFocus
          type="text"
          maxLength={10_000} // mirrors MAX_LATEX_LEN in validate.rs
          value={draft}
          placeholder="LaTeX…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (commitAttrs()) {
                setEditing(false);
                returnFocusAfterSelf();
              }
            } else if (e.key === "Escape") {
              e.preventDefault();
              if (!latex) {
                removeSelf();
              } else {
                setDraft(latex);
                setEditing(false);
                returnFocusAfterSelf();
              }
            }
          }}
          onBlur={() => {
            if (commitAttrs()) setEditing(false);
          }}
        />
      </NodeViewWrapper>
    );
  }

  // throwOnError: false renders invalid LaTeX as an inline error message
  // instead of throwing — the editor keeps working either way.
  // Until KaTeX arrives the raw LaTeX stands in for it.
  const html = katex && renderLatex(katex, latex, false);

  return (
    <NodeViewWrapper
      as="span"
      className="equation-inline"
      contentEditable={false}
      role="button"
      tabIndex={0}
      onClick={() => {
        setDraft(latex);
        setEditing(true);
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setDraft(latex);
          setEditing(true);
        }
      }}
    >
      {html ? (
        <span dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <span className="equation-pending">{latex}</span>
      )}
    </NodeViewWrapper>
  );
}
