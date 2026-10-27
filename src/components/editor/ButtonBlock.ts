import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { ButtonBlockView } from "./ButtonBlockView";
import { normalizeButtonAttrs } from "./button-actions";

/** "Botón": a block that runs one action from the closed set in button-actions.ts. */
export const ButtonBlock = Node.create({
  name: "buttonBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      label: { default: "" },
      action: { default: null },
      pageId: { default: null },
      block: { default: null },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-type="button-block"]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          return normalizeButtonAttrs({
            label: el.getAttribute("data-label"),
            action: el.getAttribute("data-action"),
            pageId: el.getAttribute("data-page-id"),
            block: el.getAttribute("data-block"),
          });
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "button-block",
        "data-label": node.attrs.label ?? "",
        "data-action": node.attrs.action ?? "",
        "data-page-id": node.attrs.pageId ?? "",
        "data-block": node.attrs.block ?? "",
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ButtonBlockView);
  },
});
