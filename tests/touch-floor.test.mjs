// Run with: node --test tests/
// The size of what a finger presses lives in one value, `--touch-min` (touch.css). A rule that writes 44 px by hand
// stops following it, so the floor is raised in one place or not at all. Also the colour reading that tells Android
// what colour the page is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseColor } from "../src/lib/system-bars.ts";

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

test("no stylesheet sets a minimum touch size of 44px except as the fallback of --touch-min", () => {
  const bad = [];
  for (const file of cssFiles(SRC)) {
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/(min-(?:width|height))\s*:\s*([^;{}]*44px[^;{}]*);/g)) {
      if (!m[2].includes("var(--touch-min, 44px)")) bad.push(`${file}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("--touch-min is 48px on a phone, 52px from the medium class up, 44px under 360px", () => {
  const css = readFileSync(join(SRC, "touch.css"), "utf8");
  assert.match(css, /html\s*\{\s*--touch-min:\s*48px/);
  assert.match(
    css,
    /html\[data-size="medium"\],\s*html\[data-size="expanded"\]\s*\{\s*--touch-min:\s*52px/,
  );
  assert.match(css, /max-width:\s*359px\)\s*\{\s*html\s*\{\s*--touch-min:\s*44px/);
});

test("parseColor reads what the palette writes", () => {
  assert.equal(parseColor("#191919"), 0x191919);
  assert.equal(parseColor(" #fff "), 0xffffff);
  assert.equal(parseColor("rgb(27, 19, 11)"), (27 << 16) | (19 << 8) | 11);
  assert.equal(parseColor("rgba(255,0,0,0.5)"), 0xff0000);
  assert.equal(parseColor("var(--x)"), null);
  assert.equal(parseColor(""), null);
});
