// Importing documents. A Markdown file becomes the document of a new page: the same conversion the AI uses
// (`markdownToBlocks`), after the things a file has and a model's reply does not — a front-matter header, lines
// wrapped at 80 columns (here a line is a paragraph, so soft wraps are joined first) and images that sit on a line
// of their own. Pure (no browser, no app), so `node --test tests/` can load it.
import type { JSONContent } from "@tiptap/core";
import { markdownToBlocks } from "./markdown-blocks.ts";

/** Most characters a page title keeps (Rust takes the title from the first heading and caps it). */
const MAX_TITLE = 200;

const FENCE = /^\s*```/;
const BLOCK_START =
  /^\s*(#{1,6}\s|>|\||([-*+]|\d+[.)])\s|-{3,}\s*$|\*{3,}\s*$|_{3,}\s*$|@@IMG\d+@@\s*$)/;
// lines that end where they end (a paragraph or a list item may go on, these may not)
const SELF_CONTAINED = /^\s*(#{1,6}\s|>|\||-{3,}\s*$|\*{3,}\s*$|_{3,}\s*$|@@IMG\d+@@)/;
const IMAGE_LINE = /^\s*!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)\s*$/;

/** The text of a `title:` key and the body, when the file opens with a `---` front-matter header. */
export function splitFrontMatter(markdown: string): { body: string; title: string | null } {
  const m = markdown.match(/^\uFEFF?---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/);
  if (!m) return { body: markdown.replace(/^\uFEFF/, ""), title: null };
  const title = m[1].match(/^title:\s*(.+?)\s*$/im)?.[1]?.replace(/^(["'])(.*)\1$/, "$2") ?? null;
  return { body: markdown.slice(m[0].length), title: title || null };
}

/** Joins the lines a paragraph (or a list item) was wrapped over, leaving code, tables, headings and lists alone. */
export function joinSoftWraps(markdown: string): string {
  const out: string[] = [];
  let fenced = false;
  let previousIsText = false; // the last output line can take a continuation
  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      out.push(line);
      previousIsText = false;
      continue;
    }
    if (fenced || !line.trim()) {
      out.push(line);
      previousIsText = false;
      continue;
    }
    // a continuation: plain text right under text or under a list item (indented or not)
    if (previousIsText && !BLOCK_START.test(line)) {
      out[out.length - 1] = `${out[out.length - 1].replace(/\s+$/, "")} ${line.trim()}`;
      continue;
    }
    out.push(line);
    previousIsText = !SELF_CONTAINED.test(line);
  }
  return out.join("\n");
}

/** Puts a placeholder where each image that sits alone on a line is, and lists those images in order. */
function takeImageLines(markdown: string): {
  marked: string;
  found: { src: string; alt: string }[];
} {
  const found: { src: string; alt: string }[] = [];
  let fenced = false;
  const marked = markdown
    .split("\n")
    .map((line) => {
      if (FENCE.test(line)) {
        fenced = !fenced;
        return line;
      }
      const m = fenced ? null : line.match(IMAGE_LINE);
      if (!m) return line;
      found.push({ src: m[2], alt: m[1] });
      return `\n@@IMG${found.length - 1}@@\n`;
    })
    .join("\n");
  return { marked, found };
}

/** The images that sit alone on a line: where they point to and their alternative text. */
export function imageLines(markdown: string): { src: string; alt: string }[] {
  return takeImageLines(splitFrontMatter(markdown.replace(/\r\n?/g, "\n")).body).found;
}

const heading = (text: string): JSONContent => ({
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text: text.slice(0, MAX_TITLE) }],
});

/**
 * The document of a page made from a Markdown file: its blocks, with the title as the first heading — the file's
 * own first `# Heading`, else its front matter's `title:`, else `fallbackTitle` (the file name). `image` turns the
 * image-only lines into blocks (null leaves the alternative text where the image was).
 */
export function markdownToPageDoc(
  markdown: string,
  fallbackTitle: string,
  image: (src: string, alt: string) => JSONContent | null = () => null,
): JSONContent {
  const { body, title: frontTitle } = splitFrontMatter(markdown.replace(/\r\n?/g, "\n"));
  const { marked, found } = takeImageLines(body);
  const blocks = markdownToBlocks(joinSoftWraps(marked)).map((block): JSONContent => {
    const text =
      block.type === "paragraph" ? (block.content?.map((n) => n.text ?? "").join("") ?? "") : "";
    const hit = text.match(/^@@IMG(\d+)@@$/);
    if (!hit) return block;
    const { src, alt } = found[Number(hit[1])];
    return (
      image(src, alt) ?? { type: "paragraph", content: alt ? [{ type: "text", text: alt }] : [] }
    );
  });
  const first = blocks[0];
  const hasTitle =
    first?.type === "heading" && first.attrs?.level === 1 && (first.content?.length ?? 0) > 0;
  const title = (frontTitle ?? fallbackTitle).trim() || "Sin título";
  const content = hasTitle ? blocks : [heading(title), ...blocks];
  return {
    type: "doc",
    content: content.length > 1 ? content : [...content, { type: "paragraph" }],
  };
}

/** «Mi_nota.md» → «Mi nota». */
export function titleFromFileName(name: string): string {
  const base = name
    .replace(/\.[^./\\]+$/, "")
    .replace(/_+/g, " ")
    .trim();
  return base || "Sin título";
}
