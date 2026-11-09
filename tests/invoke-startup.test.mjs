import { test } from "node:test";
import assert from "node:assert/strict";
import { isStartingUp } from "../src/lib/invoke.ts";

test("Tauri's 'state not managed' answer is recognised as Rust still starting up", () => {
  assert.equal(
    isStartingUp(
      "state not managed for field `state` on command `db_ping`. You must call `.manage()` before using this command",
    ),
    true,
  );
});

test("any other error is a real one and is not retried", () => {
  assert.equal(isStartingUp("Página no encontrada"), false);
  assert.equal(isStartingUp(new Error("state not managed for field")), false);
  assert.equal(isStartingUp(undefined), false);
});
