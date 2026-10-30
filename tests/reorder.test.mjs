// Run with: node --test tests/   (Node 22.18+ loads the .ts module directly, stripping its types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { moveItem, moveItems } from "../src/lib/reorder.ts";

const abcd = ["a", "b", "c", "d"];

test("an item moves before or after the one it is dropped on", () => {
  assert.deepEqual(moveItem(abcd, "d", "b", false), ["a", "d", "b", "c"]);
  assert.deepEqual(moveItem(abcd, "d", "b", true), ["a", "b", "d", "c"]);
  assert.deepEqual(moveItem(abcd, "a", "d", true), ["b", "c", "d", "a"]);
  assert.deepEqual(moveItem(abcd, "a", "c", false), ["b", "a", "c", "d"]);
});

test("a drop that changes nothing hands back the same array", () => {
  assert.equal(moveItem(abcd, "b", "b", true), abcd);
  assert.equal(moveItem(abcd, "b", "c", false), abcd); // already just before c
  assert.equal(moveItem(abcd, "c", "b", true), abcd); // already just after b
});

test("an item that is not in the list is ignored", () => {
  assert.equal(moveItem(abcd, "x", "b", false), abcd);
  assert.equal(moveItem(abcd, "a", "x", false), abcd);
});

test("several items move together, keeping their order", () => {
  assert.deepEqual(moveItems(abcd, ["d", "a"], "c", false), ["b", "a", "d", "c"]);
  assert.deepEqual(moveItems(abcd, ["a", "b"], "d", true), ["c", "d", "a", "b"]);
  assert.equal(moveItems(abcd, ["b", "c"], "c", true), abcd); // dropped inside the block
  assert.equal(moveItems(abcd, ["a", "b"], "c", false), abcd); // already there
  assert.deepEqual(moveItems(abcd, ["d"], "a", false), ["d", "a", "b", "c"]);
  assert.equal(moveItems(abcd, ["x"], "a", false), abcd);
});
