import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Database, FileText, Search, type LucideIcon } from "lucide-react";
import { searchPages } from "../../lib/db-client";
import type { SearchResult } from "../../types";
import "./SearchModal.css";

// Rust wraps each match in these private-use characters (search.rs MARK_START / MARK_END).
const MARK_START = String.fromCharCode(0xe000);
const MARK_END = String.fromCharCode(0xe001);

/** Something the palette can do besides opening a page. */
export interface PaletteCommand {
  id: string;
  label: string;
  /** Extra words it answers to («crear», «modo noche»…). */
  keywords?: string;
  icon: LucideIcon;
  /** Shortcut shown on the right, if it has one. */
  hint?: string;
  run: () => void;
}

/** Rust wraps each match in MARK_START…MARK_END; render those stretches as <mark>, the rest as plain text (never HTML). */
function Marked({ text }: { text: string }) {
  const [before, ...marked] = text.split(MARK_START);
  return (
    <>
      {before}
      {marked.map((chunk, i) => {
        const [hit, rest = ""] = chunk.split(MARK_END);
        return (
          <span key={i}>
            <mark>{hit}</mark>
            {rest}
          </span>
        );
      })}
    </>
  );
}

// Same tolerance as the search itself: no accents, any case.
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function matchingCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return commands.filter((c) => {
    const text = fold(`${c.label} ${c.keywords ?? ""}`);
    return words.every((w) => text.includes(w));
  });
}

type Item = { kind: "command"; command: PaletteCommand } | { kind: "page"; page: SearchResult };

/**
 * Notion-style search and Ctrl+K palette: a dialog over the page with recent pages while the box
 * is empty, ranked full-text results (Rust, FTS5) as you type, and the actions that match.
 * ↑/↓ move, Enter opens or runs, Esc closes.
 */
export function SearchModal({
  commands,
  onOpen,
  onClose,
}: {
  commands: PaletteCommand[];
  onOpen: (pageId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // Debounced while typing; a reply that arrives after a newer query is dropped.
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(
      () =>
        void searchPages(query)
          .then((found) => {
            if (stale) return;
            setResults(found);
            setActive(0);
            setError(null);
          })
          .catch((e) => !stale && setError(String(e))),
      query ? 120 : 0,
    );
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const searching = query.trim() !== "";
  const actions = matchingCommands(commands, query);
  const pages = results ?? [];
  // While typing, matching actions come first (they're few and exact); with an empty box, recent pages do.
  const sections: { title: string; items: Item[] }[] = [
    {
      title: searching ? "Páginas" : "Recientes",
      items: pages.map((page) => ({ kind: "page", page }) as Item),
    },
    { title: "Acciones", items: actions.map((command) => ({ kind: "command", command }) as Item) },
  ];
  if (searching) sections.reverse();
  const items = sections.flatMap((s) => s.items);

  const choose = (item: Item) => {
    onClose();
    if (item.kind === "page") onOpen(item.page.id);
    else item.command.run();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const count = items.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (count)
        setActive(
          (i) => (Math.min(i, count - 1) + (e.key === "ArrowDown" ? 1 : count - 1)) % count,
        );
    } else if (e.key === "Enter" && items[Math.min(active, count - 1)]) {
      e.preventDefault();
      choose(items[Math.min(active, count - 1)]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const selected = Math.min(active, items.length - 1);
  let index = -1;

  return createPortal(
    <div className="search-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-modal" role="dialog" aria-modal="true" aria-label="Buscar">
        <div className="search-input-row">
          <Search size={18} aria-hidden="true" />
          <input
            autoFocus
            type="text"
            maxLength={200}
            placeholder="Busca páginas, bases de datos y filas, o una acción…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-label="Buscar"
            aria-expanded={items.length > 0}
            aria-controls="search-results"
            aria-activedescendant={items.length ? `search-item-${selected}` : undefined}
          />
        </div>
        <ul id="search-results" className="search-results" role="listbox" ref={listRef}>
          {sections.map(
            (section) =>
              section.items.length > 0 && (
                <li key={section.title} role="presentation" className="search-group">
                  <div className="search-section" aria-hidden="true">
                    {section.title}
                  </div>
                  <ul role="group" aria-label={section.title}>
                    {section.items.map((item) => {
                      const i = ++index;
                      const common = {
                        id: `search-item-${i}`,
                        role: "option",
                        "aria-selected": i === selected,
                        onMouseMove: () => i !== active && setActive(i),
                        onClick: () => choose(item),
                      };
                      if (item.kind === "command") {
                        const { command } = item;
                        return (
                          <li key={command.id} {...common}>
                            <command.icon
                              size={18}
                              strokeWidth={1.75}
                              className="search-icon"
                              aria-hidden="true"
                            />
                            <div className="search-text">
                              <div className="search-title">{command.label}</div>
                            </div>
                            {command.hint && <kbd className="search-hint">{command.hint}</kbd>}
                          </li>
                        );
                      }
                      const { page } = item;
                      const Icon = page.kind === "database" ? Database : FileText;
                      return (
                        <li key={page.id} {...common}>
                          <Icon
                            size={18}
                            strokeWidth={1.75}
                            className="search-icon"
                            aria-hidden="true"
                          />
                          <div className="search-text">
                            <div className="search-title">
                              <Marked text={page.title} />
                              {page.path.length > 0 && (
                                <span className="search-path">{page.path.join(" / ")}</span>
                              )}
                            </div>
                            {page.snippet && (
                              <div className="search-snippet">
                                <Marked text={page.snippet} />
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ),
          )}
        </ul>
        {error && (
          <p className="search-empty" role="alert">
            {error}
          </p>
        )}
        {results && items.length === 0 && !error && (
          <p className="search-empty">{searching ? "Sin resultados" : "Todavía no hay páginas"}</p>
        )}
        <div className="search-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> moverse
          </span>
          <span>
            <kbd>Intro</kbd> elegir
          </span>
          <span>
            <kbd>Esc</kbd> cerrar
          </span>
          <span className="search-footer-end">
            <kbd>Ctrl</kbd>
            <kbd>K</kbd> abrir desde cualquier sitio
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
