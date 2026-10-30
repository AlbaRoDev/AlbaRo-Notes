import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { CalloutView } from "./CalloutView";

/**
 * Callout block: a highlighted box with an icon (an emoji, or an icon of the library; none is allowed). Wraps
 * block content the same way blockquote does (content/group/defining mirror @tiptap/extension-blockquote) so
 * lift/join at its boundaries behave the way editors already expect. Toggled via the generic `toggleWrap` core
 * command from the slash menu. A new one has the light bulb; a saved one without an icon attribute gets it too.
 */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      icon: {
        default: "💡",
        // `data-icon=""` is «no icon»; an element without the attribute keeps the default
        parseHTML: (el) => {
          const value = el.getAttribute("data-icon");
          return value === null ? "💡" : value || null;
        },
        renderHTML: (attributes) => ({ "data-icon": attributes.icon ?? "" }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "callout" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});
