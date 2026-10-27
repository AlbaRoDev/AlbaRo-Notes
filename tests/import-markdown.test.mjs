// Run with: node --test tests/   (Node 22.18+ loads the .ts module directly, stripping its types)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  imageLines,
  joinSoftWraps,
  markdownToPageDoc,
  splitFrontMatter,
  titleFromFileName,
} from "../src/lib/import-markdown.ts";

const text = (node) => (node.content ?? []).map((n) => n.text ?? "").join("");

test("the first heading is the title; without one the file name is, or the front matter's title", () => {
  const own = markdownToPageDoc("# Mi plan\n\nHola", "nombre");
  assert.deepEqual(
    own.content.map((n) => n.type),
    ["heading", "paragraph"],
  );
  assert.equal(text(own.content[0]), "Mi plan");

  const named = markdownToPageDoc("Solo un párrafo", "Mi_nota");
  assert.equal(text(named.content[0]), "Mi_nota");
  assert.equal(named.content[0].attrs.level, 1);

  const front = markdownToPageDoc('---\ntitle: "Con cabecera"\ntags: [a]\n---\nCuerpo', "x");
  assert.equal(text(front.content[0]), "Con cabecera");
  assert.equal(front.content.length, 2, "the header is not in the page");
  assert.deepEqual(splitFrontMatter("sin cabecera").title, null);
  // a lone `---` rule is not a header
  assert.equal(markdownToPageDoc("# T\n\n---\n\nfin", "x").content[1].type, "horizontalRule");
});

test("a page is never just a title, and a long title is cut", () => {
  assert.equal(markdownToPageDoc("", "Vacía").content.at(-1).type, "paragraph");
  const long = markdownToPageDoc("x", "y".repeat(500));
  assert.equal(text(long.content[0]).length, 200);
  assert.equal(titleFromFileName("Mi_nota.final.md"), "Mi nota.final");
  assert.equal(titleFromFileName(".md"), "Sin título");
});

test("lines a paragraph was wrapped over become one paragraph; lists, code and tables are left alone", () => {
  const md = [
    "# T",
    "",
    "Una frase que se partió",
    "en tres líneas",
    "de ochenta columnas.",
    "",
    "- elemento uno que sigue",
    "  en la línea de abajo",
    "- elemento dos",
    "",
    "```js",
    "const a = 1;",
    "const b = 2;",
    "```",
    "",
    "| a | b |",
    "| - | - |",
    "| 1 | 2 |",
  ].join("\n");
  const joined = joinSoftWraps(md);
  assert.ok(joined.includes("Una frase que se partió en tres líneas de ochenta columnas."));
  assert.ok(joined.includes("- elemento uno que sigue en la línea de abajo"));
  assert.ok(joined.includes("const a = 1;\nconst b = 2;"), "code keeps its lines");
  const doc = markdownToPageDoc(md, "x");
  assert.deepEqual(
    doc.content.map((n) => n.type),
    ["heading", "paragraph", "bulletList", "codeBlock", "table"],
  );
  assert.equal(doc.content[2].content.length, 2);
});

test("an image alone on its line becomes the block the caller makes, else its alt text", () => {
  const md =
    "# T\n\n![Diagrama](img/d.png)\n\nTexto ![no sola](a.png) sigue\n\n```\n![en código](x.png)\n```";
  assert.deepEqual(imageLines(md), [{ src: "img/d.png", alt: "Diagrama" }]);
  const withBlock = markdownToPageDoc(md, "x", (src, alt) => ({
    type: "image",
    attrs: { file: src, name: alt },
  }));
  assert.equal(withBlock.content[1].type, "image");
  assert.equal(withBlock.content[1].attrs.name, "Diagrama");
  const without = markdownToPageDoc(md, "x");
  assert.equal(without.content[1].type, "paragraph");
  assert.equal(text(without.content[1]), "Diagrama");
  // the code block's image text is code, not an image
  assert.equal(JSON.stringify(withBlock).includes('"file":"x.png"'), false);
});

test("Windows line endings and a byte-order mark are fine", () => {
  const doc = markdownToPageDoc("﻿# Título\r\n\r\nUna\r\nlínea\r\n", "x");
  assert.equal(text(doc.content[0]), "Título");
  assert.equal(text(doc.content[1]), "Una línea");
});
