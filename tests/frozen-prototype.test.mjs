// The webview freezes Object.prototype, and the libraries behind the Word reader assign `toString`, `valueOf` or
// `constructor` on their own prototypes while loading, which then throws in strict mode: no .docx could be
// imported. This bundles the reader as the app does, loads it with the prototype frozen and converts a real .docx.
// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "vite";
import { frozenPrototypeFix } from "../scripts/frozen-prototype.ts";

// inside node_modules (git ignores it, and "mammoth" resolves from there)
const dir = mkdtempSync(join(process.cwd(), "node_modules", ".albaro-frozen-"));
const entry = join(dir, "entry.mjs");
writeFileSync(entry, 'import * as m from "mammoth"; export const mammoth = m.default ?? m;');

// the reader bundled as a strict script (a module in the webview is strict), with or without the fix
async function bundle(plugins) {
  const outDir = join(dir, plugins.length ? "fixed" : "plain");
  await build({
    configFile: false,
    logLevel: "silent",
    root: process.cwd(), // resolves "mammoth" from the project
    plugins,
    build: {
      lib: { entry, formats: ["iife"], name: "M", fileName: () => "reader.js" },
      outDir,
      minify: false,
      rolldownOptions: { output: { banner: '"use strict";' } },
    },
  });
  return join(outDir, "reader.js");
}

// loads the bundle with Object.prototype frozen and converts the fixture; prints the HTML or the error
const convert = (file) =>
  execFileSync(
    process.execPath,
    [
      "-e",
      `const fs = require("node:fs");
       Object.freeze(Object.prototype);
       (async () => {
         try {
           const M = (0, eval)(fs.readFileSync(process.argv[1], "utf8") + "\\n;M");
           const buf = fs.readFileSync(process.argv[2]);
           const r = await M.mammoth.convertToHtml({ arrayBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) });
           console.log(r.value);
         } catch (e) { console.log("ERROR " + e.message); }
       })();`,
      file,
      "tests/fixtures/minimal.docx",
    ],
    { encoding: "utf8" },
  ).trim();

test("the Word reader cannot load with a frozen Object.prototype as it ships", async () => {
  assert.match(convert(await bundle([])), /^ERROR Cannot assign to read only property/);
});

test("with the fix it converts a .docx", async () => {
  const html = convert(await bundle([frozenPrototypeFix()]));
  assert.equal(
    html,
    "<h1>Documento Word de prueba</h1><p>Un párrafo normal del documento Word con acentos áéíóú.</p><p><strong>Texto en negrita.</strong></p>",
  );
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
