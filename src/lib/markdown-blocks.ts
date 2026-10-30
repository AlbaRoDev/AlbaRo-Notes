// Notion-AI-style writing. The model reads and writes Markdown; the editor holds Tiptap
// blocks. This converts between the two for the subset a writing assistant needs, so «convierte esto
// en checklist» gives real checkboxes and a summary arrives as real headings and lists.
// No imports at runtime (only types), so `node --test tests/` can load it directly.
import type { JSONContent } from "@tiptap/core";

type Mark = { type: string; attrs?: Record<string, unknown> };

// ---------------------------------------------------------------- Markdown → blocks

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(?:\[( |x|X)\]\s+)?(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Text with **bold**, *italic*, `code`, ~~strike~~ and [links](https://…) as text nodes with marks. */
export function inlineToNodes(text: string, marks: Mark[] = []): JSONContent[] {
  const out: JSONContent[] = [];
  const pattern =
    /(\*\*|__)(.+?)\1|(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])|(?<!\w)_(?![\s_])(.+?)(?<![\s_])_(?!\w)|`([^`]+)`|~~(.+?)~~|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const plain = (s: string) => {
    if (s) out.push(marks.length ? { type: "text", text: s, marks } : { type: "text", text: s });
  };
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    plain(text.slice(last, m.index));
    last = (m.index ?? 0) + m[0].length;
    if (m[2] !== undefined) out.push(...inlineToNodes(m[2], [...marks, { type: "bold" }]));
    else if (m[3] !== undefined) out.push(...inlineToNodes(m[3], [...marks, { type: "italic" }]));
    else if (m[4] !== undefined) out.push(...inlineToNodes(m[4], [...marks, { type: "italic" }]));
    else if (m[5] !== undefined)
      out.push({ type: "text", text: m[5], marks: [...marks, { type: "code" }] });
    else if (m[6] !== undefined) out.push(...inlineToNodes(m[6], [...marks, { type: "strike" }]));
    else if (m[7] !== undefined)
      out.push(...inlineToNodes(m[7], [...marks, { type: "link", attrs: { href: m[8] } }]));
  }
  plain(text.slice(last));
  return out;
}

const paragraph = (text: string): JSONContent => {
  const content = inlineToNodes(text.trim());
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};

const indentOf = (line: string) => line.length - line.trimStart().length;

type ListKind = "bulletList" | "orderedList" | "taskList";

function listKind(m: RegExpMatchArray): ListKind {
  if (m[3] !== undefined) return "taskList";
  return /\d/.test(m[2]) ? "orderedList" : "bulletList";
}

/** A list starting at `start` whose items are indented `base`; deeper items become nested lists. */
function parseList(
  lines: string[],
  start: number,
  base: number,
): { node: JSONContent; next: number } {
  const first = lines[start].match(LIST_ITEM)!;
  const kind = listKind(first);
  const items: JSONContent[] = [];
  let i = start;
  while (i < lines.length) {
    const m = lines[i].match(LIST_ITEM);
    if (!m || indentOf(lines[i]) !== base || listKind(m) !== kind) break;
    let text = m[4];
    i++;
    const children: JSONContent[] = [];
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        // a blank line ends the item unless what follows is indented under it
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && indentOf(lines[j]) > base) {
          i = j;
          continue;
        }
        break;
      }
      const child = line.match(LIST_ITEM);
      if (child && indentOf(line) > base) {
        const nested = parseList(lines, i, indentOf(line));
        children.push(nested.node);
        i = nested.next;
      } else if (!child && indentOf(line) > base) {
        text += ` ${line.trim()}`; // a wrapped item continues on the next line
        i++;
      } else {
        break;
      }
    }
    const body = [paragraph(text), ...children];
    items.push(
      kind === "taskList"
        ? { type: "taskItem", attrs: { checked: /x/i.test(m[3] ?? "") }, content: body }
        : { type: "listItem", content: body },
    );
  }
  const startNumber = kind === "orderedList" ? parseInt(first[2], 10) : 1;
  const node: JSONContent = { type: kind, content: items };
  if (startNumber > 1) node.attrs = { start: startNumber };
  return { node, next: i };
}

const tableCells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/** Markdown (as models write it) to editor blocks. Each plain line is its own paragraph, as in Notion. */
export function markdownToBlocks(markdown: string): JSONContent[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: JSONContent[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }
    const fence = trimmed.match(/^```\s*([\w+#-]*)\s*$/);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++; // the closing fence (or the end, if the model forgot it)
      const text = code.join("\n");
      blocks.push({
        type: "codeBlock",
        attrs: { language: fence[1] || "plaintext" },
        ...(text ? { content: [{ type: "text", text }] } : {}),
      });
      continue;
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const content = inlineToNodes(heading[2].replace(/\s+#+\s*$/, ""));
      blocks.push({
        type: "heading",
        attrs: { level: Math.min(heading[1].length, 4) },
        ...(content.length ? { content } : {}),
      });
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "horizontalRule" });
      i++;
      continue;
    }
    if (trimmed.startsWith("|") && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) {
      const header = tableCells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(tableCells(lines[i++]));
      const cell = (type: string, text: string): JSONContent => ({
        type,
        content: [paragraph(text)],
      });
      blocks.push({
        type: "table",
        content: [
          { type: "tableRow", content: header.map((h) => cell("tableHeader", h)) },
          ...rows.map((r) => ({
            type: "tableRow",
            content: header.map((_, c) => cell("tableCell", r[c] ?? "")),
          })),
        ],
      });
      continue;
    }
    if (/^>/.test(trimmed)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]))
        quoted.push(lines[i++].replace(/^\s*>\s?/, ""));
      const inner = markdownToBlocks(quoted.join("\n"));
      blocks.push({ type: "blockquote", content: inner.length ? inner : [{ type: "paragraph" }] });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const { node, next } = parseList(lines, i, indentOf(line));
      blocks.push(node);
      i = next;
      continue;
    }
    blocks.push(paragraph(trimmed));
    i++;
  }
  return blocks;
}

// ---------------------------------------------------------------- blocks → Markdown

function marksWrap(text: string, marks: Mark[] | undefined): string {
  let out = text;
  for (const mark of marks ?? []) {
    if (mark.type === "bold") out = `**${out}**`;
    else if (mark.type === "italic") out = `*${out}*`;
    else if (mark.type === "code") out = `\`${out}\``;
    else if (mark.type === "strike") out = `~~${out}~~`;
    else if (mark.type === "link" && typeof mark.attrs?.href === "string")
      out = `[${out}](${mark.attrs.href})`;
  }
  return out;
}

function inlineToMarkdown(nodes: JSONContent[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === "text") return marksWrap(n.text ?? "", n.marks as Mark[] | undefined);
      if (n.type === "hardBreak") return "\n";
      if (n.type === "dateMention") return String(n.attrs?.date ?? "");
      if (n.type === "equationInline") return `$${String(n.attrs?.latex ?? "")}$`;
      return "";
    })
    .join("");
}

function listToMarkdown(list: JSONContent, depth: number): string[] {
  const pad = "  ".repeat(depth);
  let number = Number(list.attrs?.start ?? 1);
  return (list.content ?? []).flatMap((item) => {
    const marker =
      list.type === "orderedList"
        ? `${number++}.`
        : list.type === "taskList"
          ? `- [${item.attrs?.checked ? "x" : " "}]`
          : "-";
    const [first, ...rest] = item.content ?? [];
    return [
      `${pad}${marker} ${first?.type === "paragraph" ? inlineToMarkdown(first.content) : ""}`,
      ...rest.flatMap((child) =>
        ["bulletList", "orderedList", "taskList"].includes(child.type ?? "")
          ? listToMarkdown(child, depth + 1)
          : blocksToMarkdown([child])
              .split("\n")
              .map((l) => `${pad}  ${l}`),
      ),
    ];
  });
}

/** Editor blocks to Markdown, so the model sees the structure of what it is asked to edit. */
export function blocksToMarkdown(nodes: JSONContent[]): string {
  const out: string[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "paragraph":
        out.push(inlineToMarkdown(node.content));
        break;
      case "heading":
        out.push(`${"#".repeat(Number(node.attrs?.level ?? 1))} ${inlineToMarkdown(node.content)}`);
        break;
      case "bulletList":
      case "orderedList":
      case "taskList":
        out.push(listToMarkdown(node, 0).join("\n"));
        break;
      case "blockquote":
        out.push(
          blocksToMarkdown(node.content ?? [])
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n"),
        );
        break;
      case "codeBlock":
        out.push(
          `\`\`\`${node.attrs?.language && node.attrs.language !== "plaintext" ? node.attrs.language : ""}\n${inlineToMarkdown(node.content)}\n\`\`\``,
        );
        break;
      case "horizontalRule":
        out.push("---");
        break;
      case "table": {
        const rows = (node.content ?? []).map(
          (row) =>
            `| ${(row.content ?? []).map((cell) => blocksToMarkdown(cell.content ?? []).replace(/\n+/g, " ")).join(" | ")} |`,
        );
        if (rows.length)
          rows.splice(1, 0, `|${" --- |".repeat((node.content?.[0]?.content ?? []).length)}`);
        out.push(rows.join("\n"));
        break;
      }
      default:
        // containers (callout, toggle, columns, tabs…) give their text; other blocks a marker
        if (node.content?.length) out.push(blocksToMarkdown(node.content));
        else if (node.type !== "text") out.push(`[${node.type}]`);
    }
  }
  return out.filter((s) => s !== "").join("\n\n");
}

// ---------------------------------------------------------------- safety

const TEXT_BLOCKS = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "text",
  "hardBreak",
]);

/** Whether these blocks are only text the round trip keeps. Replacing a selection that also holds an
 *  image, a database view, a mention… would lose it, so then the AI only inserts below. */
export function isOnlyText(nodes: JSONContent[]): boolean {
  return nodes.every((n) => TEXT_BLOCKS.has(n.type ?? "") && isOnlyText(n.content ?? []));
}
