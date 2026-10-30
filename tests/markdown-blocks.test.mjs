// Run with: node --test tests/   (Node 22.18+ loads the .ts module directly, stripping its types)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blocksToMarkdown,
  inlineToNodes,
  isOnlyText,
  markdownToBlocks,
} from "../src/lib/markdown-blocks.ts";

const text = (t, marks) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });
const p = (...content) => ({ type: "paragraph", content });

test("each plain line is a paragraph, blank lines vanish", () => {
  assert.deepEqual(markdownToBlocks("leche\npan\n\nhuevos"), [
    p(text("leche")),
    p(text("pan")),
    p(text("huevos")),
  ]);
});

test("inline marks, nested and linked", () => {
  assert.deepEqual(inlineToNodes("a **b *c* d** `d` ~~e~~ [f](https://x.es) snake_case 2*3*4"), [
    text("a "),
    text("b ", [{ type: "bold" }]),
    text("c", [{ type: "bold" }, { type: "italic" }]),
    text(" d", [{ type: "bold" }]),
    text(" "),
    text("d", [{ type: "code" }]),
    text(" "),
    text("e", [{ type: "strike" }]),
    text(" "),
    text("f", [{ type: "link", attrs: { href: "https://x.es" } }]),
    text(" snake_case 2*3*4"), // no italics inside words or numbers
  ]);
  // only http(s) links become links
  assert.deepEqual(inlineToNodes("[x](javascript:alert(1))"), [text("[x](javascript:alert(1))")]);
});

test("checklists, nested lists and ordered starts", () => {
  const [tasks] = markdownToBlocks("- [ ] Comprar pan\n- [x] Llamar\n  - detalle");
  assert.equal(tasks.type, "taskList");
  assert.deepEqual(tasks.content[0], {
    type: "taskItem",
    attrs: { checked: false },
    content: [p(text("Comprar pan"))],
  });
  assert.equal(tasks.content[1].attrs.checked, true);
  assert.equal(tasks.content[1].content[1].type, "bulletList"); // nested under its item
  const [ordered] = markdownToBlocks("3. tres\n4. cuatro");
  assert.deepEqual(ordered.attrs, { start: 3 });
  assert.equal(ordered.content.length, 2);
  // a different marker starts a new list
  assert.deepEqual(
    markdownToBlocks("- a\n1. b").map((b) => b.type),
    ["bulletList", "orderedList"],
  );
});

test("headings, quotes, code, rules and tables", () => {
  const blocks = markdownToBlocks(
    "# Título\n#### Pequeño\n> cita\n> dos\n```js\nlet a = 1;\n```\n---\n| A | B |\n|---|:-:|\n| 1 | **2** |\n| 3 |",
  );
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["heading", "heading", "blockquote", "codeBlock", "horizontalRule", "table"],
  );
  assert.equal(blocks[1].attrs.level, 4); // the editor has H1–H4
  assert.equal(blocks[2].content.length, 2);
  assert.deepEqual(blocks[3], {
    type: "codeBlock",
    attrs: { language: "js" },
    content: [text("let a = 1;")],
  });
  const table = blocks[5];
  assert.equal(table.content[0].content[0].type, "tableHeader");
  assert.equal(table.content[2].content.length, 2); // short rows padded to the header's width
  assert.deepEqual(table.content[1].content[1].content[0], p(text("2", [{ type: "bold" }])));
});

test("blocks to Markdown and back keep the structure", () => {
  const md =
    "## Plan\n\n- [ ] uno\n- [x] **dos**\n\n1. a\n2. b\n  - b1\n\n> nota\n\n| X | Y |\n| --- | --- |\n| 1 | 2 |";
  const blocks = markdownToBlocks(md);
  assert.deepEqual(markdownToBlocks(blocksToMarkdown(blocks)), blocks);
});

test("only plain text blocks may be replaced", () => {
  assert.equal(isOnlyText(markdownToBlocks("- [ ] a\n\n| A |\n|---|\n| 1 |")), true);
  assert.equal(isOnlyText([{ type: "image", attrs: { file: "x.png" } }]), false);
  assert.equal(
    isOnlyText([p(text("hola"), { type: "pageMention", attrs: { pageId: "x" } })]),
    false,
  );
});
