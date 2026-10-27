// Run with: node --test tests/   (Node 22.18+ loads the .ts module directly, stripping its types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  CODE_LANGUAGES,
  PLAIN_TEXT,
  loadLanguage,
  lowlight,
} from "../src/components/editor/code-languages.ts";

const require = createRequire(import.meta.url);
const hljs = require("highlight.js/lib/core");

test("only plain text is registered until a language is asked for", () => {
  assert.deepEqual(lowlight.listLanguages(), [PLAIN_TEXT]);
  assert.equal(lowlight.registered("python"), false);
});

test("every offered language loads, and every alias its grammar declares resolves to it", async () => {
  for (const { value } of CODE_LANGUAGES) {
    if (value === PLAIN_TEXT) continue;
    // what highlight.js itself declares for this grammar, read from a registry of our own
    hljs.registerLanguage(value, require(`highlight.js/lib/languages/${value}`));
    const aliases = hljs.getLanguage(value).aliases ?? [];
    await loadLanguage(value);
    assert.ok(lowlight.registered(value), `${value} is registered after loading`);
    for (const alias of aliases) {
      // a document saved as `js` or `html` must keep its colors
      await loadLanguage(alias);
      assert.ok(lowlight.registered(alias), `alias ${alias} of ${value} resolves`);
    }
  }
});

test("loading is idempotent and a language we do not offer stays plain", async () => {
  await Promise.all([loadLanguage("rust"), loadLanguage("rs"), loadLanguage("rust")]);
  await loadLanguage("cobol");
  assert.equal(lowlight.registered("cobol"), false);
  const result = lowlight.highlight("rust", "fn main() {}");
  assert.ok(JSON.stringify(result).includes("hljs-keyword"));
});
