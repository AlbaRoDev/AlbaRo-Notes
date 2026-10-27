import type { JSONContent } from "@tiptap/react";

/**
 * The only things a button can do — a closed set, so a saved/pasted button can
 * never carry code or a path. `insertBlock` maps a key to a hard-coded node
 * built here, never to JSON from the document. Mirrored in Rust
 * (`validate.rs`: BUTTON_INSERT_BLOCKS), which rejects anything else on save.
 */
export const BUTTON_BLOCKS = {
  paragraph: { label: "Texto", node: { type: "paragraph" } },
  taskList: {
    label: "Checklist",
    node: {
      type: "taskList",
      content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] }],
    },
  },
  callout: { label: "Destacado", node: { type: "callout", content: [{ type: "paragraph" }] } },
  horizontalRule: { label: "Divisor", node: { type: "horizontalRule" } },
} satisfies Record<string, { label: string; node: JSONContent }>;

export type ButtonBlockKind = keyof typeof BUTTON_BLOCKS;
export type ButtonAction = "openPage" | "insertBlock";

export const MAX_BUTTON_LABEL = 80;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isButtonBlockKind = (v: unknown): v is ButtonBlockKind =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(BUTTON_BLOCKS, v);

/** Coerces untrusted attrs (pasted HTML) into a state Rust will accept: an action without its target becomes "no action". */
export function normalizeButtonAttrs(raw: Record<string, unknown>) {
  const label = typeof raw.label === "string" ? raw.label.slice(0, MAX_BUTTON_LABEL) : "";
  const pageId = typeof raw.pageId === "string" && UUID_RE.test(raw.pageId) ? raw.pageId : null;
  const block = isButtonBlockKind(raw.block) ? raw.block : null;
  if (raw.action === "openPage" && pageId)
    return { label, action: "openPage", pageId, block: null };
  if (raw.action === "insertBlock" && block)
    return { label, action: "insertBlock", pageId: null, block };
  return { label, action: null, pageId: null, block: null };
}
