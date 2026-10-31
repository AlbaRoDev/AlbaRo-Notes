import {
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import type { Editor } from "@tiptap/core";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { findState, goToMatch, setFindQuery } from "./PageSearch";
import { clearCells, createCellHits, findCells, markCells } from "./table-find";
import "./FindBar.css";

/**
 * The find bar of a page (Ctrl+F): a box for the words, how many were found, previous and next, and close.
 * Enter goes to the next one, Shift+Enter to the previous and Esc closes it and gives the page its cursor back.
 * `focusToken` changes when Ctrl+F is pressed again, to put the cursor back in the box.
 * Besides the page's text it finds the cells of the database tables inside `scope`: first the text, then the cells.
 * Without an `editor` (the Gestor's task table is not a page) it finds cells only.
 */
export function FindBar({
  editor,
  scope,
  focusToken,
  onClose,
}: {
  editor: Editor | null;
  scope: RefObject<HTMLElement | null>;
  focusToken: number;
  onClose: () => void;
}) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [query, setQuery] = useState(() => {
    // text selected when it opens becomes the search (a short single line only)
    if (!editor) return "";
    const { from, to, empty } = editor.state.selection;
    const picked = empty ? "" : editor.state.doc.textBetween(from, to, " ");
    return picked.length <= 80 ? picked : "";
  });
  const input = useRef<HTMLInputElement>(null);
  const [hits] = useState(createCellHits);
  const { cells, at } = useSyncExternalStore(hits.subscribe, hits.get);
  const scrolledTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!editor) return;
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
    const root = scope.current;
    clearCells(root);
    const found = root ? findCells(root, query) : [];
    if (editor) setFindQuery(editor, query);
    // with nothing in the text the first cell is the first match
    hits.set(
      found,
      found.length > 0 && !(editor && findState(editor.state).matches.length) ? 0 : -1,
    );
    return () => clearCells(root);
  }, [editor, scope, hits, query]);

  // tints the cells and brings the shown one into view (once: not at every redraw)
  useEffect(() => {
    markCells(cells, at);
    const shownCell = cells[at] ?? null;
    if (shownCell && shownCell !== scrolledTo.current)
      shownCell.scrollIntoView({ block: "center", inline: "nearest" });
    scrolledTo.current = shownCell;
  });

  const { matches, current } = editor ? findState(editor.state) : { matches: [], current: 0 };
  const total = matches.length + cells.length;
  const shown = at >= 0 ? matches.length + at : current;
  const step = (dir: 1 | -1) => {
    if (total === 0) return;
    const next = (shown + dir + total) % total;
    hits.set(cells, next < matches.length ? -1 : next - matches.length);
    if (editor && next < matches.length) goToMatch(editor, next);
  };
  const close = () => {
    onClose();
    editor?.commands.focus();
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
            step(e.shiftKey ? -1 : 1);
          }
        }}
      />
      <span className="find-bar-count" aria-live="polite">
        {query ? (total ? `${shown + 1} de ${total}` : "Sin resultados") : ""}
      </span>
      <button
        type="button"
        title="Anterior (Mayús+Intro)"
        aria-label="Anterior"
        onClick={() => step(-1)}
      >
        <ChevronUp size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        title="Siguiente (Intro)"
        aria-label="Siguiente"
        onClick={() => step(1)}
      >
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <button type="button" title="Cerrar (Esc)" aria-label="Cerrar la búsqueda" onClick={close}>
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
