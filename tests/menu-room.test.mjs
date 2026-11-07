import { test } from "node:test";
import assert from "node:assert/strict";
import { menuRoom } from "../src/components/editor/slash-commands/menu-room.ts";

const cursor = { top: 100, bottom: 120 };

test("below the cursor, the list stops at the bar over the keyboard", () => {
  assert.equal(menuRoom("bottom-start", cursor, 600, 50), 600 - 50 - 120 - 12);
  // the bar takes room the window still has: without it the list would run under the bar
  assert.ok(menuRoom("bottom-start", cursor, 600, 50) < menuRoom("bottom-start", cursor, 600, 0));
});

test("above the cursor, it has what is over the cursor", () => {
  assert.equal(menuRoom("top-start", cursor, 600, 50), 100 - 12);
});

test("in a window with almost no room the list keeps a couple of rows and scrolls", () => {
  assert.equal(menuRoom("bottom-start", { top: 150, bottom: 170 }, 232, 49), 88);
});
