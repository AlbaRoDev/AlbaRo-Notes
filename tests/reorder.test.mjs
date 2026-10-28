// Run with: node --test tests/   (Node 22.18+ loads the .ts module directly, stripping its types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { moveItem } from "../src/lib/reorder.ts";

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
