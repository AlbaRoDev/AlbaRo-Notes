// Run with: node --test tests/   (Node 22.18+ loads the .ts module directly, stripping its types)
import { test } from "node:test";
import assert from "node:assert/strict";
import postcss from "postcss";
import { hoverOnlyWhereHoverExists } from "../scripts/hover-media.ts";

// PostCSS spaces what it adds its own way: compare without the spaces around braces
const flat = (css) =>
  css
    .replace(/\s+/g, " ")
    .replace(/ ?([{}]) ?/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
const run = async (css) =>
  flat((await postcss([hoverOnlyWhereHoverExists()]).process(css, { from: undefined })).css);
const Q = "@media (hover: hover), (pointer: fine)";

test("a :hover rule only exists where a pointer can hover", async () => {
  const out = await run(".a:hover { color: red; }");
  assert.equal(out, flat(`${Q} { .a:hover { color: red; } }`));
});

test("in a list, the selectors without :hover stay outside the media query", async () => {
  const out = await run(".a:hover, .b:focus-visible { opacity: 1; }");
  assert.ok(out.startsWith(".b:focus-visible { opacity: 1; }"), out);
  assert.ok(out.includes(flat(`${Q} { .a:hover { opacity: 1; } }`)), out);
});

test("rules without :hover and rules already wrapped are left alone, and it does not loop", async () => {
  assert.equal(await run(".a { color: red; }"), flat(".a { color: red; }"));
  const wrapped = `${Q} { .a:hover { color: red; } }`;
  assert.equal(await run(wrapped), flat(wrapped));
});

test("inside another media query the rule is wrapped there", async () => {
  const out = await run("@media (max-width: 600px) { .a:hover { color: red; } }");
  assert.equal(out, flat(`@media (max-width: 600px) { ${Q} { .a:hover { color: red; } } }`));
});
