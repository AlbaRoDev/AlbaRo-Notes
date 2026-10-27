import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { SlashCommandItem } from "./items";
import "./SlashMenu.css";

interface SlashMenuProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

export interface SlashMenuHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => setSelectedIndex(0), [items]);

  const selectItem = (index: number) => {
    const item = items[index];
    if (item) command(item);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="slash-menu">
        <div className="slash-menu-empty">Sin resultados</div>
      </div>
    );
  }

  return (
    <div className="slash-menu">
      {items.map((item, index) => {
        const Icon = item.icon;
        // Items are grouped by category already (see items.ts) — a header
        // just needs to appear whenever the category changes, no separate
        // grouping pass, and the flat index keeps arrow-key nav simple.
        const showHeader = index === 0 || items[index - 1].category !== item.category;
        return (
          <div key={item.title} className="slash-menu-item-wrapper">
            {showHeader && <div className="slash-menu-category">{item.category}</div>}
            <button
              type="button"
              className="slash-menu-item"
              data-selected={index === selectedIndex}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => selectItem(index)}
            >
              <Icon
                className="slash-menu-item-icon"
                size={16}
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span>{item.title}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
});
SlashMenu.displayName = "SlashMenu";
