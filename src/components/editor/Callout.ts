import { Node, mergeAttributes } from "@tiptap/react";

/**
 * Callout block: a highlighted box with a fixed emoji marker. Wraps block
 * content the same way blockquote does (content/group/defining mirror
 * @tiptap/extension-blockquote) so lift/join at its boundaries behave the
 * same way editors already expect. Toggled via the generic `toggleWrap`
 * core command from the slash menu — no custom command needed.
 */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "callout" }), 0];
  },
});
