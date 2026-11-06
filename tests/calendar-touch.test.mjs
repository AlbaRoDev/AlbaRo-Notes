// Run with: node --test tests/   (Node 22.18+ loads the .ts module directly, stripping its types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { dragCreates } from "../src/components/calendar/entry-input.ts";

test("dragging over empty space makes an appointment with a mouse or a pen, never with a finger", () => {
  assert.equal(dragCreates("mouse"), true);
  assert.equal(dragCreates("pen"), true);
  assert.equal(dragCreates("touch"), false);
});
