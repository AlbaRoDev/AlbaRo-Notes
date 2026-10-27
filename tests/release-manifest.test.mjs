// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildManifest, releaseNotes } from "../scripts/release-manifest.mjs";

const windows = {
  name: "AlbaRo-Notes_1.2.3_windows-x64-setup.exe",
  signature: "sigwin\n",
  sha256: "a".repeat(64),
};
const base = {
  tag: "v1.2.3",
  repo: "o/r",
  files: [windows],
  notes: "n",
  date: new Date(0),
};

test("each installer maps to its updater key, with the release download URL", () => {
  const m = buildManifest(base);
  assert.equal(m.version, "1.2.3");
  assert.equal(m.pub_date, "1970-01-01T00:00:00.000Z");
  assert.deepEqual(m.platforms, {
    "windows-x86_64": {
      signature: "sigwin",
      url: "https://github.com/o/r/releases/download/v1.2.3/AlbaRo-Notes_1.2.3_windows-x64-setup.exe",
    },
  });
});

test("a missing installer, a missing signature and a bad tag are refused", () => {
  assert.throws(() => buildManifest({ ...base, files: [] }), /windows-x86_64/);
  assert.throws(
    () => buildManifest({ ...base, files: [{ ...windows, signature: " " }] }),
    /no signature/,
  );
  assert.throws(() => buildManifest({ ...base, tag: "1.2.3" }), /tag/);
  assert.throws(() => buildManifest({ ...base, tag: "v1.2" }), /tag/);
  // a name with spaces is not the one the URL will have (GitHub turns spaces into dots)
  assert.throws(
    () =>
      buildManifest({
        ...base,
        files: [{ ...windows, name: "AlbaRo Notes_1.2.3_x64-setup.exe" }],
      }),
    /windows-x86_64/,
  );
});

test("the notes list every hash with its file name and warn about SmartScreen", () => {
  const text = releaseNotes("v1.2.3", [windows]);
  assert.ok(text.includes(`${windows.sha256}  ${windows.name}`));
  assert.ok(text.includes("SmartScreen"));
});
