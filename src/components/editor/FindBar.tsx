import { useEffect, useReducer, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { findState, setFindQuery, stepFind } from "./PageSearch";
import "./FindBar.css";

/**
 * The find bar of a page (Ctrl+F): a box for the words, how many were found, previous and next, and close.
 * Enter goes to the next one, Shift+Enter to the previous and Esc closes it and gives the page its cursor back.
 * `focusToken` changes when Ctrl+F is pressed again, to put the cursor back in the box.
 */
export function FindBar({
  editor,
  focusToken,
  onClose,
}: {
  editor: Editor;
  focusToken: number;
  onClose: () => void;
}) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [query, setQuery] = useState(() => {
    // text selected when it opens becomes the search (a short single line only)
    const { from, to, empty } = editor.state.selection;
    const picked = empty ? "" : editor.state.doc.textBetween(from, to, " ");
    return picked.length <= 80 ? picked : "";
  });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    editor.on("transaction", rerender);
    return () => {
      editor.off("transaction", rerender);
      setFindQuery(editor, "");
    };
  }, [editor]);

  // Opens and every Ctrl+F after: the box takes the cursor with its words selected.
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusToken]);

  // The first words (from the selection) are searched on opening; later ones as they are typed.
  useEffect(() => {
    setFindQuery(editor, query);
  }, [editor, query]);

  const { matches, current } = findState(editor.state);
  const close = () => {
    onClose();
    editor.commands.focus();
  };

  return (
    <div className="find-bar" role="search" aria-label="Buscar en la página">
      <input
        ref={input}
        type="text"
        value={query}
        placeholder="Buscar en la página…"
        aria-label="Buscar en la página"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          } else if (e.key === "Enter") {
            e.preventDefault();
            stepFind(editor, e.shiftKey ? -1 : 1);
          }
        }}
      />
      <span className="find-bar-count" aria-live="polite">
        {query ? (matches.length ? `${current + 1} de ${matches.length}` : "Sin resultados") : ""}
      </span>
      <button
        type="button"
        title="Anterior (Mayús+Intro)"
        aria-label="Anterior"
        onClick={() => stepFind(editor, -1)}
      >
        <ChevronUp size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        title="Siguiente (Intro)"
        aria-label="Siguiente"
        onClick={() => stepFind(editor, 1)}
      >
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <button type="button" title="Cerrar (Esc)" aria-label="Cerrar la búsqueda" onClick={close}>
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
