import type { JSONContent } from "@tiptap/react";

const UNTITLED = "Sin título";

/** Extracts the page title from the document's first heading node, mirroring db.rs's derive_page_title. */
export function deriveTitleFromDoc(doc: JSONContent): string {
  const first = doc.content?.[0];
  if (!first || first.type !== "heading") return UNTITLED;
  const text = collectText(first);
  return text || UNTITLED;
}

function collectText(node: JSONContent): string {
  let text = node.text ?? "";
  for (const child of node.content ?? []) {
    text += collectText(child);
  }
  return text;
}
