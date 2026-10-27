import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { EquationView } from "./EquationView";

/** Inline LaTeX equation, rendered with KaTeX. Editable by clicking the rendered output. */
export const Equation = Node.create({
  name: "equationInline",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      latex: { default: "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-type="equation-inline"]',
        getAttrs: (el) => ({ latex: (el as HTMLElement).getAttribute("data-latex") || "" }),
      },
    ];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "equation-inline",
        "data-latex": node.attrs.latex ?? "",
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(EquationView);
  },
});
