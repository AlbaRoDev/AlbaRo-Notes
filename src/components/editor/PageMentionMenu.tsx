import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { PageRef } from "./PageRef";
import type { SuggestionMenuHandle } from "./slash-commands/suggestion-render";
import type { PageSummary } from "../../types";
import "./slash-commands/SlashMenu.css";

/** The list under an «@»: the pages that match what has been typed after it, with ↑ ↓ and Enter. */
export const PageMentionMenu = forwardRef<
  SuggestionMenuHandle,
  { items: PageSummary[]; command: (page: PageSummary) => void }
>(({ items, command }, ref) => {
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowUp") setSelected((i) => (i + items.length - 1) % items.length);
      else if (event.key === "ArrowDown") setSelected((i) => (i + 1) % items.length);
      else if (event.key === "Enter" || event.key === "Tab") {
        const page = items[selected];
        if (page) command(page);
      } else return false;
      return true;
    },
  }));

  return (
    <div className="slash-menu" role="listbox" aria-label="Mencionar una página">
      <div className="slash-menu-category">Mencionar una página</div>
      {items.length === 0 && <div className="slash-menu-empty">Sin resultados</div>}
      {items.map((page, index) => (
        <button
          key={page.id}
          type="button"
          role="option"
          aria-selected={index === selected}
          className="slash-menu-item page-mention-item"
          data-selected={index === selected}
          onMouseEnter={() => setSelected(index)}
          onClick={() => command(page)}
        >
          <PageRef page={page} />
        </button>
      ))}
    </div>
  );
});
PageMentionMenu.displayName = "PageMentionMenu";
