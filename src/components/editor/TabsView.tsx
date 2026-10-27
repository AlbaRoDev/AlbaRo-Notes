import { useEffect, useState, type KeyboardEvent } from "react";
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from "@tiptap/react";
import { Selection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { MAX_TABS, MAX_TAB_TITLE } from "./Tabs";

/** Start position of the `index`-th tab of the `tabs` node at `pos`. */
function tabStart(tabs: PMNode, pos: number, index: number) {
  let start = pos + 1;
  for (let i = 0; i < index; i++) start += tabs.child(i).nodeSize;
  return start;
}

const isEmptyTab = (tab: PMNode) =>
  tab.childCount === 1 &&
  tab.firstChild?.type.name === "paragraph" &&
  tab.firstChild.content.size === 0;

export function TabsView({ node, editor, getPos }: NodeViewProps) {
  const count = node.childCount;
  const active = Math.min(node.attrs.active as number, count - 1);

  const [renaming, setRenaming] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);

  // A pasted node can carry an out-of-range `active`; Rust would refuse to save the page.
  useEffect(() => {
    const pos = getPos();
    if (pos != null && node.attrs.active !== active) {
      editor.view.dispatch(editor.view.state.tr.setNodeAttribute(pos, "active", active));
    }
  }, [editor, getPos, node.attrs.active, active]);

  /** Caret to the start of tab `index`, and focus to the document — a click on a tab button leaves focus on the button. */
  const focusTab = (index: number) => {
    const pos = getPos();
    if (pos == null) return;
    const { state, view } = editor;
    const tabs = state.doc.nodeAt(pos);
    if (!tabs) return;
    const start = tabStart(tabs, pos, Math.min(index, tabs.childCount - 1));
    view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(start + 1), 1)));
    view.focus();
  };

  const select = (index: number) => {
    const pos = getPos();
    if (pos == null || index === active) return;
    const { state, view } = editor;
    const tr = state.tr.setNodeAttribute(pos, "active", index);
    tr.setSelection(Selection.near(tr.doc.resolve(tabStart(node, pos, index) + 1), 1));
    view.dispatch(tr);
    view.focus();
    setConfirming(false);
  };

  const addTab = () => {
    const pos = getPos();
    if (pos == null || count >= MAX_TABS) return;
    const { state, view } = editor;
    const { tab, paragraph } = state.schema.nodes;
    const at = pos + node.nodeSize - 1;
    const tr = state.tr.insert(
      at,
      tab.create({ title: `Pestaña ${count + 1}` }, paragraph.create()),
    );
    tr.setNodeAttribute(pos, "active", count);
    tr.setSelection(Selection.near(tr.doc.resolve(at + 1), 1));
    view.dispatch(tr);
    view.focus();
  };

  const removeActive = (confirmed: boolean) => {
    const pos = getPos();
    if (pos == null || count <= 1) return;
    if (!confirmed && !isEmptyTab(node.child(active))) {
      setConfirming(true);
      return;
    }
    const { state, view } = editor;
    const from = tabStart(node, pos, active);
    const next = Math.max(0, active - 1);
    const tr = state.tr.delete(from, from + node.child(active).nodeSize);
    tr.setNodeAttribute(pos, "active", next);
    const tabs = tr.doc.nodeAt(pos);
    if (tabs) tr.setSelection(Selection.near(tr.doc.resolve(tabStart(tabs, pos, next) + 1), 1));
    view.dispatch(tr);
    view.focus();
    setConfirming(false);
  };

  const startRename = (index: number) => {
    setDraft(node.child(index).attrs.title);
    setRenaming(index);
  };

  // Title is edited locally; only Enter / blur write it to the node.
  const commitRename = () => {
    const pos = getPos();
    if (renaming == null || pos == null) return;
    const next = draft.trim().slice(0, MAX_TAB_TITLE);
    const tab = node.maybeChild(renaming);
    if (tab && next && next !== tab.attrs.title) {
      editor.view.dispatch(
        editor.view.state.tr.setNodeAttribute(tabStart(node, pos, renaming), "title", next),
      );
    }
    setRenaming(null);
  };

  const onRenameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" && e.key !== "Escape") return;
    e.preventDefault();
    const index = renaming;
    if (e.key === "Enter") commitRename();
    else setRenaming(null);
    if (index != null) focusTab(index);
  };

  const titles: string[] = [];
  for (let i = 0; i < count; i++) titles.push(node.child(i).attrs.title);

  return (
    <NodeViewWrapper className="tabs-block" data-active={active}>
      <div className="tabs-bar" contentEditable={false} role="tablist">
        {titles.map((title, i) =>
          renaming === i ? (
            <input
              key={i}
              autoFocus
              className="tabs-rename"
              maxLength={MAX_TAB_TITLE}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={onRenameKey}
              aria-label="Nombre de la pestaña"
            />
          ) : (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === active}
              className="tabs-tab"
              data-active={i === active}
              title="Doble clic para renombrar"
              onClick={() => select(i)}
              onDoubleClick={() => startRename(i)}
            >
              {title}
            </button>
          ),
        )}
        <button
          type="button"
          className="tabs-add"
          onClick={addTab}
          disabled={count >= MAX_TABS}
          aria-label="Añadir pestaña"
        >
          +
        </button>
        {count > 1 &&
          (confirming ? (
            <span className="tabs-confirm">
              ¿Borrar «{titles[active]}» con su contenido?
              <button type="button" onClick={() => removeActive(true)}>
                Sí
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                No
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="tabs-remove"
              onClick={() => removeActive(false)}
              aria-label="Borrar pestaña activa"
            >
              ×
            </button>
          ))}
      </div>
      <NodeViewContent className="tabs-content" />
    </NodeViewWrapper>
  );
}
