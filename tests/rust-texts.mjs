// The Spanish error texts the Rust side hands to the page (outside its tests), found in `Err(…)`, `ok_or(…)`,
// `ok_or_else(|| …)` and `map_err(|e| …)`. tests/i18n.test.mjs checks each has its English line in src/locales/en-rust.ts.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const AFTER =
  /(?:Err\(|ok_or\(|ok_or_else\(\|\|\s*|map_err\(\|[^|]*\|\s*)(?:format!\(\s*)?"((?:[^"\\]|\\.)*)"/g;
const SPANISH = /[áéíóúñ¿¡«]|\b(el|la|los|las|de|no|un|una|para|con|que|se|en|es|hay|falta|solo)\b/;

export function rustTexts(dir = "src-tauri/src") {
  const texts = new Map();
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".rs"))) {
    let source = readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n");
    const tests = source.indexOf("#[cfg(test)]");
    if (tests > 0) source = source.slice(0, tests);
    for (const match of source.matchAll(AFTER)) {
      const text = match[1]
        .replace(/\\\n\s*/g, "")
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"');
      if (
        SPANISH.test(text) &&
        /[a-z]{3}/.test(text) &&
        !/^(SELECT|INSERT|UPDATE|DELETE|PRAGMA)/.test(text)
      ) {
        if (!texts.has(text)) texts.set(text, file);
      }
    }
  }
  return texts;
}

if (
  import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` ||
  process.argv[2] === "--list"
) {
  const all = [...rustTexts().keys()];
  console.log(all.length);
  all.forEach((text, i) => console.log(`${i}\t${JSON.stringify(text)}`));
}
