import { useState, type KeyboardEvent } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Selection } from "@tiptap/pm/state";
import { Settings } from "lucide-react";
import { useEditorAppContext } from "./editor-app-context";
import { focusLineAfterNode } from "./media-commands";
import {
  BUTTON_BLOCKS,
  MAX_BUTTON_LABEL,
  isButtonBlockKind,
  type ButtonAction,
} from "./button-actions";

export function ButtonBlockView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const { pages, currentPageId, onNavigate } = useEditorAppContext();
  const { label, action, pageId, block } = node.attrs as {
    label: string;
    action: ButtonAction | null;
    pageId: string | null;
    block: string | null;
  };
  // A fresh button (no label, no action) opens straight into its settings.
  const [editing, setEditing] = useState(!label && !action);
  // Label is edited locally and committed on Enter/blur — never per keystroke.
  const [draft, setDraft] = useState(label);

  const targetExists = action !== "openPage" || pages.some((p) => p.id === pageId);

  const run = () => {
    if (action === "openPage" && pageId) {
      if (targetExists) onNavigate(pageId);
      else editor.storage.editorBridge.notify("La página a la que apunta este botón ya no existe");
    } else if (action === "insertBlock" && isButtonBlockKind(block)) {
      const pos = getPos();
      if (pos == null) return;
      const at = pos + node.nodeSize;
      // The click left focus on the button: put the caret in what was inserted.
      editor
        .chain()
        .insertContentAt(at, BUTTON_BLOCKS[block].node)
        .command(({ tr }) => {
          tr.setSelection(Selection.near(tr.doc.resolve(at), 1));
          return true;
        })
        .focus()
        .run();
    } else {
      setEditing(true);
    }
  };

  const commitLabel = () => {
    const next = draft.trim().slice(0, MAX_BUTTON_LABEL);
    if (next !== label) updateAttributes({ label: next });
    setDraft(next);
  };

  // An action is only ever written together with its target, so a saved node
  // is always one Rust accepts (it rejects "openPage" without a page).
  const setAction = (value: string) => {
    if (value === "openPage") {
      updateAttributes({ action: "openPage", pageId: pageId ?? currentPageId, block: null });
    } else if (value === "insertBlock") {
      updateAttributes({ action: "insertBlock", pageId: null, block: block ?? "paragraph" });
    } else {
      updateAttributes({ action: null, pageId: null, block: null });
    }
  };

  const done = () => {
    commitLabel();
    setEditing(false);
    focusLineAfterNode(editor, getPos());
  };

  const onLabelKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      done();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(label);
      setEditing(false);
      focusLineAfterNode(editor, getPos());
    }
  };

  return (
    <NodeViewWrapper className="button-block" contentEditable={false}>
      <div className="button-block-row">
        <button
          type="button"
          className="button-block-run"
          onClick={run}
          data-missing={!targetExists}
        >
          {label || "Botón"}
          {!targetExists && <small> (página eliminada)</small>}
        </button>
        <button
          type="button"
          className="button-block-gear"
          aria-label="Configurar botón"
          onClick={() => (editing ? done() : setEditing(true))}
        >
          <Settings size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      {editing && (
        <div className="button-block-settings">
          <label>
            Texto
            <input
              autoFocus
              type="text"
              maxLength={MAX_BUTTON_LABEL}
              value={draft}
              placeholder="Texto del botón"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={onLabelKey}
            />
          </label>
          <label>
            Acción
            <select value={action ?? ""} onChange={(e) => setAction(e.target.value)}>
              <option value="">Ninguna</option>
              <option value="openPage">Abrir una página</option>
              <option value="insertBlock">Insertar un bloque debajo</option>
            </select>
          </label>
          {action === "openPage" && (
            <label>
              Página
              <select
                value={pageId ?? ""}
                onChange={(e) => updateAttributes({ pageId: e.target.value })}
              >
                {!targetExists && <option value={pageId ?? ""}>Página eliminada</option>}
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {action === "insertBlock" && (
            <label>
              Bloque
              <select
                value={block ?? "paragraph"}
                onChange={(e) => updateAttributes({ block: e.target.value })}
              >
                {Object.entries(BUTTON_BLOCKS).map(([key, { label: text }]) => (
                  <option key={key} value={key}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="button-block-done" onClick={done}>
            Listo
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}
