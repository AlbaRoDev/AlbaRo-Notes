import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { BreadcrumbView } from "./BreadcrumbView";

export const Breadcrumb = Node.create({
  name: "breadcrumb",
  group: "block",
  atom: true,
  parseHTML() {
    return [{ tag: 'div[data-type="breadcrumb"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "breadcrumb" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(BreadcrumbView);
  },
});
