// Translations. The Spanish text is the key: `t("Guardar")` gives "Guardar" in Spanish and, in English, whatever
// src/locales/en.ts maps it to (the text itself if it has no entry). `{name}` in a text is filled from `params`.
// The language is read once when the page loads and changing it reloads the page, so module-level constants that
// call `t` are right too. tests/i18n.test.mjs checks that every key used in the code has its English entry.
import { en } from "../locales/en.ts";
import { readPref, writePref } from "./prefs.ts";

export type Lang = "es" | "en";

const KEY = "lang";

export function getLang(): Lang {
  const stored = readPref(KEY);
  if (stored === "es" || stored === "en") return stored;
  return (globalThis.navigator?.language ?? "es").toLowerCase().startsWith("es") ? "es" : "en";
}

const lang = getLang();

/** BCP 47 tag for `Intl` and `toLocaleString`. */
export const locale = lang === "es" ? "es-ES" : "en-US";

if (typeof document !== "undefined") document.documentElement.lang = lang;

export function t(text: string, params?: Record<string, string | number>): string {
  const out = lang === "en" ? (en[text] ?? text) : text;
  return params
    ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
    : out;
}

export function setLang(next: Lang) {
  writePref(KEY, next);
  window.location.reload();
}
