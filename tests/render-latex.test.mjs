// Run with: node --test tests/   (Node 22.18+ loads the .ts module directly, stripping its types)
import { test } from "node:test";
import assert from "node:assert/strict";
import katex from "katex";
import { renderLatex } from "../src/lib/render-latex.ts";

const heightOf = (html) =>
  [...html.matchAll(/height:\s*([\d.]+)em/g)].reduce((max, m) => Math.max(max, Number(m[1])), 0);

test("ordinary and broken LaTeX both render", () => {
  assert.match(renderLatex(katex, "\\frac{a}{b}", true), /katex-display/);
  assert.match(renderLatex(katex, "\\nonsense{", false), /katex-error/);
});

test("deep nesting is reported as not drawable instead of throwing", () => {
  const deep = "{".repeat(4900) + "x" + "}".repeat(4900);
  assert.equal(renderLatex(katex, deep, false), null);
  assert.throws(() => katex.renderToString(deep, { throwOnError: false }), RangeError);
});

test("a huge rule is clamped", () => {
  const html = renderLatex(katex, "\\rule{99999em}{99999em}", true);
  assert.ok(heightOf(html) <= 50, `height ${heightOf(html)}em`);
});

test("trust stays off: links, images and custom classes are not produced", () => {
  const html = renderLatex(
    katex,
    "\\href{javascript:alert(1)}{x}\\url{javascript:1}\\includegraphics{https://evil.test/x.png}\\htmlClass{x}{y}\\htmlStyle{color:red}{y}",
    false,
  );
  // The source LaTeX stays in the markup as inert text (`<annotation>`); what must not appear is a tag or attribute.
  assert.doesNotMatch(html, /<a[\s>]|<img|\shref=|\ssrc=|class="[^"]*\bx\b/);
  assert.match(html, /katex-html/);
});
