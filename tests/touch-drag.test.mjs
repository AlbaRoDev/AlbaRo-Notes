// Run with: node --test tests/   (Node 22.18+ loads the .ts module directly, stripping its types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeSpeed, exceedsSlop, SLOP } from "../src/lib/touch-drag.ts";

test("a finger that wanders further than the slop is scrolling, not holding", () => {
  assert.equal(exceedsSlop(0, 0), false);
  assert.equal(exceedsSlop(SLOP, 0), false);
  assert.equal(exceedsSlop(SLOP, 1), true); // diagonal counts
  assert.equal(exceedsSlop(0, -(SLOP + 1)), true);
});

test("the list scrolls toward the edge the finger nears, faster the closer, and not in the middle", () => {
  assert.equal(edgeSpeed(400, 0, 800), 0);
  assert.ok(edgeSpeed(10, 0, 800) < 0, "near the top scrolls up");
  assert.ok(edgeSpeed(790, 0, 800) > 0, "near the bottom scrolls down");
  assert.ok(Math.abs(edgeSpeed(2, 0, 800)) > Math.abs(edgeSpeed(40, 0, 800)));
  assert.equal(edgeSpeed(-500, 0, 800), edgeSpeed(0, 0, 800), "past the edge is capped");
  assert.ok(edgeSpeed(110, 100, 500) < 0, "relative to the box, not the screen");
});

test("in a narrow box the zones shrink: the middle of a 104 px board does not scroll", () => {
  assert.equal(edgeSpeed(64, 12, 116), 0); // the middle of the box (was swallowed by the end zone)
  assert.ok(edgeSpeed(110, 12, 116) > 0);
  assert.ok(edgeSpeed(15, 12, 116) < 0);
});
