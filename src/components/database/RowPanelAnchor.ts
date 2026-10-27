import { Extension, type Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

interface RowPanelStorage {
  container: HTMLElement | null;
}

const key = new PluginKey("rowPanelAnchor");

/**
 * Places a DOM element between the title (first block) and the body of the
 * page — the slot of a row's property panel. The title and the body are one
 * ProseMirror document, so the panel can't live outside the editor; a widget
 * decoration puts it in the flow without it being part of the document (it is
 * never saved, can't be deleted, and the cursor skips it). React renders into
 * the element through a portal (see PageEditor).
 */
export const RowPanelAnchor = Extension.create({
  name: "rowPanelAnchor",
  addStorage(): RowPanelStorage {
    return { container: null };
  },
  addProseMirrorPlugins() {
    const storage = this.storage as RowPanelStorage;
    return [
      new Plugin({
        key,
        props: {
          decorations(state) {
            const title = state.doc.firstChild;
            if (!storage.container || !title) return DecorationSet.empty;
            return DecorationSet.create(state.doc, [
              Decoration.widget(title.nodeSize, storage.container, {
                key: "row-panel",
                side: -1,
                ignoreSelection: true,
                // The inputs inside are React's, not ProseMirror's: don't let the editor swallow their events.
                stopEvent: () => true,
              }),
            ]);
          },
        },
      }),
    ];
  },
});

/** Shows the panel host in the editor (or hides it with `null`). */
export function setRowPanelContainer(editor: Editor, container: HTMLElement | null) {
  (editor.storage as unknown as { rowPanelAnchor: RowPanelStorage }).rowPanelAnchor.container =
    container;
  // An empty transaction makes ProseMirror re-evaluate the decorations.
  editor.view.dispatch(editor.state.tr.setMeta(key, true));
}
