// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The dialog plugin replaces `window.confirm` with an async function: `if (window.confirm(…))` is then always true and a
// delete runs without waiting for the answer. Questions go through `askConfirm` (src/lib/confirm.ts).
function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test("no source file asks with the webview's confirm", () => {
  const code = (file) =>
    readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
  const offenders = sources("src").filter((file) =>
    /(?:window|globalThis)\.confirm\(/.test(code(file)),
  );
  assert.deepEqual(offenders, []);
});
