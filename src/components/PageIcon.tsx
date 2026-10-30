import { parseIcon, useIconLibrary } from "../lib/icon-library";
import type { LucideIcon } from "lucide-react";

/** One icon of the library by name, with its colour; empty for the instant the library is still arriving. */
export function LucideByName({
  name,
  size,
  color,
  known,
}: {
  name: string;
  size: number;
  color?: string | null;
  /** An icon the app already has in its bundle, so the library need not be fetched for it. */
  known?: LucideIcon;
}) {
  const lib = useIconLibrary(!known);
  const Icon = known ?? lib?.[name];
  if (!Icon)
    return (
      <span style={{ display: "inline-block", width: size, height: size }} aria-hidden="true" />
    );
  return (
    <Icon
      size={size}
      strokeWidth={1.75}
      style={color ? { color: `var(--text-${color})` } : undefined}
      aria-hidden="true"
    />
  );
}

/**
 * What a page's icon looks like: its emoji as text, or an icon of the library in its colour. The caller's own
 * wrapper (the sidebar's span, the header's button) keeps its sizing; `size` is for the library's icons.
 */
export function PageIcon({ icon, size }: { icon: string; size: number }) {
  const parsed = parseIcon(icon);
  if (parsed.kind === "emoji") return <>{parsed.text}</>;
  return <LucideByName name={parsed.name} size={size} color={parsed.color} />;
}
