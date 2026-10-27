import { useCallback, useEffect, useRef, useState } from "react";
import {
  EditorContent,
  NodeViewWrapper,
  useEditor,
  type JSONContent,
  type NodeViewProps,
} from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";
import { Placeholder } from "@tiptap/extensions";
import { Copy, RefreshCw } from "lucide-react";
import { contentExtensions } from "./editor-extensions";
import { ItemDrop } from "./ItemDrop";
import { MediaDrop } from "./MediaDrop";
import { SlashCommand } from "./slash-commands/SlashCommand";
import { TableControls } from "./TableControls";
import { getSyncedBlock, saveSyncedBlock } from "../../lib/db-client";
import { broadcastSynced, subscribeSynced } from "../../lib/synced-bus";

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };
const SAVE_DEBOUNCE_MS = 600;

// Same blocks as the page editor (minus syncedBlock itself — see editor-extensions.ts).
const syncedExtensions = [
  ...contentExtensions,
  MediaDrop,
  ItemDrop,
  SlashCommand,
  Placeholder.configure({
    placeholder: "Contenido sincronizado — escribe «/» para ver los bloques",
  }),
];

export function SyncedBlockView({ node, editor, getPos, deleteNode }: NodeViewProps) {
  const syncId = node.attrs.syncId as string;
  const [token] = useState(() => Symbol("synced-instance"));
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  const pending = useRef<JSONContent | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(syncId);

  useEffect(() => {
    idRef.current = syncId;
  }, [syncId]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const doc = pending.current;
    pending.current = null;
    if (!doc) return;
    saveSyncedBlock(idRef.current, doc)
      .then(() => setError(null))
      .catch((err) => {
        console.error("Failed to save synced block", err);
        setError(String(err));
      });
  }, []);

  const sub = useEditor({
    extensions: syncedExtensions,
    content: EMPTY_DOC,
    onUpdate: ({ editor: e }) => {
      // Ignore the programmatic setContent that loads/refreshes the block.
      if (!loaded.current) return;
      const doc = e.getJSON();
      pending.current = doc;
      broadcastSynced(idRef.current, token, doc);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
  });

  // Same bridge as the host page (page id, notify, child-page creation) so
  // the media/"Página" commands work inside the block.
  /* eslint-disable react-hooks/immutability -- Tiptap's pattern for sharing extension storage between editors. */
  useEffect(() => {
    if (sub) sub.storage.editorBridge = editor.storage.editorBridge;
  }, [sub, editor]);
  /* eslint-enable react-hooks/immutability */

  useEffect(() => {
    if (!sub) return;
    let cancelled = false;
    loaded.current = false;
    getSyncedBlock(syncId)
      .then((doc) => {
        if (cancelled) return;
        sub.commands.setContent(doc ?? EMPTY_DOC, { emitUpdate: false });
        // Ctrl+Z must not undo the load itself (it would empty every copy of this block).
        sub.view.updateState(
          EditorState.create({ doc: sub.state.doc, plugins: sub.state.plugins }),
        );
        loaded.current = true;
      })
      .catch((err) => {
        // Never edit on top of a failed load: the first save would overwrite the real content.
        console.error("Failed to load synced block", err);
        if (!cancelled) {
          setError(String(err));
          sub.setEditable(false);
        }
      });
    const off = subscribeSynced(syncId, token, (doc) =>
      sub.commands.setContent(doc, { emitUpdate: false }),
    );
    return () => {
      cancelled = true;
      off();
      flush();
    };
  }, [sub, syncId, token, flush]);

  const duplicate = () => {
    const pos = getPos();
    if (pos == null) return;
    editor
      .chain()
      .insertContentAt(pos + node.nodeSize, { type: "syncedBlock", attrs: { syncId } })
      .run();
  };

  // Drops this reference only; the content stays for the other instances.
  const remove = () => {
    deleteNode();
    editor.commands.focus();
  };

  return (
    <NodeViewWrapper className="synced-block" contentEditable={false}>
      <div className="synced-block-header">
        <span>
          <RefreshCw size={12} strokeWidth={1.75} aria-hidden="true" /> Sincronizado
        </span>
        <span className="synced-block-actions">
          <button type="button" onClick={duplicate} title="Insertar otra copia sincronizada debajo">
            <Copy size={12} strokeWidth={1.75} aria-hidden="true" /> Duplicar
          </button>
          <button
            type="button"
            onClick={remove}
            title="Quitar esta copia (el contenido sigue en las demás)"
          >
            Quitar
          </button>
        </span>
      </div>
      {error && (
        <p className="synced-block-error" role="alert">
          {error}
        </p>
      )}
      <EditorContent editor={sub} className="synced-block-content" />
      <TableControls editor={sub} />
    </NodeViewWrapper>
  );
}
