import { Extension, type Editor, type JSONContent } from "@tiptap/react";
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import { errorMessage, mediaKindOf, storeAttachment } from "../../lib/attachments";
import { insertBlockWithLineAfter } from "./media-commands";

const NODE_BY_KIND = { image: "image", video: "video", audio: "audio", file: "fileBlock" } as const;

async function insertFiles(editor: Editor, files: File[], at: number | null) {
  let pos = at;
  for (const file of files) {
    try {
      const info = await storeAttachment(file);
      const node: JSONContent = {
        type: NODE_BY_KIND[mediaKindOf(file.type)],
        attrs: { file: info.file, name: file.name || "archivo", size: info.size },
      };
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          // Drop point (if any) becomes the cursor; the block then goes below the line it landed on.
          if (pos != null)
            tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))));
          return true;
        })
        .command(insertBlockWithLineAfter(node))
        .run();
      pos = null; // later files go below the previous one, where the caret was left
    } catch (e) {
      editor.storage.editorBridge.notify(`«${file.name}»: ${errorMessage(e)}`);
    }
  }
}

/** Drag-and-drop and paste of files from outside the app (images from the clipboard included). */
export const MediaDrop = Extension.create({
  name: "mediaDrop",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("mediaDrop"),
        props: {
          handleDrop(view, event) {
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (files.length === 0) return false;
            event.preventDefault();
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
            void insertFiles(editor, files, at);
            return true;
          },
          handlePaste(_view, event) {
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.length === 0) return false;
            event.preventDefault();
            void insertFiles(editor, files, null);
            return true;
          },
        },
      }),
    ];
  },
});
