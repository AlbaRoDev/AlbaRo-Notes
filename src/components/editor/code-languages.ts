import { createLowlight } from "lowlight";
import type { LanguageFn } from "highlight.js";
import plaintext from "highlight.js/lib/languages/plaintext";

/**
 * "plaintext" is a real registered language so that a block with no language
 * highlights nothing — without it, the extension runs auto-detection and
 * colors random words of ordinary prose. It is the only grammar in the main
 * chunk: the rest are fetched the first time a block uses them (`loadLanguage`),
 * one small chunk each, so the editor only pays for languages the page has.
 */
export const PLAIN_TEXT = "plaintext";

type Grammar = { default: LanguageFn };

/**
 * `value` is the highlight.js registration name; `aliases` are the other names
 * documents may carry (`html`, `js`, `py`…, typed after ``` or saved before the
 * selector existed). They mirror what the grammars declare, so a block written
 * as `js` keeps highlighting — `tests/code-languages.test.mjs` checks that.
 */
const LANGUAGES: {
  value: string;
  label: string;
  aliases: string[];
  load: () => Promise<Grammar>;
}[] = [
  {
    value: "bash",
    label: "Bash",
    aliases: ["sh", "zsh"],
    load: () => import("highlight.js/lib/languages/bash"),
  },
  { value: "c", label: "C", aliases: ["h"], load: () => import("highlight.js/lib/languages/c") },
  {
    value: "cpp",
    label: "C++",
    aliases: ["cc", "c++", "h++", "hpp", "hh", "hxx", "cxx"],
    load: () => import("highlight.js/lib/languages/cpp"),
  },
  {
    value: "csharp",
    label: "C#",
    aliases: ["cs", "c#"],
    load: () => import("highlight.js/lib/languages/csharp"),
  },
  { value: "css", label: "CSS", aliases: [], load: () => import("highlight.js/lib/languages/css") },
  {
    value: "go",
    label: "Go",
    aliases: ["golang"],
    load: () => import("highlight.js/lib/languages/go"),
  },
  {
    value: "xml",
    label: "HTML / XML",
    aliases: ["html", "xhtml", "rss", "atom", "xjb", "xsd", "xsl", "plist", "wsf", "svg"],
    load: () => import("highlight.js/lib/languages/xml"),
  },
  {
    value: "java",
    label: "Java",
    aliases: ["jsp"],
    load: () => import("highlight.js/lib/languages/java"),
  },
  {
    value: "javascript",
    label: "JavaScript",
    aliases: ["js", "jsx", "mjs", "cjs"],
    load: () => import("highlight.js/lib/languages/javascript"),
  },
  {
    value: "json",
    label: "JSON",
    aliases: ["jsonc", "json5"],
    load: () => import("highlight.js/lib/languages/json"),
  },
  {
    value: "kotlin",
    label: "Kotlin",
    aliases: ["kt", "kts", "ktm", "ktx"],
    load: () => import("highlight.js/lib/languages/kotlin"),
  },
  {
    value: "markdown",
    label: "Markdown",
    aliases: ["md", "mkdown", "mkd"],
    load: () => import("highlight.js/lib/languages/markdown"),
  },
  { value: "php", label: "PHP", aliases: [], load: () => import("highlight.js/lib/languages/php") },
  {
    value: "python",
    label: "Python",
    aliases: ["py", "gyp", "ipython"],
    load: () => import("highlight.js/lib/languages/python"),
  },
  {
    value: "ruby",
    label: "Ruby",
    aliases: ["rb", "gemspec", "podspec", "thor", "irb"],
    load: () => import("highlight.js/lib/languages/ruby"),
  },
  {
    value: "rust",
    label: "Rust",
    aliases: ["rs"],
    load: () => import("highlight.js/lib/languages/rust"),
  },
  { value: "sql", label: "SQL", aliases: [], load: () => import("highlight.js/lib/languages/sql") },
  {
    value: "swift",
    label: "Swift",
    aliases: [],
    load: () => import("highlight.js/lib/languages/swift"),
  },
  {
    value: "typescript",
    label: "TypeScript",
    aliases: ["ts", "tsx", "mts", "cts"],
    load: () => import("highlight.js/lib/languages/typescript"),
  },
  {
    value: "yaml",
    label: "YAML",
    aliases: ["yml"],
    load: () => import("highlight.js/lib/languages/yaml"),
  },
];

/** What the language selectors offer (no grammar: importing this costs nothing). */
export const CODE_LANGUAGES: { value: string; label: string }[] = [
  { value: PLAIN_TEXT, label: "Texto sin formato" },
  ...LANGUAGES.map(({ value, label }) => ({ value, label })),
];

export const lowlight = createLowlight({ [PLAIN_TEXT]: plaintext });

const loading = new Map<string, Promise<void>>();

/**
 * Registers the grammar of `name` (a language or one of its aliases), fetching
 * it on first use. A name we do not offer resolves at once and stays plain.
 */
export function loadLanguage(name: string): Promise<void> {
  const language = LANGUAGES.find((l) => l.value === name || l.aliases.includes(name));
  if (!language) return Promise.resolve();
  let pending = loading.get(language.value);
  if (!pending) {
    pending = language.load().then(
      (grammar) => lowlight.register(language.value, grammar.default),
      // a failed fetch must not stick: the next block that needs it tries again
      (error: unknown) => {
        loading.delete(language.value);
        throw error;
      },
    );
    loading.set(language.value, pending);
  }
  return pending;
}
