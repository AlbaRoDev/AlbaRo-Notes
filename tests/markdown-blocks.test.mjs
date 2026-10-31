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

test("Notion's <aside> is a callout whose first line is its icon", () => {
  const blocks = markdownToBlocks(
    "<aside>\n📝\n\nNotas de formato\n\n⚠️, 💡: Callouts (/callout).\n</aside>\n\nDespués",
  );
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["callout", "paragraph"],
  );
  assert.equal(blocks[0].attrs.icon, "📝");
  assert.equal(blocks[0].content.length, 2, "the icon line is not a paragraph of the callout");
  assert.equal(markdownToBlocks("<aside>\nSolo texto\n</aside>")[0].attrs.icon, null);
  assert.equal(markdownToBlocks("<aside>\n💡\n</aside>")[0].content[0].type, "paragraph");
  // and back: the icon first, alone, then the blocks
  assert.match(blocksToMarkdown(blocks.slice(0, 1)), /^<aside>\n📝\n\nNotas de formato\n\n/);
  assert.match(blocksToMarkdown(blocks.slice(0, 1)), /\n<\/aside>$/);
});

test("Notion's toggle, a bullet with its blocks indented under it after a blank line, is a toggle", () => {
  const sample =
    "- Convenciones de nombres de ramas\n    \n    ```\n    feature/add-user-auth\n    bugfix/fix-login-redirect\n    ```\n";
  const [toggle] = markdownToBlocks(sample);
  assert.equal(toggle.type, "toggle");
  assert.deepEqual(
    toggle.content.map((c) => c.type),
    ["toggleSummary", "toggleContent"],
  );
  assert.equal(toggle.content[0].content[0].text, "Convenciones de nombres de ramas");
  const code = toggle.content[1].content[0];
  assert.equal(code.type, "codeBlock");
  assert.equal(code.content[0].text, "feature/add-user-auth\nbugfix/fix-login-redirect");
  // an ordinary bullet, one with a wrapped line, and one with a nested list stay lists
  for (const plain of ["- uno\n- dos", "- uno\n  sigue aquí", "- uno\n\n  - dentro"]) {
    assert.equal(markdownToBlocks(plain)[0].type, "bulletList", plain);
  }
  // the HTML form, and back to Notion's own
  const [details] = markdownToBlocks(
    "<details>\n<summary>Título</summary>\n\nTexto dentro\n\n</details>",
  );
  assert.equal(details.type, "toggle");
  assert.equal(details.content[1].content[0].content[0].text, "Texto dentro");
  assert.match(
    blocksToMarkdown([toggle]),
    /^- Convenciones de nombres de ramas\n\n    ```\n    feature/,
  );
});

test("a Notion toggle survives Windows line ends, no-break spaces and a fence right under the bullet", () => {
  const body = "- Título\n    \n    ```\n    uno\n    dos\n    ```\n";
  for (const [name, text] of [
    ["crlf", body.replace(/\n/g, "\r\n")],
    ["nbsp", body.replace(/    /g, "\u00a0\u00a0\u00a0\u00a0")],
    ["fence right under", "- Título\n    ```\n    uno\n    dos\n    ```\n"],
  ]) {
    const [toggle] = markdownToBlocks(text);
    assert.equal(toggle?.type, "toggle", name);
    assert.equal(toggle.content[1].content[0].content[0].text, "uno\ndos", name);
  }
});
