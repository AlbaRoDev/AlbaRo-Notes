// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { en } from "../src/locales/en.ts";

// Every text passed to t() is the Spanish original and must have its English line in src/locales/en.ts, with the same
// {placeholders}; and en.ts must not keep lines that no t() uses any more.
function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/i18n\.ts$|en\.ts$/.test(name) ? [path] : [];
  });
}

function usedKeys() {
  const keys = new Map();
  for (const file of sources("src")) {
    const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      kind,
    );
    const visit = (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "t") {
        const arg = n.arguments[0];
        const leaves = ts.isConditionalExpression(arg) ? [arg.whenTrue, arg.whenFalse] : [arg];
        for (const leaf of leaves) {
          const ok = ts.isStringLiteral(leaf) || ts.isNoSubstitutionTemplateLiteral(leaf);
          assert.ok(ok, `${file}: t() needs a literal text, not ${leaf.getText().slice(0, 60)}`);
          keys.set(leaf.text, file);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return keys;
}

const placeholders = (s) =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join();

test("every text passed to t() has its English line", () => {
  const missing = [...usedKeys()]
    .filter(([key]) => !(key in en))
    .map(([key, file]) => `${file}: ${key}`);
  assert.deepEqual(missing, []);
});

test("English keeps the {placeholders} of the Spanish text", () => {
  const wrong = Object.entries(en).filter(
    ([key, value]) => placeholders(key) !== placeholders(value),
  );
  assert.deepEqual(wrong, []);
});

test("en.ts has no line that no t() uses", () => {
  const used = usedKeys();
  assert.deepEqual(
    Object.keys(en).filter((key) => !used.has(key)),
    [],
  );
});

// The Spanish errors Rust sends are translated by the page (src/lib/invoke.ts) from src/locales/en-rust.ts.
import { rustTexts } from "./rust-texts.mjs";
import { enRust } from "../src/locales/en-rust.ts";
import { translateError } from "../src/lib/invoke.ts";

const holes = (s) => (s.match(/\{[^}]*\}/g) ?? []).length;

test("every Spanish error of the Rust code has its English line", () => {
  const missing = [...rustTexts()]
    .filter(([text]) => !(text in enRust))
    .map(([text, file]) => `${file}: ${text}`);
  assert.deepEqual(missing, []);
});

test("an English error keeps as many {holes} as the Spanish one", () => {
  const wrong = Object.entries(enRust).filter(([es, en]) => holes(es) !== holes(en));
  assert.deepEqual(wrong, []);
});

test("en-rust.ts has no line that the Rust code no longer has", () => {
  const used = rustTexts();
  assert.deepEqual(
    Object.keys(enRust).filter((text) => !used.has(text)),
    [],
  );
});

test("errors are translated whole or with the pieces Rust filled in", () => {
  assert.equal(translateError("La IA está desactivada"), "The AI is turned off");
  assert.equal(
    translateError("«Cuenta» no es una opción de esta propiedad"),
    '"Cuenta" is not an option of this property',
  );
  assert.equal(translateError("Texto que no está en la tabla"), "Texto que no está en la tabla");
});
