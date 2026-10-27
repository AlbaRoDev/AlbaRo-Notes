import { useEffect, useReducer, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  Bold,
  Code,
  Italic,
  Link2,
  Palette,
  Sparkles,
  Strikethrough,
  Underline,
} from "lucide-react";
import { MARK_COLORS } from "./ColorMarks";
import { getAiAssist, openAiAssist } from "./AiAssist";
import "./SelectionToolbar.css";

const MARKS = [
  {
    mark: "bold",
    label: "Negrita",
    hint: "Ctrl+B",
    Icon: Bold,
    run: (e: Editor) => e.chain().focus().toggleBold().run(),
  },
  {
    mark: "italic",
    label: "Cursiva",
    hint: "Ctrl+I",
    Icon: Italic,
    run: (e: Editor) => e.chain().focus().toggleItalic().run(),
  },
  {
    mark: "underline",
    label: "Subrayado",
    hint: "Ctrl+U",
    Icon: Underline,
    run: (e: Editor) => e.chain().focus().toggleUnderline().run(),
  },
  {
    mark: "strike",
    label: "Tachado",
    hint: "Ctrl+Shift+S",
    Icon: Strikethrough,
    run: (e: Editor) => e.chain().focus().toggleStrike().run(),
  },
  {
    mark: "code",
    label: "Código",
    hint: "Ctrl+E",
    Icon: Code,
    run: (e: Editor) => e.chain().focus().toggleCode().run(),
  },
];

/** The address typed for a link, made into one the Link mark accepts (http, https or mailto; no scheme = https), or null. */
function linkAddress(raw: string): string | null {
  const typed = raw.trim();
  if (!typed || /\s/.test(typed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(typed)
    ? typed
    : /^[^@/]+@[^@/]+$/.test(typed)
      ? `mailto:${typed}`
      : `https://${typed}`;
  try {
    const { protocol } = new URL(withScheme);
    return ["http:", "https:", "mailto:"].includes(protocol) ? withScheme : null;
  } catch {
    return null;
  }
}

/** The link's address box, under the toolbar: Enter applies, empty or «Quitar» removes. */
function LinkPanel({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const [error, setError] = useState(false);
  const current = (editor.getAttributes("link").href as string | undefined) ?? "";
  const apply = (raw: string) => {
    if (!raw.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return onDone();
    }
    const href = linkAddress(raw);
    if (!href) return setError(true);
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    onDone();
  };
  return (
    <div className="selection-popover" role="group" aria-label="Enlace">
      <input
        autoFocus
        type="text"
        defaultValue={current}
        placeholder="Pega o escribe un enlace…"
        aria-label="Dirección del enlace"
        aria-invalid={error || undefined}
        onChange={() => setError(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            editor.commands.focus();
            onDone();
          }
        }}
      />
      {error && <p role="alert">Solo enlaces http, https o de correo.</p>}
      {current && (
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => apply("")}>
          Quitar el enlace
        </button>
      )}
    </div>
  );
}

const COLOR_LABELS: Record<string, string> = {
  gray: "Gris",
  brown: "Marrón",
  orange: "Naranja",
  yellow: "Amarillo",
  green: "Verde",
  blue: "Azul",
  purple: "Morado",
  pink: "Rosa",
  red: "Rojo",
};

/** Text colour and background, as Notion's «Color» menu: the names, never a value (App.css has the figures). */
function ColorPanel({ editor }: { editor: Editor }) {
  const row = (mark: "textColor" | "backgroundColor", title: string) => (
    <div className="selection-colors" role="group" aria-label={title}>
      <span>{title}</span>
      <div>
        {MARK_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className="selection-swatch"
            data-kind={mark}
            data-color={color}
            aria-label={`${title}: ${COLOR_LABELS[color]}`}
            title={COLOR_LABELS[color]}
            aria-pressed={editor.isActive(mark, { color })}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().setMark(mark, { color }).run()}
          >
            {mark === "textColor" ? "A" : ""}
          </button>
        ))}
        <button
          type="button"
          className="selection-swatch selection-swatch-none"
          aria-label={`${title}: ninguno`}
          title="Quitar"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().unsetMark(mark).run()}
        >
          ×
        </button>
      </div>
    </div>
  );
  return (
    <div className="selection-popover" role="group" aria-label="Color">
      {row("textColor", "Color del texto")}
      {row("backgroundColor", "Fondo")}
    </div>
  );
}

/**
 * Notion's selection toolbar: select text and «Preguntar a la IA» and the formatting buttons appear
 * above it. Hidden while the mouse is still selecting, and while the AI box is open.
 */
export function SelectionToolbar({ editor }: { editor: Editor }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [dragging, setDragging] = useState(false);
  const [panel, setPanel] = useState<"link" | "color" | null>(null);

  useEffect(() => {
    const dom = editor.view.dom;
    const down = () => setDragging(true);
    const up = () => setDragging(false);
    const closePanel = () => setPanel(null);
    editor.on("selectionUpdate", closePanel);
    editor.on("selectionUpdate", rerender);
    editor.on("transaction", rerender);
    editor.on("focus", rerender);
    editor.on("blur", rerender);
    dom.addEventListener("mousedown", down);
    document.addEventListener("mouseup", up);
    window.addEventListener("scroll", rerender, true);
    return () => {
      editor.off("selectionUpdate", closePanel);
      editor.off("selectionUpdate", rerender);
      editor.off("transaction", rerender);
      editor.off("focus", rerender);
      editor.off("blur", rerender);
      dom.removeEventListener("mousedown", down);
      document.removeEventListener("mouseup", up);
      window.removeEventListener("scroll", rerender, true);
    };
  }, [editor]);

  const { selection } = editor.state;
  const show =
    (editor.isFocused || panel !== null) &&
    !dragging &&
    selection instanceof TextSelection &&
    !selection.empty &&
    editor.state.doc.textBetween(selection.from, selection.to).trim() !== "" &&
    !getAiAssist(editor.state).open;
  if (!show) return null;

  let coords: { left: number; top: number; bottom: number };
  try {
    coords = editor.view.coordsAtPos(selection.from);
  } catch {
    return null;
  }
  const above = coords.top - 46;
  const style = {
    left: Math.max(8, Math.min(coords.left - 8, window.innerWidth - 330)),
    top: above > 8 ? above : coords.bottom + 8,
  };

  return createPortal(
    <div className="selection-toolbar" style={style} role="toolbar" aria-label="Formato del texto">
      <button
        type="button"
        className="selection-toolbar-ai"
        title="Preguntar a la IA (Ctrl+J)"
        onMouseDown={(e) => e.preventDefault()} // keep the selection
        onClick={() => openAiAssist(editor)}
      >
        <Sparkles size={15} /> Preguntar a la IA
      </button>
      <span className="selection-toolbar-sep" aria-hidden="true" />
      {MARKS.map(({ mark, label, hint, Icon, run }) => (
        <button
          key={mark}
          type="button"
          aria-label={label}
          aria-pressed={editor.isActive(mark)}
          title={`${label} (${hint})`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run(editor)}
        >
          <Icon size={15} />
        </button>
      ))}
      <span className="selection-toolbar-sep" aria-hidden="true" />
      <button
        type="button"
        aria-label="Enlace"
        aria-pressed={editor.isActive("link") || panel === "link"}
        title="Enlace"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setPanel(panel === "link" ? null : "link")}
      >
        <Link2 size={15} />
      </button>
      <button
        type="button"
        aria-label="Color"
        aria-pressed={
          editor.isActive("textColor") || editor.isActive("backgroundColor") || panel === "color"
        }
        title="Color del texto y fondo"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setPanel(panel === "color" ? null : "color")}
      >
        <Palette size={15} />
      </button>
      {panel === "link" && <LinkPanel editor={editor} onDone={() => setPanel(null)} />}
      {panel === "color" && <ColorPanel editor={editor} />}
    </div>,
    document.body,
  );
}
