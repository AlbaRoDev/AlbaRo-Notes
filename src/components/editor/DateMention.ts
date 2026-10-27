import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { DateMentionView } from "./DateMentionView";

/**
 * Inline date/reminder mention. Stores the date as ISO 8601 (YYYY-MM-DD, the
 * native <input type="date"> format) rather than free text, so it can
 * directly feed a calendar view. `date: null` is the
 * "still picking" state, same pattern as PageLink's `pageId: null`.
 */
export const DateMention = Node.create({
  name: "dateMention",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      date: { default: null },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-type="date-mention"]',
        getAttrs: (el) => ({ date: (el as HTMLElement).getAttribute("data-date") || null }),
      },
    ];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "date-mention",
        "data-date": node.attrs.date ?? "",
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(DateMentionView);
  },
});
