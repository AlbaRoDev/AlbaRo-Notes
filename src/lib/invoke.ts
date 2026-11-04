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

export async function invoke<T>(
  command: string,
  args?: InvokeArgs,
  options?: InvokeOptions,
): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args, options);
  } catch (e) {
    throw typeof e === "string" && getLang() === "en" ? translateError(e) : e;
  }
}
