import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { ColumnsView } from "./ColumnsView";

export const ColumnList = Node.create({
  name: "columnList",
  group: "block",
  content: "column{2,5}",
  addNodeView() {
    return ReactNodeViewRenderer(ColumnsView);
  },
  parseHTML() {
    return [{ tag: 'div[data-type="column-list"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "column-list" }), 0];
  },
});

export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "column" }), 0];
  },
});
