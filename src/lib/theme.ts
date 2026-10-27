import { CURSOR_VARIABLES, cursorVariables } from "./cursor";
import { PALETTE_VARIABLES, paletteFor } from "./palette";
import { readPref, writePref } from "./prefs";
import { seasonFor } from "./seasons";

export type ThemePref = "system" | "light" | "dark";

const KEY = "theme";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

export function getThemePref(): ThemePref {
  const stored = readPref(KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

/** The mouse pointer: the system's, or a minimal arrow and hand without colour (src/lib/cursor.ts). */
export type CursorPref = "minimal" | "system";

const CURSOR_KEY = "cursor";

export function getCursorPref(): CursorPref {
  return readPref(CURSOR_KEY) === "minimal" ? "minimal" : "system";
}

/** Sets or takes off the pointer images; they are drawn light or dark to match the theme that is showing now. */
function applyCursor(root: HTMLElement) {
  if (getCursorPref() === "system") {
    delete root.dataset.cursor;
    for (const name of CURSOR_VARIABLES) root.style.removeProperty(name);
    return;
  }
  root.dataset.cursor = "minimal";
  for (const [name, value] of Object.entries(cursorVariables(root.dataset.theme === "dark"))) {
    root.style.setProperty(name, value);
  }
}

const cursorListeners = new Set<(pref: CursorPref) => void>();

export function onCursorPrefChange(listener: (pref: CursorPref) => void): () => void {
  cursorListeners.add(listener);
  return () => cursorListeners.delete(listener);
}

export function setCursorPref(pref: CursorPref) {
  writePref(CURSOR_KEY, pref);
  applyCursor(document.documentElement);
  cursorListeners.forEach((l) => l(pref));
}

/** How it looks besides light or dark: Notion's sober palette, or the colours of the season (the website's and the Downloader's). */
export type StylePref = "themed" | "sober";

const STYLE_KEY = "style";

export function getStylePref(): StylePref {
  return readPref(STYLE_KEY) === "sober" ? "sober" : "themed";
}

// The theme and the style are applied together: the themed palette is set as inline variables on <html>, over
// App.css's, and taken off again when the style goes back to sober. The season is the one for the date, read when
// the look is applied (at start, on a change, and when the window comes back to the front), not on a timer.
function apply(pref: ThemePref, style: StylePref = getStylePref(), now = new Date()) {
  const root = document.documentElement;
  const dark = pref === "dark" || (pref === "system" && systemDark.matches);
  root.dataset.theme = dark ? "dark" : "light";
  if (style === "sober") {
    delete root.dataset.style;
    delete root.dataset.season;
    for (const name of PALETTE_VARIABLES) root.style.removeProperty(name);
    applyCursor(root);
    return;
  }
  const season = seasonFor(now);
  root.dataset.style = "themed";
  root.dataset.season = season;
  for (const [name, value] of Object.entries(paletteFor(season, dark ? "dark" : "light"))) {
    root.style.setProperty(name, value);
  }
  applyCursor(root);
}

const styleListeners = new Set<(style: StylePref) => void>();

export function onStylePrefChange(listener: (style: StylePref) => void): () => void {
  styleListeners.add(listener);
  return () => styleListeners.delete(listener);
}

export function setStylePref(style: StylePref) {
  writePref(STYLE_KEY, style);
  apply(getThemePref(), style);
  styleListeners.forEach((l) => l(style));
}

// Whoever shows the choice (the sidebar's selector) hears about changes made elsewhere (the Ctrl+K palette).
const listeners = new Set<(pref: ThemePref) => void>();

export function onThemePrefChange(listener: (pref: ThemePref) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setThemePref(pref: ThemePref) {
  writePref(KEY, pref);
  apply(pref);
  listeners.forEach((l) => l(pref));
}

/** Ctrl+Shift+L, as Notion's: flips between light and dark whatever is showing now. */
export function toggleTheme() {
  setThemePref(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

/** Called once before the first render, so the page never flashes the wrong theme. */
export function initTheme() {
  apply(getThemePref());
  systemDark.addEventListener("change", () => apply(getThemePref()));
  // a season that turns while the app stays open shows when the window is next looked at
  document.addEventListener("visibilitychange", () => !document.hidden && apply(getThemePref()));
}
