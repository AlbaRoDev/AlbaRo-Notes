// Run with: node --test tests/   (Node 22.18+ loads the .ts module directly, stripping its types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { notionBlocksToContent } from "../src/lib/notion-clipboard.ts";

// Shaped like a real Notion copy (invented text): ids in `content`, rich text as [text, marks] pairs.
const copy = (roots, blocks) =>
  JSON.stringify({
    blocks: roots.map((blockId) => ({ blockId, blockSubtree: { block: blocks } })),
    action: "copy",
  });
const b = (type, title, extra = {}) => ({ value: { type, properties: { title }, ...extra } });

test("an empty toggle stays a toggle, not a bullet", () => {
  const out = notionBlocksToContent(copy(["a"], { a: b("toggle", [["Hola"]]) }));
  assert.deepEqual(out, [
    {
      type: "toggle",
      attrs: { open: true, headingLevel: null },
      content: [
        { type: "toggleSummary", content: [{ type: "text", text: "Hola" }] },
        { type: "toggleContent", content: [{ type: "paragraph" }] },
      ],
    },
  ]);
});

test("a toggle holds paragraph, nested bullets (merged into one list) and another toggle, with marks", () => {
  const out = notionBlocksToContent(
    copy(["t"], {
      t: b("toggle", [["Caja", [["b"]]]], { content: ["x", "y", "z", "u"] }),
      x: b("bulleted_list", [
        ["uno ", [["i"]]],
        ["web", [["a", "https://ejemplo.es"]]],
      ]),
      y: b("bulleted_list", [["dos"]], { content: ["n"] }),
      n: b("numbered_list", [["sub"]]),
      z: b("text", [["línea\nsegunda"]]),
      u: b("toggle", [["dentro"]], { content: ["c"] }),
      c: b("code", [["a = 1"]], { properties: { title: [["a = 1"]], language: [["Plain Text"]] } }),
    }),
  );
  const toggle = out[0];
  assert.equal(toggle.content[0].content[0].marks[0].type, "bold");
  const body = toggle.content[1].content;
  assert.deepEqual(
    body.map((n) => n.type),
    ["bulletList", "paragraph", "toggle"],
  );
  assert.equal(body[0].content.length, 2);
  assert.equal(body[0].content[0].content[0].content[1].marks[0].attrs.href, "https://ejemplo.es");
  assert.equal(body[0].content[1].content[1].type, "orderedList");
  assert.equal(body[1].content[1].type, "hardBreak");
  assert.equal(body[2].content[1].content[0].attrs.language, "plaintext");
});

test("a toggle heading keeps its level; a to-do keeps its checkmark", () => {
  const out = notionBlocksToContent(
    copy(["h", "d"], {
      h: b("sub_header", [["Título"]], { format: { toggleable: true } }),
      d: b("to_do", [["hecho"]], { properties: { title: [["hecho"]], checked: [["Yes"]] } }),
    }),
  );
  assert.equal(out[0].attrs.headingLevel, 2);
  assert.equal(out[1].content[0].attrs.checked, true);
});

test("without a toggle, with an unknown block, a mention or bad data: null, so the usual paste runs", () => {
  assert.equal(
    notionBlocksToContent(copy(["a"], { a: b("bulleted_list", [["solo punto"]]) })),
    null,
  );
  const toggleAnd = (other) => copy(["t", "o"], { t: b("toggle", [["x"]]), o: other });
  assert.equal(notionBlocksToContent(toggleAnd(b("image", [["foto"]]))), null);
  assert.equal(notionBlocksToContent(toggleAnd(b("text", [["‣", [["p", "id"]]]]))), null);
  assert.equal(notionBlocksToContent(toggleAnd(b("constructor", [["x"]]))), null);
  assert.equal(
    notionBlocksToContent(copy(["t"], { t: b("toggle", [["x"]], { content: ["falta"] }) })),
    null,
  );
  assert.equal(
    notionBlocksToContent(copy(["t"], { t: b("toggle", [["x"]], { content: ["t"] }) })),
    null,
  );
  assert.equal(notionBlocksToContent("no es json"), null);
  assert.equal(notionBlocksToContent("{}"), null);
});
