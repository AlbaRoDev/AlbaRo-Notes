// Window size classes (the same three Material uses). The layout follows the width of the window, never the
// device: a tablet in landscape is expanded, a desktop window dragged narrow is compact.

export type SizeClass = "compact" | "medium" | "expanded";

/** Under this width (CSS px) only one zone fits: phones upright. */
const COMPACT_MAX = 600;
/** Up to this width the window is medium: foldables open, small tablets upright, phones in landscape. */
const MEDIUM_MAX = 840;

export function sizeClassFor(width: number): SizeClass {
  if (width < COMPACT_MAX) return "compact";
  return width <= MEDIUM_MAX ? "medium" : "expanded";
}
