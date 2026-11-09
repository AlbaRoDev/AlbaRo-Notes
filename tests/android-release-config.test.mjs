// The Android build settings that are easy to lose when `gen/android` is regenerated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gradle = readFileSync("src-tauri/gen/android/app/build.gradle.kts", "utf8");
const cargo = readFileSync(".cargo/config.toml", "utf8");

test("the debug build has its own package id, so it can sit beside the real app", () => {
  assert.ok(gradle.includes('withBuildType("debug")'));
  assert.ok(gradle.includes('variant.applicationId.set("com.albaro.notes.debug")'));
});

test("the release key comes from the environment, never from a file in the repository", () => {
  assert.match(gradle, /System\.getenv\("ALBARO_KEYSTORE"\)/);
  assert.doesNotMatch(gradle, /storePassword = "/);
});

test("the native library is linked for 16 kB memory pages", () => {
  assert.match(cargo, /aarch64-linux-android[\s\S]*max-page-size=16384/);
});

test("the app opts out of Android's automatic backup (notes and the AI key stay on the device)", () => {
  const manifest = readFileSync("src-tauri/gen/android/app/src/main/AndroidManifest.xml", "utf8");
  assert.match(manifest, /<application[^>]*android:allowBackup="false"/);
});
