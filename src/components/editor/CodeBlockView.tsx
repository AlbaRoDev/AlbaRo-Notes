import { useEffect, useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Check, Copy } from "lucide-react";
import { CODE_LANGUAGES, PLAIN_TEXT } from "./code-languages";

const COPIED_BADGE_MS = 1500;

export function CodeBlockView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  // Blocks saved before 2.4.x (or by the old plain codeBlock) have a null language.
  const language = (node.attrs.language as string | null) || PLAIN_TEXT;
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    let next: "copied" | "failed" = "copied";
    try {
      await navigator.clipboard.writeText(node.textContent);
    } catch {
      next = "failed";
    }
    setCopyState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopyState("idle"), COPIED_BADGE_MS);
  };

  const known = CODE_LANGUAGES.some((l) => l.value === language);

  return (
    <NodeViewWrapper className="code-block">
      <div className="code-block-toolbar" contentEditable={false}>
        <select
          aria-label="Lenguaje del bloque de código"
          value={language}
          onChange={(e) => {
            updateAttributes({ language: e.target.value });
            // The select keeps focus after a choice; put the caret back in the
            // code so typing continues where the user expects.
            const pos = getPos();
            if (pos != null) editor.commands.focus(pos + node.nodeSize - 1);
          }}
        >
          {!known && language && <option value={language}>{language}</option>}
          {CODE_LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        <button type="button" className="code-block-copy" onClick={() => void copy()}>
          {copyState === "copied" ? (
            <Check size={14} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
          )}
          {copyState === "copied"
            ? "Copiado"
            : copyState === "failed"
              ? "No se pudo copiar"
              : "Copiar"}
        </button>
      </div>
      <pre>
        <NodeViewContent<"code"> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}
