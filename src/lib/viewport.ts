import { useSyncExternalStore } from "react";
import { sizeClassFor, type SizeClass } from "./size-class.ts";

/**
 * A phone or tablet build (the window has no title bar of its own) or the desktop test window that pretends to
 * be one (`ALBARO_MOBILE=1`). It says nothing about touch: that is `@media (hover: none)`.
 */
export const isMobile: boolean =
  ["android", "ios"].includes(import.meta.env.TAURI_ENV_PLATFORM ?? "") ||
  !!import.meta.env.VITE_ALBARO_MOBILE;

/** Spread on the empty parts of the top bar so they drag the window; a phone has no window to drag. */
export const dragRegion = isMobile ? {} : { "data-tauri-drag-region": "" };

const current = (): SizeClass => sizeClassFor(window.innerWidth);

/** Publishes `data-size` (and `data-mobile`) on <html>, for the CSS, and keeps it right as the window resizes, folds or splits. */
export function initViewport() {
  const root = document.documentElement;
  if (isMobile) root.dataset.mobile = "";
  const publish = () => (root.dataset.size = current());
  publish();
  window.addEventListener("resize", publish);
}

const subscribe = (notify: () => void) => {
  window.addEventListener("resize", notify);
  return () => window.removeEventListener("resize", notify);
};

/** The size class of the window, for what the CSS cannot decide (which component to draw). */
export const useSizeClass = (): SizeClass => useSyncExternalStore(subscribe, current);
