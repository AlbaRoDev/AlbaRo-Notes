// Importing documents as pages: Markdown, Word (.docx), HTML and plain text, one by one or a whole folder (a folder
// becomes a page and its files and sub-folders pages inside it). Everything that comes in is hostile: sizes and
// counts are capped here, Word and HTML go through the editor's own schema (anything it does not know is dropped),
// links keep only http, https and mailto, and Rust validates the document again when it is saved.
import { getSchema, type JSONContent } from "@tiptap/core";
import { DOMParser as PMParser } from "@tiptap/pm/model";
import { contentExtensions } from "../editor/editor-extensions";
import { asHttpUrl, errorMessage, storeAttachment } from "../../lib/attachments";
import { imageLines, markdownToPageDoc, titleFromFileName } from "../../lib/import-markdown";
import { createPage, deletePage, savePageContent } from "../../lib/db-client";
import type { PageSummary } from "../../types";

const MAX_FILES = 300;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_DOCX_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DEPTH = 8;
const MAX_DOC_CHARS = 4_000_000;

const MARKDOWN = new Set(["md", "markdown"]);
const TEXT = new Set(["txt"]);
const HTML = new Set(["html", "htm"]);
const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

const extOf = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();

/** Kinds of file that become a page when dropped on their own (a plain .txt is more likely to be attached). */
function isDroppableDocument(name: string): boolean {
  const ext = extOf(name);
  return MARKDOWN.has(ext) || HTML.has(ext) || ext === "docx";
}

const isDocument = (name: string) => isDroppableDocument(name) || TEXT.has(extOf(name));

export type ImportNode =
  | { kind: "file"; file: File; path: string }
  | { kind: "folder"; name: string; path: string; children: ImportNode[] };

// ---------------------------------------------------------------- collecting what was dropped or picked

/** What a drop carries, read synchronously (the browser empties the list as soon as the handler returns). */
export interface DroppedEntry {
  entry: FileSystemEntry | null;
  file: File | null;
}

export function readDrop(dt: DataTransfer): DroppedEntry[] {
  return Array.from(dt.items)
    .filter((item) => item.kind === "file")
    .map((item) => ({ entry: item.webkitGetAsEntry?.() ?? null, file: item.getAsFile() }));
}

/** Does the drop hold something to import: a folder or a document? (Images and the rest go to the editor.) */
export function dropHasImportable(dropped: DroppedEntry[]): boolean {
  return dropped.some(
    ({ entry, file }) => entry?.isDirectory || (file !== null && isDroppableDocument(file.name)),
  );
}

const readAll = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
  new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) return resolve(all);
        all.push(...batch);
        next();
      }, reject);
    next();
  });

const fileOf = (entry: FileSystemFileEntry): Promise<File> =>
  new Promise((resolve, reject) => entry.file(resolve, reject));

const SKIPPED_FOLDERS = /^(\.|node_modules$)/; // .git, .obsidian, node_modules…

async function walkEntry(
  entry: FileSystemEntry,
  path: string,
  depth: number,
  budget: { left: number },
): Promise<ImportNode | null> {
  if (entry.isFile) {
    if (!isDocument(entry.name) && !IMAGES.has(extOf(entry.name))) return null;
    if (budget.left <= 0) return null;
    budget.left -= 1;
    return {
      kind: "file",
      file: await fileOf(entry as FileSystemFileEntry),
      path: `${path}${entry.name}`,
    };
  }
  if (!entry.isDirectory || SKIPPED_FOLDERS.test(entry.name) || depth >= MAX_DEPTH) return null;
  const children: ImportNode[] = [];
  const entries = (await readAll((entry as FileSystemDirectoryEntry).createReader())).sort((a, b) =>
    a.name.localeCompare(b.name, "es", { numeric: true }),
  );
  for (const child of entries) {
    const node = await walkEntry(child, `${path}${entry.name}/`, depth + 1, budget);
    if (node) children.push(node);
  }
  return { kind: "folder", name: entry.name, path: `${path}${entry.name}/`, children };
}

/** The tree behind a drop (folders walked, unrelated files left out). */
export async function collectDropped(dropped: DroppedEntry[]): Promise<ImportNode[]> {
  const budget = { left: MAX_FILES + 200 }; // images count too
  const nodes: ImportNode[] = [];
  for (const { entry, file } of dropped) {
    if (entry) {
      const node = await walkEntry(entry, "", 0, budget);
      if (node) nodes.push(node);
    } else if (file && isDocument(file.name)) nodes.push({ kind: "file", file, path: file.name });
  }
  return nodes;
}

/** The tree behind a file picker (`webkitRelativePath` tells the folders when a folder was picked). */
export function collectPicked(files: File[]): ImportNode[] {
  const root: ImportNode[] = [];
  const folders = new Map<string, Extract<ImportNode, { kind: "folder" }>>();
  const budget = { left: MAX_FILES + 200 };
  for (const file of [...files].sort((a, b) =>
    (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, "es", {
      numeric: true,
    }),
  )) {
    if (!isDocument(file.name) && !IMAGES.has(extOf(file.name))) continue;
    const parts = (file.webkitRelativePath || file.name).split("/");
    if (parts.slice(0, -1).some((p) => SKIPPED_FOLDERS.test(p)) || parts.length - 1 > MAX_DEPTH)
      continue;
    if (budget.left <= 0) break;
    budget.left -= 1;
    let siblings = root;
    let path = "";
    for (const name of parts.slice(0, -1)) {
      path += `${name}/`;
      let folder = folders.get(path);
      if (!folder) {
        folder = { kind: "folder", name, path, children: [] };
        folders.set(path, folder);
        siblings.push(folder);
      }
      siblings = folder.children;
    }
    siblings.push({ kind: "file", file, path: parts.join("/") });
  }
  return root;
}

// ---------------------------------------------------------------- converting one document

/** Links keep only http, https and mailto; anything else (`javascript:`…) loses the link and keeps its text. */
function cleanLinks(nodes: JSONContent[]): JSONContent[] {
  return nodes.map((node) => {
    const marks = node.marks?.filter(
      (m) =>
        m.type !== "link" ||
        (typeof m.attrs?.href === "string" &&
          (asHttpUrl(m.attrs.href) || /^mailto:[^\s]+$/i.test(m.attrs.href))),
    );
    return {
      ...node,
      ...(node.marks ? { marks: marks && marks.length > 0 ? marks : undefined } : {}),
      ...(node.content ? { content: cleanLinks(node.content) } : {}),
    };
  });
}

let schema: ReturnType<typeof getSchema> | null = null;

/** The blocks of an HTML document, as the editor's schema reads them (what it does not know is dropped). */
function htmlToBlocks(html: string): { blocks: JSONContent[]; title: string | null } {
  schema ??= getSchema(contentExtensions);
  const dom = new window.DOMParser().parseFromString(html, "text/html");
  dom
    .querySelectorAll("script, style, iframe, object, embed, link, meta, noscript")
    .forEach((el) => el.remove());
  // the editor has three heading levels: deeper ones read as the third
  dom.querySelectorAll("h4, h5, h6").forEach((h) => {
    const three = dom.createElement("h3");
    three.append(...Array.from(h.childNodes));
    h.replaceWith(three);
  });
  const title = dom.querySelector("title")?.textContent?.trim() || null;
  const doc = PMParser.fromSchema(schema).parse(dom.body);
  return { blocks: cleanLinks((doc.toJSON() as JSONContent).content ?? []), title };
}

/** A page document from blocks: the first level-1 heading is the title, else `fallback` is put in front. */
function pageDoc(blocks: JSONContent[], fallback: string): JSONContent {
  const first = blocks[0];
  const hasTitle =
    first?.type === "heading" && first.attrs?.level === 1 && (first.content?.length ?? 0) > 0;
  const content = hasTitle
    ? blocks
    : [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: fallback.slice(0, 200) }],
        },
        ...blocks,
      ];
  return {
    type: "doc",
    content: content.length > 1 ? content : [...content, { type: "paragraph" }],
  };
}

async function docxToHtml(
  file: File,
  storeImage: (blob: Blob, mime: string) => Promise<string | null>,
): Promise<string> {
  const mod = await import("mammoth");
  const mammoth = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const result = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const buffer = await image.readAsArrayBuffer();
        const stored =
          buffer.byteLength <= MAX_IMAGE_BYTES
            ? await storeImage(new Blob([buffer], { type: image.contentType }), image.contentType)
            : null;
        return { src: stored ? `albaro-attachment:${stored}` : "" };
      }),
    },
  );
  return result.value;
}

/** An image block for a stored attachment. */
const imageBlock = (file: string, name: string, size: number): JSONContent => ({
  type: "image",
  attrs: { file, name, size },
});

/** `<img src="albaro-attachment:…">` (what the Word converter left) as the image blocks the editor reads. */
function swapImages(html: string, sizes: Map<string, number>): string {
  const dom = new window.DOMParser().parseFromString(html, "text/html");
  dom.querySelectorAll("img").forEach((img) => {
    const file = (img.getAttribute("src") ?? "").replace(/^albaro-attachment:/, "");
    if (
      !img.getAttribute("src")?.startsWith("albaro-attachment:") ||
      !/^[0-9a-f-]{36}\.\w+$/i.test(file)
    )
      return img.remove();
    const block = dom.createElement("div");
    block.dataset.type = "image";
    block.dataset.file = file;
    block.dataset.name = img.getAttribute("alt") || "Imagen";
    block.dataset.size = String(sizes.get(file) ?? 0);
    img.replaceWith(block);
  });
  return dom.body.innerHTML;
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

interface Context {
  images: Map<string, File>;
  stored: Map<string, { file: string; size: number }>;
}

async function storeFile(
  ctx: Context,
  key: string,
  file: File,
): Promise<{ file: string; size: number } | null> {
  const known = ctx.stored.get(key);
  if (known) return known;
  if (file.size > MAX_IMAGE_BYTES) return null;
  try {
    const info = await storeAttachment(file);
    const value = { file: info.file, size: info.size };
    ctx.stored.set(key, value);
    return value;
  } catch {
    return null;
  }
}

async function convert(
  node: Extract<ImportNode, { kind: "file" }>,
  ctx: Context,
): Promise<JSONContent> {
  const { file, path } = node;
  const ext = extOf(file.name);
  const fallback = titleFromFileName(file.name);
  if (ext === "docx") {
    if (file.size > MAX_DOCX_BYTES) throw new Error("El documento pasa de 25 MB");
    const sizes = new Map<string, number>();
    const html = await docxToHtml(file, async (blob, mime) => {
      const info = await storeAttachment(
        new File([blob], `imagen.${mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "png"}`, {
          type: mime,
        }),
      );
      sizes.set(info.file, info.size);
      return info.file;
    });
    const { blocks } = htmlToBlocks(swapImages(html, sizes));
    return pageDoc(blocks, fallback);
  }
  if (file.size > MAX_TEXT_BYTES) throw new Error("El archivo pasa de 5 MB");
  const text = await file.text();
  if (HTML.has(ext)) {
    const { blocks, title } = htmlToBlocks(text);
    return pageDoc(blocks, title ?? fallback);
  }
  if (TEXT.has(ext)) {
    const blocks: JSONContent[] = text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => ({ type: "paragraph", content: [{ type: "text", text: l.trim() }] }));
    return pageDoc(blocks, fallback);
  }
  // Markdown: the images that sit on a line of their own and are in the folder become image blocks
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
  const resolved = new Map<string, JSONContent>();
  for (const { src, alt } of imageLines(text)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || resolved.has(src)) continue;
    let target = src;
    try {
      target = decodeURIComponent(src);
    } catch {
      // keep it as written
    }
    const key = normalize(`${folder}${target}`);
    const image = ctx.images.get(key);
    const stored = image ? await storeFile(ctx, key, image) : null;
    if (stored) resolved.set(src, imageBlock(stored.file, alt || image!.name, stored.size));
  }
  return markdownToPageDoc(text, fallback, (src) => resolved.get(src) ?? null);
}

// ---------------------------------------------------------------- importing a tree

export interface ImportReport {
  /** Pages made, in order (a folder's page first, then what is inside it). */
  created: PageSummary[];
  skipped: { name: string; reason: string }[];
}

function collectImages(nodes: ImportNode[], into: Map<string, File>) {
  for (const node of nodes) {
    if (node.kind === "folder") collectImages(node.children, into);
    else if (IMAGES.has(extOf(node.file.name))) into.set(normalize(node.path), node.file);
  }
}

const hasDocuments = (node: ImportNode): boolean =>
  node.kind === "file" ? isDocument(node.file.name) : node.children.some(hasDocuments);

/** Makes a page of each document and a page of each folder, `parentId` being where they go (none = the top level). */
export async function importNodes(
  nodes: ImportNode[],
  onProgress?: (done: number) => void,
): Promise<ImportReport> {
  const report: ImportReport = { created: [], skipped: [] };
  const ctx: Context = { images: new Map(), stored: new Map() };
  collectImages(nodes, ctx.images);
  let done = 0;

  async function makePage(
    parentId: string | undefined,
    doc: JSONContent,
    name: string,
  ): Promise<PageSummary | null> {
    if (JSON.stringify(doc).length > MAX_DOC_CHARS) {
      report.skipped.push({ name, reason: "es demasiado grande" });
      return null;
    }
    const page = await createPage(parentId);
    try {
      await savePageContent(page.id, doc);
    } catch (e) {
      await deletePage(page.id).catch(() => undefined);
      report.skipped.push({ name, reason: errorMessage(e) });
      return null;
    }
    report.created.push(page);
    onProgress?.(++done);
    return page;
  }

  async function walk(list: ImportNode[], parentId: string | undefined) {
    for (const node of list) {
      if (report.created.length + report.skipped.length >= MAX_FILES) {
        report.skipped.push({
          name: "…",
          reason: `solo se importan ${MAX_FILES} archivos de una vez`,
        });
        return;
      }
      if (node.kind === "folder") {
        if (!hasDocuments(node)) continue;
        const folderDoc: JSONContent = {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 1 },
              content: [{ type: "text", text: node.name.slice(0, 200) }],
            },
            { type: "paragraph" },
          ],
        };
        const page = await makePage(parentId, folderDoc, node.name);
        if (page) await walk(node.children, page.id);
      } else if (isDocument(node.file.name)) {
        try {
          await makePage(parentId, await convert(node, ctx), node.file.name);
        } catch (e) {
          report.skipped.push({ name: node.file.name, reason: errorMessage(e) });
        }
      }
    }
  }
  await walk(nodes, undefined);
  return report;
}
