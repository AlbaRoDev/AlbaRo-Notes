// Run with: node --test tests/   (Node 22.18+ loads the .ts module directly, stripping its types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { sizeClassFor } from "../src/lib/size-class.ts";

test("the size class follows the width: compact under 600, medium up to 840, expanded above", () => {
  for (const [width, expected] of [
    [320, "compact"], // small phone upright
    [384, "compact"], // phone upright
    [599, "compact"],
    [600, "medium"], // tablet upright, foldable open
    [832, "medium"], // phone in landscape
    [840, "medium"],
    [841, "expanded"],
    [960, "expanded"], // tablet in landscape
    [1280, "expanded"],
  ]) {
    assert.equal(sizeClassFor(width), expected, `${width} px`);
  }
});
