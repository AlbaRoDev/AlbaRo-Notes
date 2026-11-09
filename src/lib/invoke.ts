// `invoke` for every call to Rust. Rust writes its error texts in Spanish; here they are turned into the language of
// the interface, so the pages never see the Spanish original in English (a text with no entry stays as it came).
import { invoke as tauriInvoke, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";
import { enRust } from "../locales/en-rust.ts";
import { getLang } from "./i18n.ts";

/** A Rust text with `{name}` / `{}` holes, as a pattern that captures what filled them. */
const patterns = Object.entries(enRust)
  .filter(([es]) => /\{[^}]*\}/.test(es))
  .map(([es, en]) => ({
    regex: new RegExp(
      "^" +
        es
          .split(/\{[^}]*\}/)
          .map((part) => part.replace(/[.*+?^$()|[\]\\]/g, "\\$&"))
          .join("([\\s\\S]+?)") +
        "$",
    ),
    en,
  }));

export function translateError(text: string): string {
  const exact = enRust[text];
  if (exact !== undefined) return exact;
  for (const { regex, en } of patterns) {
    const found = regex.exec(text);
    if (!found) continue;
    let next = 1;
    // every hole, named or not, takes the captures in the order Rust wrote them
    return en.replace(/\{[^}]*\}/g, () => found[next++] ?? "");
  }
  return text;
}

/**
 * On a phone the page can start asking before Rust has finished opening the database (the first start migrates a
 * new one): Tauri answers "state not managed" until `setup` is done. That is waiting, not an error.
 */
export function isStartingUp(error: unknown): boolean {
  return typeof error === "string" && error.startsWith("state not managed for field");
}

/** How long a command waits for Rust to be ready, and between tries (ms). */
const STARTUP_WAIT = 20_000;
const STARTUP_STEP = 50;

export async function invoke<T>(
  command: string,
  args?: InvokeArgs,
  options?: InvokeOptions,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    try {
      return await tauriInvoke<T>(command, args, options);
    } catch (e) {
      if (isStartingUp(e) && Date.now() - started < STARTUP_WAIT) {
        await new Promise((resolve) => setTimeout(resolve, STARTUP_STEP));
        continue;
      }
      throw typeof e === "string" && getLang() === "en" ? translateError(e) : e;
    }
  }
}
