// Run with: node --test tests/   (Node 22.18+ loads the .ts module directly, stripping its types)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  snap,
  clock,
  stamp,
  unstamp,
  timeOf,
  parseClock,
  layoutDay,
  dragSpan,
  daysOf,
  absOf,
  timeFromAbs,
  endFromAbs,
} from "../src/lib/calendar.ts";

test("times round-trip and snap to quarters of an hour", () => {
  assert.equal(clock(630), "10:30");
  assert.equal(clock(5), "00:05");
  assert.equal(stamp("2026-10-21", 615), "2026-10-21T10:15");
  assert.deepEqual(unstamp("2026-10-21T10:15"), { date: "2026-10-21", minutes: 615 });
  assert.equal(timeOf("2026-10-21T10:15"), "10:15");
  assert.equal(timeOf("2026-10-21"), "");
  assert.equal(snap(7), 0);
  assert.equal(snap(8), 15);
  assert.equal(snap(622), 615);
  assert.equal(parseClock("9:05"), 545);
  assert.equal(parseClock("24:00"), null);
  assert.equal(parseClock("10:60"), null);
  assert.equal(parseClock("diez"), null);
});

test("overlapping blocks share the width and blocks that only touch don't", () => {
  const lay = layoutDay([
    { id: "a", start: 600, end: 660 },
    { id: "b", start: 630, end: 690 }, // overlaps a
    { id: "c", start: 660, end: 720 }, // starts when a ends: takes a's column, overlaps b
    { id: "d", start: 800, end: 860 }, // alone
  ]);
  assert.deepEqual(lay.get("a"), { column: 0, columns: 2 });
  assert.deepEqual(lay.get("b"), { column: 1, columns: 2 });
  assert.deepEqual(lay.get("c"), { column: 0, columns: 2 });
  assert.deepEqual(lay.get("d"), { column: 0, columns: 1 });
  // back to back is not an overlap
  const flat = layoutDay([
    { id: "x", start: 540, end: 600 },
    { id: "y", start: 600, end: 660 },
  ]);
  assert.deepEqual(flat.get("x"), { column: 0, columns: 1 });
  assert.deepEqual(flat.get("y"), { column: 0, columns: 1 });
  // three at once, one long block under two short ones
  const three = layoutDay([
    { id: "long", start: 600, end: 780 },
    { id: "s1", start: 610, end: 650 },
    { id: "s2", start: 620, end: 660 },
  ]);
  assert.equal(three.get("long").columns, 3);
  assert.deepEqual(
    [three.get("long").column, three.get("s1").column, three.get("s2").column],
    [0, 1, 2],
  );
});

test("blocks are absolute minutes: moving and resizing cross midnight and a block ending at midnight ends at 24:00", () => {
  const start = absOf("2026-10-21T22:00");
  const end = absOf("2026-10-22T06:30");
  assert.equal(end - start, 510);
  assert.equal(timeFromAbs(start), "2026-10-21T22:00");
  assert.equal(timeFromAbs(end), "2026-10-22T06:30");
  assert.equal(endFromAbs(absOf("2026-10-22T00:00")), "2026-10-21T24:00");
  assert.equal(absOf("2026-10-21T24:00"), absOf("2026-10-22T00:00"));
  assert.equal(endFromAbs(end), "2026-10-22T06:30");
  // moving keeps the length, snaps, and can go to another day
  const moved = dragSpan("move", start, end, 38 + 24 * 60);
  assert.equal(moved.end - moved.start, 510);
  assert.equal(timeFromAbs(moved.start), "2026-10-22T22:45");
  // resizing keeps at least one slot and can run past midnight
  assert.deepEqual(dragSpan("resize", 600, 660, 30), { start: 600, end: 690 });
  assert.deepEqual(dragSpan("resize", 600, 660, -9999), { start: 600, end: 615 });
  assert.equal(
    timeFromAbs(dragSpan("resize", absOf("2026-10-21T23:00"), absOf("2026-10-22T00:00"), 60).end),
    "2026-10-22T01:00",
  );
});

test("an all-day entry covers the days inside the shown range", () => {
  assert.deepEqual(daysOf("2026-10-19", "2026-10-21", "2026-10-20", "2026-10-31"), [
    "2026-10-20",
    "2026-10-21",
  ]);
  assert.deepEqual(daysOf("2026-10-25", "2026-10-25", "2026-10-20", "2026-10-31"), ["2026-10-25"]);
  assert.deepEqual(daysOf("2026-11-02", "2026-11-03", "2026-10-20", "2026-10-31"), []);
});
