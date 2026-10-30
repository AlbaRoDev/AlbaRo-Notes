import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { EmojiPickerView } from "./EmojiPickerView";

/**
 * Transient inline node: exists only while the user is searching for an
 * emoji. Picking one (or dismissing) deletes this node and, on pick, inserts
 * the raw emoji character as plain text in its place — so the saved doc
 * never contains a trace of this node, just ordinary text. Simpler to
 * persist than a permanent emoji "chip" node would be.
 */
export const EmojiPicker = Node.create({
  name: "emojiPicker",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { query: { default: "" } };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="emoji-picker"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-type": "emoji-picker" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmojiPickerView);
  },
});
