// Run with: node --test tests/   (Node 22.18+ loads the .ts module directly, stripping its types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { packCircles, bounds, radiusOf } from "../src/lib/families.ts";

test("packed circles never overlap, keep their order and stay clustered", () => {
  const radii = [80, 60, 60, 40, 30, 30, 22, 22, 22, 22];
  const circles = packCircles(radii, 4);
  assert.deepEqual(
    circles.map((c) => c.r),
    radii,
  );
  for (let i = 0; i < circles.length; i++)
    for (let j = i + 1; j < circles.length; j++) {
      const [a, b] = [circles[i], circles[j]];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r + 4 - 1e-3, `${i} and ${j} overlap`);
    }
  // a cluster, not a line: the box is nowhere near the sum of the diameters
  const box = bounds(circles);
  const diameters = radii.reduce((s, r) => s + 2 * r, 0);
  assert.ok(box.width < diameters * 0.6 && box.height < diameters * 0.6);
});

test("an empty or single family packs trivially", () => {
  assert.deepEqual(packCircles([]), []);
  assert.deepEqual(packCircles([30]), [{ x: 0, y: 0, r: 30 }]);
  assert.deepEqual(bounds([]), { minX: 0, minY: 0, width: 0, height: 0 });
});

test("a bubble's area follows its size, with a floor", () => {
  assert.equal(radiusOf(4, 4, 100), 100);
  assert.equal(Math.round(radiusOf(1, 4, 100)), 50); // a quarter of the area is half the radius
  assert.equal(radiusOf(0, 4, 100), 22);
  assert.equal(radiusOf(0.01, 4, 100), 22);
  assert.equal(radiusOf(5, 0, 100), 22);
});
