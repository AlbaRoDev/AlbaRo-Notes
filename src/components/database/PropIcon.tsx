import { useState } from "react";
import type { Property } from "../../types";
import { PROP_ICONS } from "./prop-icons";
import { typeChoiceOf } from "./property-types";

/** A column's icon: the one the user picked (a lucide name or an emoji), else its type's. */
export function PropIcon({
  prop,
  size = 14,
}: {
  prop: Pick<Property, "type" | "config" | "icon">;
  size?: number;
}) {
  const custom = prop.icon ? PROP_ICONS[prop.icon] : undefined;
  if (prop.icon && !custom) {
    return (
      <span className="prop-emoji" style={{ fontSize: size }} aria-hidden="true">
        {prop.icon}
      </span>
    );
  }
  const Icon = custom ?? typeChoiceOf(prop).icon;
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" />;
}

/** The picker behind a column's icon button: a grid of icons, a box for an emoji and «Quitar». */
export function IconPicker({
  current,
  onPick,
}: {
  current: string | null | undefined;
  onPick: (icon: string | null) => void;
}) {
  const [emoji, setEmoji] = useState("");
  return (
    <div className="pm-icons">
      <div className="pm-icon-grid" role="listbox" aria-label="Iconos">
        {Object.entries(PROP_ICONS).map(([name, Icon]) => (
          <button
            key={name}
            type="button"
            role="option"
            aria-selected={current === name}
            aria-label={name}
            title={name}
            onClick={() => onPick(name)}
          >
            <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ))}
      </div>
      <form
        className="pm-icon-emoji"
        onSubmit={(e) => {
          e.preventDefault();
          if (emoji.trim()) onPick(emoji.trim());
        }}
      >
        <input
          type="text"
          value={emoji}
          maxLength={8}
          placeholder="O escribe un emoji…"
          aria-label="Emoji para el icono"
          onChange={(e) => setEmoji(e.target.value)}
        />
      </form>
      {current && (
        <button type="button" className="pm-icon-reset" onClick={() => onPick(null)}>
          Quitar el icono
        </button>
      )}
    </div>
  );
}
