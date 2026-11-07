import assert from "node:assert/strict";
import test from "node:test";
import { PINCH_STEP, pinchLevel } from "../src/lib/pinch.ts";

test("a pinch zooms one level each time the gap grows or shrinks by PINCH_STEP", () => {
  assert.equal(pinchLevel(100, 100 * PINCH_STEP), 1);
  assert.equal(pinchLevel(100, 100 / PINCH_STEP), -1);
  assert.equal(pinchLevel(100, 120), 0);
  assert.equal(pinchLevel(100, 85), 0);
});

test("fingers that touch or lift (a zero gap) never zoom", () => {
  assert.equal(pinchLevel(0, 50), 0);
  assert.equal(pinchLevel(50, 0), 0);
});
