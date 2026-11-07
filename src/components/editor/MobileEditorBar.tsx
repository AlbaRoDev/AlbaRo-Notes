import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  GripVertical,
  IndentDecrease,
  IndentIncrease,
  Link2,
  Palette,
  Plus,
  Redo2,
  Sparkles,
  Undo2,
} from "lucide-react";
import { openAiAssist } from "./AiAssist";
import { addBlockBelow, blockAt, isTitle, moveBlock } from "./block-commands";
import { BlockMenu, type BlockMenuTarget } from "./BlockMenu";
import { useBackLayer } from "../../hooks/useBackLayer.ts";
import { ColorPanel, LinkPanel } from "./SelectionToolbar";
import { MARKS } from "./text-marks";
import "./MobileEditorBar.css";
import { t } from "../../lib/i18n.ts";

const LIST_ITEMS = ["taskItem", "listItem"];
const indent = (editor: Editor, dir: 1 | -1) =>
  LIST_ITEMS.some(
    (name) =>
      editor.schema.nodes[name] &&
      (dir > 0
        ? editor.chain().focus().sinkListItem(name).run()
        : editor.chain().focus().liftListItem(name).run()),
  );

/**
 * What the keyboard shortcuts and the hover handles give on a desktop, for a finger: a bar that sits on top of the
 * on-screen keyboard (the window shrinks for it) with undo, the block's options, indent and the text formats.
 * Only drawn under touch (`pointer: coarse`, see the CSS), where it replaces the toolbar over the selection:
 * the system's own selection menu would sit right there.
 */
export function MobileEditorBar({ editor }: { editor: Editor }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [panel, setPanel] = useState<"link" | "color" | null>(null);
  const [menu, setMenu] = useState<BlockMenuTarget | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const rowRef = useRef<HTMLDivElement>(null);
  const closePanel = useCallback(() => setPanel(null), []);
  useBackLayer(panel !== null, closePanel);

  useEffect(() => {
    editor.on("selectionUpdate", closePanel);
    editor.on("selectionUpdate", rerender);
    editor.on("transaction", rerender);
    editor.on("focus", rerender);
    editor.on("blur", rerender);
    return () => {
      editor.off("selectionUpdate", closePanel);
      editor.off("selectionUpdate", rerender);
      editor.off("transaction", rerender);
      editor.off("focus", rerender);
      editor.off("blur", rerender);
    };
  }, [editor, closePanel]);

  if (!editor.isFocused && !panel && !menu) return null;

  const block = blockAt(editor.state);
  const inBody = !!block && !isTitle(editor.state, block.pos);
  const selecting = !editor.state.selection.empty;
  // `onMouseDown` keeps the focus (and so the keyboard) in the page while a button is pressed
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const button = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    opts: { pressed?: boolean; disabled?: boolean } = {},
  ) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={opts.pressed}
      disabled={opts.disabled}
      onMouseDown={keep}
      onClick={onClick}
    >
      {icon}
    </button>
  );
  const sep = <span className="mobile-bar-sep" aria-hidden="true" />;

  return createPortal(
    <div className="mobile-bar" role="toolbar" aria-label={t("Formato del texto")}>
      {panel === "link" && <LinkPanel editor={editor} onDone={() => setPanel(null)} />}
      {panel === "color" && <ColorPanel editor={editor} />}
      {menu && <BlockMenu editor={editor} target={menu} onClose={closeMenu} />}
      <div className="mobile-bar-row" ref={rowRef}>
        {button(t("Ocultar el teclado"), <ChevronDown size={18} />, () => editor.commands.blur())}
        {button(t("Deshacer"), <Undo2 size={18} />, () => editor.chain().focus().undo().run(), {
          disabled: !editor.can().undo(),
        })}
        {button(t("Rehacer"), <Redo2 size={18} />, () => editor.chain().focus().redo().run(), {
          disabled: !editor.can().redo(),
        })}
        {sep}
        {button(
          t("Añadir un bloque debajo"),
          <Plus size={18} />,
          () => block && addBlockBelow(editor, block.pos, block.node),
          { disabled: !inBody },
        )}
        {button(
          t("Opciones del bloque"),
          <GripVertical size={18} />,
          () => {
            if (!block) return;
            const r = rowRef.current!.getBoundingClientRect();
            setMenu({
              node: block.node,
              pos: block.pos,
              x: 8,
              bottom: window.innerHeight - r.top + 4,
            });
          },
          { disabled: !inBody, pressed: !!menu },
        )}
        {button(t("Subir el bloque"), <ArrowUp size={18} />, () => moveBlock(editor, -1), {
          disabled: !inBody,
        })}
        {button(t("Bajar el bloque"), <ArrowDown size={18} />, () => moveBlock(editor, 1), {
          disabled: !inBody,
        })}
        {sep}
        {button(t("Quitar sangría"), <IndentDecrease size={18} />, () => indent(editor, -1))}
        {button(t("Sangría"), <IndentIncrease size={18} />, () => indent(editor, 1))}
        {sep}
        {MARKS.map(({ mark, label, Icon, run }) =>
          button(label, <Icon size={18} />, () => run(editor), { pressed: editor.isActive(mark) }),
        )}
        {sep}
        {button(
          t("Enlace"),
          <Link2 size={18} />,
          () => setPanel(panel === "link" ? null : "link"),
          { pressed: editor.isActive("link") || panel === "link", disabled: !selecting },
        )}
        {button(
          t("Color"),
          <Palette size={18} />,
          () => setPanel(panel === "color" ? null : "color"),
          {
            pressed:
              editor.isActive("textColor") ||
              editor.isActive("backgroundColor") ||
              panel === "color",
            disabled: !selecting,
          },
        )}
        {button(t("Preguntar a la IA"), <Sparkles size={18} />, () => openAiAssist(editor))}
      </div>
    </div>,
    document.body,
  );
}
