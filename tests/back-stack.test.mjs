// Run with: node --test tests/   (Node 22.18+ loads the .ts module directly, stripping its types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBackStack } from "../src/lib/back-stack.ts";

/** A browser history: `go` and the user's back arrive later as a `popstate`, like the real one. */
function fakeBrowser() {
  const listeners = [];
  const pending = [];
  const b = {
    index: 0,
    pushes: 0,
    history: {
      pushState() {
        b.pushes += 1;
        // the entry would land before the one the pending `go` is about to leave, and be undone by it
        assert.equal(pending.length, 0, "pushState while a go is still travelling");
        b.index += 1;
      },
      go(n) {
        pending.push(n);
      },
    },
    listen: (cb) => listeners.push(cb),
    /** the system's back button */
    back() {
      assert.ok(b.index > 0, "back at the first entry would leave the app");
      b.index -= 1;
      listeners.forEach((cb) => cb());
    },
    /** the browser finishing a `go` */
    settle() {
      while (pending.length) {
        b.index += pending.shift();
        listeners.forEach((cb) => cb());
      }
    },
  };
  // microtasks are run by hand so each step can be looked at
  const queue = [];
  b.defer = (run) => queue.push(run);
  b.flush = () => {
    while (queue.length) queue.shift()();
  };
  return b;
}

const setup = () => {
  const b = fakeBrowser();
  return { b, stack: createBackStack(b.history, b.listen, b.defer) };
};

test("an open layer owns a history entry and the back button closes it", () => {
  const { b, stack } = setup();
  let closed = 0;
  stack.push(() => closed++);
  b.flush();
  assert.equal(b.index, 1);
  b.back();
  b.flush();
  assert.equal(closed, 1);
  assert.equal(b.index, 0); // nothing left to go back through: the next back leaves the app
});

test("back closes the layers one at a time, the last opened first", () => {
  const { b, stack } = setup();
  const log = [];
  stack.push(() => log.push("drawer"));
  stack.push(() => log.push("sheet"));
  b.flush();
  assert.equal(b.index, 2);
  b.back();
  b.flush();
  assert.deepEqual(log, ["sheet"]);
  b.back();
  b.flush();
  assert.deepEqual(log, ["sheet", "drawer"]);
  assert.equal(b.index, 0);
});

test("a layer closed by the page gives its history entry back, and does not run its own close", () => {
  const { b, stack } = setup();
  let closed = 0;
  const remove = stack.push(() => closed++);
  b.flush();
  remove();
  b.flush();
  b.settle();
  b.flush();
  assert.equal(b.index, 0);
  assert.equal(closed, 0);
});

test("a layer opened while an entry is still on its way back waits for it", () => {
  const { b, stack } = setup();
  const remove = stack.push(() => {});
  b.flush();
  remove();
  b.flush(); // go(-1) is issued, its popstate has not arrived
  stack.push(() => {});
  b.flush(); // must not push yet (the fake throws if it does)
  b.settle();
  b.flush(); // the entry that was just given back is walked onto again
  b.settle();
  b.flush();
  assert.equal(b.index, 1);
  assert.equal(b.pushes, 1);
});

test("a layer that reopens itself on back (going up a page) walks onto its old entry instead of pushing", () => {
  // Chromium makes the back button skip an entry pushed without a user gesture, and back is not one
  const { b, stack } = setup();
  let remove;
  const open = () => {
    remove = stack.push(() => {
      remove(); // what the hook's cleanup does when the component re-renders
      open();
    });
  };
  open();
  b.flush();
  assert.equal(b.pushes, 1);
  for (let i = 0; i < 3; i++) {
    b.back();
    b.flush();
    b.settle();
    b.flush();
    assert.equal(b.index, 1, `back number ${i + 1}`);
  }
  assert.equal(b.pushes, 1, "the entry made by the first tap is the only one ever pushed");
});

test("after back closed a layer, a new one reuses the entry that lies ahead", () => {
  const { b, stack } = setup();
  stack.push(() => {});
  b.flush();
  b.back();
  b.flush();
  stack.push(() => {});
  b.flush();
  b.settle();
  b.flush();
  assert.equal(b.index, 1);
  assert.equal(b.pushes, 1);
});
