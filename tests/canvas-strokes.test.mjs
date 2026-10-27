// Run with: node --test tests/   (Node 22.18+ loads the .ts module directly, stripping its types)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CANVAS_COORDS,
  MAX_STROKES,
  MAX_STROKE_COORDS,
  COORD_LIMIT,
  FULL_VIEW,
  GROW_STEP,
  MAX_HEIGHT,
  cleanHeight,
  clampView,
  fitView,
  grownHeight,
  sanitizeStrokes,
  viewBoxOf,
  zoomAt,
  strokeHit,
  strokePath,
} from "../src/components/editor/canvas-strokes.ts";

const stroke = (points, color = "ink", width = 2.5) => ({ color, width, points });

test("a pasted canvas keeps only the strokes Rust would accept", () => {
  const good = stroke([1, 2, 3, 4]);
  const raw = [
    good,
    stroke([1, 2, 3]), // odd number of coordinates
    stroke([]),
    stroke([1, 2], "pink"), // unknown colour
    stroke([1, 2], "ink", 0), // width out of range
    stroke(["1", 2]), // a string is not a coordinate
    stroke([1e9, 2]), // out of range
    [1, 2], // a bare list is not a stroke
    null,
    "x",
  ];
  assert.deepEqual(sanitizeStrokes(raw), [good]);
  assert.deepEqual(sanitizeStrokes("not a list"), []);
  assert.deepEqual(sanitizeStrokes(undefined), []);
});

test("a pasted canvas is cut at the caps", () => {
  assert.equal(
    sanitizeStrokes(Array.from({ length: MAX_STROKES + 50 }, () => stroke([1, 2]))).length,
    MAX_STROKES,
  );
  assert.equal(sanitizeStrokes([stroke(new Array(MAX_STROKE_COORDS + 2).fill(1))]).length, 0); // one stroke too long
  const long = Array.from({ length: MAX_CANVAS_COORDS / MAX_STROKE_COORDS + 5 }, () =>
    stroke(new Array(MAX_STROKE_COORDS).fill(1)),
  );
  assert.equal(sanitizeStrokes(long).length, MAX_CANVAS_COORDS / MAX_STROKE_COORDS); // the total stays under the cap
});

test("strokes become smooth SVG paths, and a single point is a dot", () => {
  assert.equal(strokePath([]), "");
  assert.equal(strokePath([5, 6]), "M5 6l0.01 0");
  assert.equal(strokePath([0, 0, 10, 10]), "M0 0L10 10");
  // three points: a curve through the midpoint of the last two, ending on the last point
  assert.equal(strokePath([0, 0, 10, 0, 10, 10]), "M0 0Q10 0 10 5L10 10");
});

test("the eraser hits a stroke near any of its segments, not near its bounding box", () => {
  const diagonal = stroke([0, 0, 100, 100], "ink", 4);
  assert.ok(strokeHit(diagonal, 50, 50, 5)); // on the line
  assert.ok(strokeHit(diagonal, 50, 56, 5)); // within reach (distance ~4.2 + half the width)
  assert.ok(!strokeHit(diagonal, 90, 10, 5)); // inside the bounding box, far from the line
  assert.ok(strokeHit(stroke([20, 20]), 22, 21, 3)); // a dot
  assert.ok(!strokeHit(stroke([20, 20]), 40, 40, 3));
});

test("a height is clamped to the block's range, with a default for junk", () => {
  assert.equal(cleanHeight(360), 360);
  assert.equal(cleanHeight(10), 160);
  assert.equal(cleanHeight(99999), 2000);
  assert.equal(cleanHeight("500"), 360); // a string is not a height
  assert.equal(cleanHeight(NaN), 360);
});

test("the window grows when the pen reaches its bottom edge, up to the limit", () => {
  assert.equal(grownHeight(360, [10, 10, 20, 100], FULL_VIEW), 360); // far from the edge
  assert.equal(grownHeight(360, [10, 10, 20, 320], FULL_VIEW), 360 + GROW_STEP); // within the margin
  assert.equal(grownHeight(MAX_HEIGHT - 10, [0, MAX_HEIGHT - 20], FULL_VIEW), MAX_HEIGHT); // never past the cap
  assert.equal(grownHeight(MAX_HEIGHT, [0, MAX_HEIGHT - 1], FULL_VIEW), MAX_HEIGHT);
  // «the bottom edge» is the edge of what is shown, wherever the view has been moved to
  const scrolled = { zoom: 1, x: 0, y: 5000 };
  assert.equal(grownHeight(360, [0, 5100], scrolled), 360); // well inside the window
  assert.equal(grownHeight(360, [0, 5330], scrolled), 360 + GROW_STEP); // near its bottom edge
  assert.equal(grownHeight(360, [0, 50], scrolled), 360); // ink far above the window doesn't count
});

test("the sheet is infinite: the view can go anywhere, up to the limit", () => {
  const H = 400;
  assert.deepEqual(clampView({ zoom: 99, x: 0, y: 0 }, H), { zoom: 5, x: 0, y: 0 });
  assert.equal(clampView({ zoom: 0.01, x: 0, y: 0 }, H).zoom, 0.05); // zooming out stops at 5 %
  assert.deepEqual(clampView({ zoom: 1, x: -3000, y: 70000 }, H), { zoom: 1, x: -3000, y: 70000 }); // no page edges
  assert.equal(clampView({ zoom: 1, x: -1e9, y: 1e9 }, H).x, -COORD_LIMIT);
  assert.equal(clampView({ zoom: 1, x: 0, y: 1e9 }, H).y, COORD_LIMIT - H);
});

test("zoom keeps the point under the cursor fixed", () => {
  const H = 400;
  // zoom in 2× around the middle: the visible area is the middle half, centred on that point
  const z = zoomAt(FULL_VIEW, 2, 500, 200, H);
  assert.deepEqual(z, { zoom: 2, x: 250, y: 100 });
  // the point under the cursor stays under it after zooming further, and after zooming out past 100 %
  const fraction = (v, px, py) => [(px - v.x) / (1000 / v.zoom), (py - v.y) / (H / v.zoom)];
  for (const factor of [1.5, 0.4, 0.2]) {
    const z2 = zoomAt(z, factor, 400, 150, H);
    const [before, after] = [fraction(z, 400, 150), fraction(z2, 400, 150)];
    assert.ok(
      Math.abs(before[0] - after[0]) < 1e-9 && Math.abs(before[1] - after[1]) < 1e-9,
      `factor ${factor}`,
    );
  }
  assert.equal(zoomAt(FULL_VIEW, 0.01, 500, 200, H).zoom, 0.05);
  assert.equal(viewBoxOf(FULL_VIEW, 360), "0 0 1000 360");
  assert.equal(viewBoxOf({ zoom: 2, x: 100, y: 50 }, 360), "100 50 500 180");
  assert.equal(viewBoxOf({ zoom: 0.5, x: -300, y: -20 }, 360), "-300 -20 2000 720");
});

test("«ver todo» shows all the ink, wherever it is", () => {
  assert.deepEqual(fitView([], 360), FULL_VIEW); // nothing drawn: home
  // a small drawing far from the origin: centred, at most 150 %
  const small = fitView([stroke([8000, 9000, 8100, 9050])], 360);
  assert.equal(small.zoom, 1.5);
  assert.ok(
    Math.abs(small.x + 1000 / small.zoom / 2 - 8050) < 1e-6 &&
      Math.abs(small.y + 360 / small.zoom / 2 - 9025) < 1e-6,
  );
  // ink spread over a wide area: zoomed out until every stroke is inside the window
  const spread = fitView([stroke([0, 0, 10, 10]), stroke([1800, 600, 1810, 610])], 360);
  assert.ok(spread.zoom < 1 && spread.zoom > 0.05);
  for (const [x, y] of [
    [0, 0],
    [1810, 610],
  ]) {
    assert.ok(
      x >= spread.x &&
        x <= spread.x + 1000 / spread.zoom &&
        y >= spread.y &&
        y <= spread.y + 360 / spread.zoom,
    );
  }
  // tall writing that a 360-unit window shows at ~6 %: well within the zoom range
  const tall = fitView([stroke([0, 0, 10, 10]), stroke([2000, 6000, 2010, 6010])], 360);
  assert.ok(tall.zoom > 0.05 && tall.zoom < 0.1);
  // more than the lowest zoom can hold: the zoom stops at its limit
  assert.equal(
    fitView([stroke([0, 0, 10, 10]), stroke([60000, 40000, 60010, 40010])], 360).zoom,
    0.05,
  );
});
