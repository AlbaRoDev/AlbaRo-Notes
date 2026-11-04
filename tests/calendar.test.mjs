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
  placeCopy,
  shiftEntry,
  placeGroup,
  planBatch,
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

test("a pasted copy keeps its length, drops the repeat and lands where it is put", () => {
  const timed = {
    start: "2026-10-20T10:00",
    end: "2026-10-20T11:30",
    allDay: false,
    repeat: { x: 1 },
  };
  assert.deepEqual(placeCopy(timed, "2026-10-22", 14 * 60), {
    start: "2026-10-22T14:00",
    end: "2026-10-22T15:30",
    allDay: false,
    repeat: null,
  });
  // no minutes (a day cell): its own time of day; a block that ends at midnight ends at 24:00 of its day
  assert.equal(placeCopy(timed, "2026-10-22", null).start, "2026-10-22T10:00");
  assert.equal(placeCopy(timed, "2026-10-22", 22 * 60 + 30).end, "2026-10-22T24:00");
  const days = { start: "2026-10-20", end: "2026-10-22", allDay: true, repeat: null };
  assert.deepEqual(placeCopy(days, "2026-10-30", 9 * 60), {
    start: "2026-10-30",
    end: "2026-11-01",
    allDay: true,
    repeat: null,
  });
});

test("a multi-selection moves as one: timed entries by minutes, all-day ones by whole days", () => {
  const timed = { start: "2026-10-20T22:00", end: "2026-10-21T00:00", allDay: false };
  assert.deepEqual(shiftEntry(timed, 90, 0), {
    start: "2026-10-20T23:30",
    end: "2026-10-21T01:30",
  });
  assert.deepEqual(shiftEntry(timed, -22 * 60, 0), {
    start: "2026-10-20T00:00",
    end: "2026-10-20T02:00",
  });
  // ending at midnight stays 24:00 of its own day
  assert.equal(shiftEntry(timed, 0, 0).end, "2026-10-20T24:00");
  const days = { start: "2026-10-30", end: "2026-11-01", allDay: true };
  assert.deepEqual(shiftEntry(days, 999, 2), { start: "2026-11-01", end: "2026-11-03" });
});

test("a batch sends one change per series for «all» and «following», each plain entry on its own", () => {
  const entry = (id, occurrence, repeat = true) => ({
    entry: { id, occurrence, repeat: repeat ? {} : null },
  });
  const items = [
    entry("s", "2026-10-26"),
    entry("p", null, false),
    entry("s", "2026-10-19"),
    entry("t", "2026-10-21"),
    entry("s", "2026-11-02"),
  ];
  const ids = (plan) => plan.map((x) => `${x.entry.id}@${x.entry.occurrence}:${x.scope}`);
  assert.deepEqual(ids(planBatch(items, "this")), [
    "s@2026-10-26:this",
    "p@null:all",
    "s@2026-10-19:this",
    "t@2026-10-21:this",
    "s@2026-11-02:this",
  ]);
  assert.deepEqual(ids(planBatch(items, "all")), [
    "s@2026-10-26:all",
    "p@null:all",
    "t@2026-10-21:all",
  ]);
  // «following» keeps the earliest occurrence of the series, in the place the series first appeared
  assert.deepEqual(ids(planBatch(items, "following")), [
    "s@2026-10-19:following",
    "p@null:all",
    "t@2026-10-21:following",
  ]);
});

test("a group of copies keeps the distances between its entries", () => {
  const a = { start: "2026-10-20T10:00", end: "2026-10-20T11:00", allDay: false, repeat: { x: 1 } };
  const b = { start: "2026-10-21T15:30", end: "2026-10-21T16:00", allDay: false, repeat: null };
  const c = { start: "2026-10-22", end: "2026-10-23", allDay: true, repeat: null };
  const [pa, pb, pc] = placeGroup([b, a, c], "2026-11-02", 9 * 60).sort((x, y) =>
    x.start < y.start ? -1 : 1,
  );
  assert.equal(pa.start, "2026-11-02T09:00"); // the earliest goes where it was put
  assert.equal(pa.repeat, null);
  assert.equal(pb.start, "2026-11-03T14:30"); // one day and 5h30 later than the first, as before
  assert.deepEqual([pc.start, pc.end], ["2026-11-04", "2026-11-05"]);
  // dropped in a day cell (no minutes): the first keeps its time of day
  assert.equal(placeGroup([a, b], "2026-11-02", null)[1].start, "2026-11-03T15:30");
});
