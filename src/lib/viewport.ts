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
  // The system's letter size (Android's «font scale») makes the text bigger but not the lengths in `rem` or `em`: a
  // bar `3.5rem` high stays 56 px with 32 px letters. `--text-zoom` is how much bigger the letters are, for the
  // few boxes that hold text and must grow with it (the root's own size is 16 px unless the system changes it).
  root.style.setProperty(
    "--text-zoom",
    String(parseFloat(getComputedStyle(root).fontSize) / 16 || 1),
  );
  window.addEventListener("resize", publish);
}

const subscribe = (notify: () => void) => {
  window.addEventListener("resize", notify);
  return () => window.removeEventListener("resize", notify);
};

/** The size class of the window, for what the CSS cannot decide (which component to draw). */
export const useSizeClass = (): SizeClass => useSyncExternalStore(subscribe, current);
