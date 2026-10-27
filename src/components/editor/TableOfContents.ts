import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { TableOfContentsView } from "./TableOfContentsView";

export const TableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  parseHTML() {
    return [{ tag: 'div[data-type="table-of-contents"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "table-of-contents" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TableOfContentsView);
  },
});
