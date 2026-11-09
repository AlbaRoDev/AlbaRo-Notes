import { test } from "node:test";
import assert from "node:assert/strict";
import { chromeMajor, outdatedWebview, MIN_WEBVIEW } from "../src/lib/webview-version.ts";

const ua = (v) =>
  `Mozilla/5.0 (Linux; Android 10; TB-X606F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`;

test("the Chromium version is read from the user agent, and only from Chromium's", () => {
  assert.equal(chromeMajor(ua(156)), 156);
  assert.equal(chromeMajor("Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/130.0"), null);
});

test("an old WebView is reported with its version; a current or unknown one is not", () => {
  assert.equal(outdatedWebview(ua(MIN_WEBVIEW - 1)), MIN_WEBVIEW - 1);
  assert.equal(outdatedWebview(ua(MIN_WEBVIEW)), null);
  assert.equal(outdatedWebview(ua(156)), null);
  assert.equal(outdatedWebview(""), null);
});
