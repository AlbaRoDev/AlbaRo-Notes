import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { EquationBlockView } from "./EquationBlockView";

/** Block LaTeX equation (KaTeX display mode). Same `latex` attr as the inline one; multi-line allowed. */
export const EquationBlock = Node.create({
  name: "equationBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      latex: { default: "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-type="equation-block"]',
        getAttrs: (el) => ({ latex: (el as HTMLElement).getAttribute("data-latex") || "" }),
      },
    ];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "equation-block",
        "data-latex": node.attrs.latex ?? "",
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(EquationBlockView);
  },
});
