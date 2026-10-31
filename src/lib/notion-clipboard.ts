// Notion's own copy format (`text/_notion-blocks-v3-production`) to editor blocks. The HTML and plain text
// Notion also puts in the clipboard cannot tell a toggle from a bullet, so this is read only for what they lose;
// anything it does not know returns null and the paste goes the usual way (HTML / Markdown).
// No imports at runtime (only types), so `node --test tests/` can load it directly.
import type { JSONContent } from "@tiptap/core";

export const NOTION_BLOCKS_MIME = "text/_notion-blocks-v3-production";

type Span = [string, ...[unknown[][]?]];
type NotionBlock = {
  type?: string;
  properties?: { title?: Span[]; checked?: [[string]]; language?: [[string]] };
  format?: { toggleable?: boolean; page_icon?: string };
  content?: string[];
};

const MAX_DEPTH = 30;
const HEADINGS = new Map([
  ["header", 1],
  ["sub_header", 2],
  ["sub_sub_header", 3],
]);
const LIST_OF = new Map([
  ["bulleted_list", "bulletList"],
  ["numbered_list", "orderedList"],
  ["to_do", "taskList"],
]);
const MARK_OF = new Map([
  ["b", "bold"],
  ["i", "italic"],
  ["s", "strike"],
  ["c", "code"],
]);
const LANGUAGE_OF = new Map([
  ["plain text", "plaintext"],
  ["c#", "csharp"],
  ["c++", "cpp"],
  ["shell", "bash"],
]);

class Unsupported extends Error {}

/** Rich text `[["text", [["b"], ["a", url]]], …]` as text nodes; a mention, date or equation is not handled. */
function inline(title: Span[] | undefined): JSONContent[] {
  const out: JSONContent[] = [];
  for (const [text, marks] of title ?? []) {
    if (typeof text !== "string" || text === "‣") throw new Unsupported();
    const set: { type: string; attrs?: Record<string, unknown> }[] = [];
    for (const mark of (marks ?? []) as unknown[][]) {
      const kind = String(mark[0]);
      if (MARK_OF.has(kind)) set.push({ type: MARK_OF.get(kind)! });
      else if (kind === "a" && typeof mark[1] === "string" && /^(https?:|mailto:)/i.test(mark[1]))
        set.push({ type: "link", attrs: { href: mark[1] } });
      else if (kind === "e" || kind === "d" || kind === "p" || kind === "u")
        throw new Unsupported();
      // other marks (colour, underline) are only looks: the text stays
    }
    text.split("\n").forEach((line, i) => {
      if (i > 0) out.push({ type: "hardBreak" });
      if (line)
        out.push(
          set.length ? { type: "text", text: line, marks: set } : { type: "text", text: line },
        );
    });
  }
  return out;
}

const para = (title: Span[] | undefined): JSONContent => {
  const content = inline(title);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};

function convert(
  ids: string[],
  blocks: Record<string, { value?: NotionBlock }>,
  depth: number,
  seen: Set<string>,
): JSONContent[] {
  if (depth > MAX_DEPTH) throw new Unsupported();
  const out: JSONContent[] = [];
  for (const id of ids) {
    const b = blocks[id]?.value;
    if (!b || seen.has(id)) throw new Unsupported();
    seen.add(id);
    const kids = () => convert(b.content ?? [], blocks, depth + 1, seen);
    const type = b.type ?? "";
    const title = b.properties?.title;
    const list = LIST_OF.get(type);
    if (list) {
      const item: JSONContent = {
        type: list === "taskList" ? "taskItem" : "listItem",
        content: [para(title), ...kids()],
      };
      if (list === "taskList") item.attrs = { checked: b.properties?.checked?.[0]?.[0] === "Yes" };
      // consecutive items of one kind are one list
      const last = out[out.length - 1];
      if (last?.type === list) last.content!.push(item);
      else out.push({ type: list, content: [item] });
    } else if (type === "toggle" || (HEADINGS.has(type) && b.format?.toggleable)) {
      const body = kids();
      out.push({
        type: "toggle",
        attrs: { open: true, headingLevel: HEADINGS.get(type) ?? null },
        content: [
          { type: "toggleSummary", content: inline(title) },
          { type: "toggleContent", content: body.length ? body : [{ type: "paragraph" }] },
        ],
      });
    } else if (HEADINGS.has(type)) {
      const content = inline(title);
      out.push(
        {
          type: "heading",
          attrs: { level: HEADINGS.get(type) },
          ...(content.length ? { content } : {}),
        },
        ...kids(),
      );
    } else if (type === "text") {
      out.push(para(title), ...kids());
    } else if (type === "quote") {
      out.push({ type: "blockquote", content: [para(title), ...kids()] });
    } else if (type === "callout") {
      out.push({
        type: "callout",
        attrs: { icon: b.format?.page_icon ?? null },
        content: [para(title), ...kids()],
      });
    } else if (type === "code") {
      const code = (title ?? []).map((s) => String(s[0])).join("");
      const lang = (b.properties?.language?.[0]?.[0] ?? "").toLowerCase();
      out.push({
        type: "codeBlock",
        attrs: { language: LANGUAGE_OF.get(lang) ?? (lang || "plaintext") },
        ...(code ? { content: [{ type: "text", text: code }] } : {}),
      });
    } else if (type === "divider") {
      out.push({ type: "horizontalRule" });
    } else {
      throw new Unsupported();
    }
  }
  return out;
}

const hasToggle = (blocks: Record<string, { value?: NotionBlock }>) =>
  Object.values(blocks).some(
    (b) =>
      b.value?.type === "toggle" ||
      (HEADINGS.has(b.value?.type ?? "") && b.value?.format?.toggleable),
  );

/**
 * The editor blocks for a Notion copy, or null when the usual paste does as well: no toggle in it (the HTML
 * already says the rest), a kind of block this does not know, or a payload that is not what it expects.
 */
export function notionBlocksToContent(raw: string): JSONContent[] | null {
  try {
    const data = JSON.parse(raw) as {
      blocks?: {
        blockId: string;
        blockSubtree?: { block?: Record<string, { value?: NotionBlock }> };
      }[];
    };
    if (!Array.isArray(data.blocks) || data.blocks.length === 0) return null;
    const pool: Record<string, { value?: NotionBlock }> = {};
    for (const entry of data.blocks) Object.assign(pool, entry.blockSubtree?.block);
    if (!hasToggle(pool)) return null;
    const out = convert(
      data.blocks.map((e) => e.blockId),
      pool,
      0,
      new Set(),
    );
    return out.length ? out : null;
  } catch (e) {
    if (e instanceof Unsupported || e instanceof SyntaxError || e instanceof TypeError) return null;
    throw e;
  }
}
