// The webview freezes `Object.prototype` (`freezePrototype` in tauri.conf.json). With it frozen, `obj.toString = f`
// (or `valueOf`, `constructor`) is a TypeError in strict mode even on an object of our own: the inherited property
// is read-only, so assigning cannot shadow it (the «override mistake»). The libraries behind the Word reader
// (mammoth: underscore, xmldom, xmlbuilder…) do that while loading, so no .docx could be imported. Defining the
// property first has no such restriction, and the assignment that follows then just sets it.
// `tests/frozen-prototype.test.mjs` converts a real .docx with the frozen prototype, so a new site shows up there.
import type { Plugin } from "vite";

// a statement that starts with `X.prototype.toString =`, `X.constructor =` … (not `==`)
const ASSIGNMENT =
  /^([ \t]*)([\w$.]+?)(\.prototype)?\.(toString|valueOf|constructor)[ \t]*=(?!=)/gm;

function allowFrozenPrototype(code: string): string {
  return code.replace(
    ASSIGNMENT,
    (statement, indent: string, object: string, proto: string | undefined, key: string) =>
      `${indent}Object.defineProperty(${object}${proto ?? ""}, "${key}", { value: null, writable: true, configurable: true }); ${statement.trimStart()}`,
  );
}

// mammoth's own dependencies: what the Word reader loads
const LIBRARIES = "underscore|@xmldom[\\\\/]xmldom|xmlbuilder|bluebird|lop|jszip";
const patched = (id: string) =>
  new RegExp(`node_modules[\\\\/](?:${LIBRARIES})[\\\\/][^?]*\\.[cm]?js`).test(id);

const fix = (): Plugin => ({
  name: "frozen-prototype-fix",
  transform: (code, id) => (patched(id) ? allowFrozenPrototype(code) : null),
});

export const frozenPrototypeFix = (): Plugin => ({
  ...fix(),
  enforce: "pre",
  // `vite dev` pre-bundles dependencies with its own bundler, which has its own plugin list
  config: () => ({ optimizeDeps: { rolldownOptions: { plugins: [fix()] } } }),
});
