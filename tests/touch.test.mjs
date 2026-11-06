// Run with: node --test tests/
// A control the CSS hides until the pointer is over it has no way to show on a touch screen unless touch.css
// shows it. This finds every class that a stylesheet hides (`opacity: 0` / `visibility: hidden`) and reveals on
// `:hover`, and fails when touch.css does not name it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

function cssFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? cssFiles(join(dir, e.name))
      : e.name.endsWith(".css")
        ? [join(dir, e.name)]
        : [],
  );
}

/** [selector, body] of the plain rules of a stylesheet (nested at-rules are flattened; good enough here). */
function rules(css) {
  const out = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push([m[1].trim(), m[2]]);
  }
  return out;
}

/** A regexp for `.cls` as a whole class name (not the start of a longer one). */
const hasClass = (cls) => new RegExp(String.raw`\.${cls}(?![\w-])`);
const lastClass = (selector) => selector.match(/\.([\w-]+)(?=[^.]*$)/)?.[1];

// Hidden for another reason than the pointer being away: they are shown by selection or focus, or they are
// not controls at all.
const NOT_HOVER_ONLY = new Set([
  "image-handle", // image: shown when selected, resized or focused too
  "image-toolbar",
  "fold-inner",
  "save-indicator",
  "calendar-chip",
  "db-calc-cell",
  "sidebar-item-disclosure",
  "media-picker-upload", // the file input laid over its button
  "sidebar", // folded away, not hover
]);

test("every control that shows only on hover is shown by touch.css", () => {
  const touch = readFileSync(join(SRC, "touch.css"), "utf8");
  const missing = new Set();
  for (const file of cssFiles(SRC)) {
    if (file.endsWith("touch.css")) continue;
    const all = rules(readFileSync(file, "utf8"));
    const hoverText = all
      .filter(([sel]) => /:hover|:focus-within/.test(sel) && !sel.includes(":not(:hover)"))
      .map(([sel]) => sel)
      .join("\n");
    for (const [selector, body] of all) {
      if (!/opacity:\s*0\s*;|visibility:\s*hidden/.test(body)) continue;
      for (const sel of selector.split(",")) {
        const cls = lastClass(sel);
        if (!cls || NOT_HOVER_ONLY.has(cls) || !hasClass(cls).test(hoverText)) continue;
        if (!hasClass(cls).test(touch)) missing.add(`${cls} (${file.slice(SRC.length)})`);
      }
    }
  }
  assert.deepEqual([...missing], [], "hover-only, and not in touch.css");
});
