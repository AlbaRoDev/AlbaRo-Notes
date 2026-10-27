// Run with: node --test tests/   (Node 22.18+ loads the .ts module directly, stripping its types)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  snapSplit,
  parseSplit,
  otherHalf,
  enter,
  promote,
  shownHalf,
  DEFAULT_SPLIT,
} from "../src/lib/workspace.ts";

test("a drag sticks to the nearest snap point and otherwise stays put", () => {
  assert.equal(snapSplit(0.66), 2 / 3);
  assert.equal(snapSplit(0.35), 1 / 3);
  assert.equal(snapSplit(0.5), 1 / 2);
  assert.equal(snapSplit(0.98), 1);
  assert.equal(snapSplit(0.02), 0);
  assert.equal(snapSplit(0.58), 0.58);
  assert.equal(snapSplit(-3), 0);
  assert.equal(snapSplit(9), 1);
});

test("a stored split that is missing or garbage falls back to the default", () => {
  assert.equal(parseSplit(null), DEFAULT_SPLIT);
  assert.equal(parseSplit("abc"), DEFAULT_SPLIT);
  assert.equal(parseSplit("1.5"), DEFAULT_SPLIT);
  assert.equal(parseSplit("0.5"), 0.5);
  assert.equal(parseSplit("0"), 0);
});

test("the other half", () => {
  assert.equal(otherHalf("notes"), "manager");
  assert.equal(otherHalf("manager"), "notes");
});

test("entering a half from the start screen makes it the main zone", () => {
  assert.deepEqual(enter({ main: null, split: 0.5 }, "manager"), { main: "manager", split: 0.5 });
  // a main zone left folded away last time does not open hidden
  assert.deepEqual(enter({ main: null, split: 0 }, "notes"), {
    main: "notes",
    split: DEFAULT_SPLIT,
  });
});

test("entering the other half swaps the roles and keeps the width of the main zone", () => {
  assert.deepEqual(enter({ main: "notes", split: 0.5 }, "manager"), {
    main: "manager",
    split: 0.5,
  });
  assert.deepEqual(enter({ main: "notes", split: 1 }, "manager"), { main: "manager", split: 1 });
  assert.deepEqual(enter({ main: "notes", split: 0.5 }, "notes"), { main: "notes", split: 0.5 });
});

test("with the main zone folded away, the companion is what is shown", () => {
  const folded = { main: "notes", split: 0 };
  assert.equal(shownHalf(folded), "manager");
  assert.deepEqual(enter(folded, "manager"), folded);
  assert.deepEqual(enter(folded, "notes"), { main: "notes", split: DEFAULT_SPLIT });
  assert.deepEqual(promote(folded, "manager"), { main: "manager", split: DEFAULT_SPLIT });
  assert.equal(shownHalf({ main: null, split: 0.5 }), null);
});
