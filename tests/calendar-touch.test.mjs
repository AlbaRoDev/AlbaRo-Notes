// Run with: node --test tests/   (Node 22.18+ loads the .ts module directly, stripping its types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { dragCreates } from "../src/components/calendar/entry-input.ts";

test("dragging over empty space makes an appointment with a mouse or a pen, never with a finger", () => {
  assert.equal(dragCreates("mouse"), true);
  assert.equal(dragCreates("pen"), true);
  assert.equal(dragCreates("touch"), false);
});

test("Enter in a calendar field blurs it (that is what saves it), wherever the focus goes", async () => {
  const { leaveOnEnter } = await import("../src/components/calendar/entry-input.ts");
  let blurred = 0;
  const field = { blur: () => blurred++, closest: () => ({ focus() {} }) };
  leaveOnEnter({ key: "a", currentTarget: field });
  assert.equal(blurred, 0);
  leaveOnEnter({ key: "Enter", currentTarget: field });
  assert.equal(blurred, 1);
});

test("a block held at a side of the grid (or past it) pages the calendar", async () => {
  const { edgeDirection } = await import("../src/lib/calendar.ts");
  assert.equal(edgeDirection(500, 100, 900, 28), 0);
  assert.equal(edgeDirection(120, 100, 900, 28), -1);
  assert.equal(edgeDirection(40, 100, 900, 28), -1);
  assert.equal(edgeDirection(880, 100, 900, 28), 1);
  assert.equal(edgeDirection(1200, 100, 900, 28), 1);
});

test("the further a block is held past the grid's edge, the faster the days scroll", async () => {
  const { edgeSpeed } = await import("../src/lib/calendar.ts");
  assert.equal(edgeSpeed(100 + 56, 100, 900, 56), 0); // at the zone's inner border
  assert.equal(edgeSpeed(100, 100, 900, 56), 0.5); // on the grid's own side
  assert.equal(edgeSpeed(0, 100, 900, 56), 1); // well past it: capped
  assert.equal(edgeSpeed(900 - 56 + 28, 100, 900, 56), 0.25); // right side, half way to the side
});
