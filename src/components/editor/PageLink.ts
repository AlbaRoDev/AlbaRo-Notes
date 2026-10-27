import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { PageLinkView } from "./PageLinkView";

/**
 * One node covers both "Página" (new sub-page) and "Página enlazada"
 * (reference to an existing one) — they only differ in how they're inserted
 * (items.ts creates a child page first vs. leaving pageId empty), not in
 * what gets rendered once resolved. `pageId: null` is the "still picking"
 * state, rendered by PageLinkView as an inline search box.
 */
export const PageLink = Node.create({
  name: "pageLink",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      pageId: { default: null },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-type="page-link"]',
        getAttrs: (el) => ({ pageId: (el as HTMLElement).getAttribute("data-page-id") || null }),
      },
    ];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "page-link",
        "data-page-id": node.attrs.pageId ?? "",
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageLinkView);
  },
});
