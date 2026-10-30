import { useState } from "react";
import type { Property } from "../../types";
import { parseIcon } from "../../lib/icon-library";
import { IconGrid } from "../IconGrid";
import { LucideByName } from "../PageIcon";
import { PROP_ICONS } from "./prop-icons";
import { typeChoiceOf } from "./property-types";

/** A column's icon: the one the user picked (an icon of the library or an emoji), else its type's. */
export function PropIcon({
  prop,
  size = 14,
}: {
  prop: Pick<Property, "type" | "config" | "icon">;
  size?: number;
}) {
  const parsed = prop.icon ? parseIcon(prop.icon, true) : null;
  if (parsed?.kind === "emoji") {
    return (
      <span className="prop-emoji" style={{ fontSize: size }} aria-hidden="true">
        {parsed.text}
      </span>
    );
  }
  if (parsed?.kind === "lucide") {
    // the few icons columns could wear before the library are already in the bundle
    return (
      <LucideByName
        name={parsed.name}
        size={size}
        color={parsed.color}
        known={PROP_ICONS[parsed.name]}
      />
    );
  }
  const Icon = typeChoiceOf(prop).icon;
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" />;
}

/** The picker behind a column's icon button: the icon library, a box for an emoji and «Quitar». */
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
      <IconGrid current={current} withColor={false} onPick={onPick} />
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
