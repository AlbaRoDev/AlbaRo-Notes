// Android's webview answers a folder input with its plain file picker (a folder cannot be chosen), so the palette
// must not offer «Importar una carpeta…» there. Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the folder import command is left out on Android", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  const at = app.indexOf('id: "import-folder"');
  assert.ok(at > 0, "the command is gone: delete this test");
  const before = app.slice(Math.max(0, at - 400), at);
  assert.match(before, /TAURI_ENV_PLATFORM === "android"/);
});
