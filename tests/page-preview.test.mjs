// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { previewLine, previewItems } from "../src/lib/markdown-blocks.ts";

test("a heading is marked and the Markdown syntax marks are dropped from the card's lines", () => {
  assert.deepEqual(previewLine("## 1. Fundamentos"), { text: "1. Fundamentos", heading: true });
  assert.deepEqual(previewLine("- **uno** y `dos`"), { text: "• uno y dos", heading: false });
  assert.deepEqual(previewLine("- [ ] pendiente"), { text: "☐ pendiente", heading: false });
  assert.deepEqual(previewLine("> una cita"), { text: "una cita", heading: false });
});

test("the card lists the pages a page links to, keeps the text around them and leaves out blocks with no text form", () => {
  const nodes = [
    { type: "paragraph", content: [{ type: "text", text: "Intro" }] },
    { type: "pageLink", attrs: { pageId: "a" } },
    { type: "pageLink", attrs: { pageId: null } },
    { type: "canvasBlock" },
    { type: "pageLink", attrs: { pageId: "b" } },
  ];
  assert.deepEqual(previewItems(nodes, 8), [
    { text: "Intro", heading: false },
    { pageId: "a" },
    { pageId: "b" },
  ]);
  assert.equal(previewItems(nodes, 2).length, 2);
});
