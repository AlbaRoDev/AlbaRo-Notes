import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { PageMentionView } from "./PageMentionView";

/**
 * Inline page mention — same `pageId`/"still picking" shape as the block-level
 * PageLink, but rendered as a small inline chip so it can sit mid-sentence.
 * Kept as a separate node (rather than reusing PageLink with a variant attr)
 * because the two need different node groups (block vs inline) and Tiptap
 * node types can't switch group at runtime.
 */
export const PageMention = Node.create({
  name: "pageMention",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      pageId: { default: null },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-type="page-mention"]',
        getAttrs: (el) => ({ pageId: (el as HTMLElement).getAttribute("data-page-id") || null }),
      },
    ];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "page-mention",
        "data-page-id": node.attrs.pageId ?? "",
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageMentionView);
  },
});
