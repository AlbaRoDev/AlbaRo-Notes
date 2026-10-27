import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { readDragItem } from "../../lib/drag-item";

/** A page or task dragged from the sidebar or the Gestor's list lands in the text as a mention of it. */
export const ItemDrop = Extension.create({
  name: "itemDrop",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("itemDrop"),
        props: {
          handleDrop(view, event) {
            const item = readDragItem(event);
            if (!item) return false;
            event.preventDefault();
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            const node = { type: "pageMention", attrs: { pageId: item.id } };
            const chain = editor.chain().focus();
            (at === undefined ? chain.insertContent(node) : chain.insertContentAt(at, node)).run();
            return true;
          },
        },
      }),
    ];
  },
});
