import { useEffect, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Editor, JSONContent } from "@tiptap/core";
import {
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  Loader2,
  PenLine,
  RotateCcw,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { aiWrite, type WriteMessage } from "../../lib/ai-client";
import { blocksToMarkdown, isOnlyText, markdownToBlocks } from "../../lib/markdown-blocks";
import { CODE_LANGUAGES, PLAIN_TEXT } from "../editor/code-languages";
import { closeAiAssist, getAiAssist, type AiAssistState } from "../editor/AiAssist";
import { buildPrompt, matchingActions, type AiAction, type AiContext } from "./ai-actions";
import "./AiInline.css";

// Groups shown as one row with a submenu while nothing is typed, as in Notion's menu.
const SUBMENUS = ["Cambiar el tono", "Traducir", "Traducir la página"];
const KNOWN_LANGUAGES = new Set(CODE_LANGUAGES.map((l) => l.value));

/** Models sometimes wrap the whole answer in ```markdown … ```: unwrap it. */
function cleanModelText(text: string): string {
  const m = text.trim().match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n?```$/i);
  return m ? m[1] : text;
}

/** Blocks for the editor: code languages it doesn't know become plain text. */
function toBlocks(text: string): JSONContent[] {
  const fix = (n: JSONContent): JSONContent => ({
    ...n,
    ...(n.type === "codeBlock" && !KNOWN_LANGUAGES.has(String(n.attrs?.language))
      ? { attrs: { ...n.attrs, language: PLAIN_TEXT } }
      : {}),
    ...(n.content ? { content: n.content.map(fix) } : {}),
  });
  return markdownToBlocks(cleanModelText(text)).map(fix);
}

// ---------------------------------------------------------------- preview (safe: React text only)

function Inline({ nodes }: { nodes?: JSONContent[] }) {
  return (
    <>
      {(nodes ?? []).map((n, i) => {
        if (n.type === "hardBreak") return <br key={i} />;
        let out: ReactNode = n.text ?? "";
        for (const mark of n.marks ?? []) {
          if (mark.type === "bold") out = <strong>{out}</strong>;
          else if (mark.type === "italic") out = <em>{out}</em>;
          else if (mark.type === "code") out = <code>{out}</code>;
          else if (mark.type === "strike") out = <s>{out}</s>;
          else if (mark.type === "link") out = <span className="ai-link">{out}</span>;
        }
        return <span key={i}>{out}</span>;
      })}
    </>
  );
}

function Blocks({ nodes }: { nodes?: JSONContent[] }) {
  return (
    <>
      {(nodes ?? []).map((n, i) => {
        const kids = <Blocks nodes={n.content} />;
        switch (n.type) {
          case "paragraph":
            return (
              <p key={i}>
                <Inline nodes={n.content} />
              </p>
            );
          case "heading": {
            const H = `h${Math.min(Number(n.attrs?.level ?? 1), 3) + 1}` as "h2" | "h3" | "h4";
            return (
              <H key={i}>
                <Inline nodes={n.content} />
              </H>
            );
          }
          case "bulletList":
            return <ul key={i}>{kids}</ul>;
          case "orderedList":
            return (
              <ol key={i} start={Number(n.attrs?.start ?? 1)}>
                {kids}
              </ol>
            );
          case "taskList":
            return (
              <ul key={i} className="ai-tasks">
                {kids}
              </ul>
            );
          case "listItem":
            return <li key={i}>{kids}</li>;
          case "taskItem":
            return (
              <li key={i}>
                <input type="checkbox" checked={!!n.attrs?.checked} readOnly tabIndex={-1} />
                <div>{kids}</div>
              </li>
            );
          case "blockquote":
            return <blockquote key={i}>{kids}</blockquote>;
          case "codeBlock":
            return (
              <pre key={i}>
                <code>
                  <Inline nodes={n.content} />
                </code>
              </pre>
            );
          case "horizontalRule":
            return <hr key={i} />;
          case "table":
            return (
              <table key={i}>
                <tbody>{kids}</tbody>
              </table>
            );
          case "tableRow":
            return <tr key={i}>{kids}</tr>;
          case "tableHeader":
            return <th key={i}>{kids}</th>;
          case "tableCell":
            return <td key={i}>{kids}</td>;
          default:
            return null;
        }
      })}
    </>
  );
}

// ---------------------------------------------------------------- the box

type Phase = "menu" | "writing" | "done" | "error";
type Row =
  { kind: "action"; action: AiAction } | { kind: "submenu"; group: string } | { kind: "custom" };

/** What the AI works on, read from the editor when an action runs. */
function readContext(editor: Editor, ai: AiAssistState): AiContext & { nodes: JSONContent[] } {
  const { doc } = editor.state;
  const all = (doc.toJSON().content ?? []) as JSONContent[];
  const [titleNode, ...body] = all;
  const title =
    titleNode?.type === "heading" ? blocksToMarkdown([titleNode]).replace(/^#+\s*/, "") : "";
  const nodes =
    ai.mode === "selection"
      ? ((doc.slice(ai.from, ai.to).content.toJSON() ?? []) as JSONContent[])
      : [];
  // the blocks before the cursor's block, for «Continuar escribiendo»
  let index = 0;
  doc.forEach((_node, offset, i) => {
    if (offset <= ai.from) index = i;
  });
  return {
    title: title || "Sin título",
    selection: ai.mode === "selection" ? blocksToMarkdown(nodes) : null,
    page: blocksToMarkdown(body),
    before: blocksToMarkdown(all.slice(1, Math.max(index, 1))),
    nodes,
  };
}

function AiInlineBox({ editor, ai }: { editor: Editor; ai: AiAssistState }) {
  const hasSelection = ai.mode === "selection";
  const [phase, setPhase] = useState<Phase>("menu");
  const [query, setQuery] = useState("");
  const [submenu, setSubmenu] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState("");
  const [primary, setPrimary] = useState<"replace" | "insert">(hasSelection ? "replace" : "insert");
  // the conversation of the last generation (to retry it or ask for a change)
  const sent = useRef<WriteMessage[]>([]);
  const cancelRef = useRef<(() => void) | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const followRef = useRef<HTMLInputElement>(null);

  // Replacing would lose what isn't plain text (an image, a mention…) or touch the page title.
  const [canReplace] = useState(() => {
    if (!hasSelection) return false;
    const titleEnd = editor.state.doc.firstChild?.nodeSize ?? 0;
    return ai.from >= titleEnd && isOnlyText(readContext(editor, ai).nodes);
  });

  // ---- menu rows
  const matches = matchingActions(hasSelection, query);
  const rows: { group: string; rows: Row[] }[] = [];
  const push = (group: string, row: Row) => {
    const last = rows[rows.length - 1];
    if (last?.group === group) last.rows.push(row);
    else rows.push({ group, rows: [row] });
  };
  for (const action of matches) {
    if (submenu ? action.group !== submenu : !query && SUBMENUS.includes(action.group)) {
      if (
        !submenu &&
        !rows.some((g) => g.rows.some((r) => r.kind === "submenu" && r.group === action.group))
      ) {
        push("Más", { kind: "submenu", group: action.group });
      }
      continue;
    }
    push(submenu ?? action.group, { kind: "action", action });
  }
  if (query.trim() && !submenu) push("", { kind: "custom" });
  const flat = rows.flatMap((g) => g.rows);
  const selected = Math.min(active, flat.length - 1);

  useEffect(() => {
    boxRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected, submenu]);

  const close = (refocus = true) => {
    cancelRef.current?.();
    closeAiAssist(editor);
    if (refocus)
      editor
        .chain()
        .focus()
        .setTextSelection(hasSelection ? ai.to : ai.from)
        .run();
  };

  const generate = (messages: WriteMessage[]) => {
    sent.current = messages;
    setPhase("writing");
    setText("");
    setError(null);
    setFollowUp("");
    const handle = aiWrite(messages, setText);
    cancelRef.current = handle.cancel;
    handle.done
      .then((full) => {
        cancelRef.current = null;
        setText(full);
        if (full.trim()) setPhase("done");
        else {
          setError("La IA no ha escrito nada. Prueba a pedirlo de otra forma.");
          setPhase("error");
        }
      })
      .catch((e) => {
        cancelRef.current = null;
        setError(String(e));
        setPhase("error");
      });
  };

  const runAction = (action: AiAction) => {
    if (action.fill) {
      setQuery(action.fill);
      setSubmenu(null);
      inputRef.current?.focus();
      return;
    }
    setPrimary(action.primary === "replace" && canReplace ? "replace" : "insert");
    generate([
      {
        role: "user",
        content: buildPrompt(action.instruction!, readContext(editor, ai), action.id),
      },
    ]);
  };

  const runCustom = () => {
    const instruction = query.trim();
    if (!instruction) return;
    setPrimary(canReplace ? "replace" : "insert");
    generate([{ role: "user", content: buildPrompt(instruction, readContext(editor, ai)) }]);
  };

  const choose = (row: Row) => {
    if (row.kind === "submenu") {
      setSubmenu(row.group);
      setActive(0);
    } else if (row.kind === "custom") runCustom();
    else runAction(row.action);
  };

  const refine = () => {
    const change = followUp.trim();
    if (!change) return;
    generate([
      ...sent.current,
      { role: "assistant", content: text },
      { role: "user", content: change },
    ]);
  };

  const apply = (how: "replace" | "insert") => {
    const blocks = toBlocks(text);
    if (!blocks.length) return;
    const state = getAiAssist(editor.state); // mapped through any edit made meanwhile
    const { doc } = editor.state;
    if (how === "replace" && state.mode === "selection") {
      // one paragraph replacing part of a line stays in that line
      const single = blocks.length === 1 && blocks[0].type === "paragraph";
      editor
        .chain()
        .focus()
        .insertContentAt(
          { from: state.from, to: state.to },
          single ? (blocks[0].content ?? []) : blocks,
        )
        .run();
    } else {
      const $pos = doc.resolve(state.mode === "selection" ? state.to : state.from);
      let target: number | { from: number; to: number } = $pos.pos;
      if ($pos.depth >= 1) {
        const start = $pos.before(1);
        const end = $pos.after(1);
        const block = doc.nodeAt(start);
        const emptyLine =
          state.mode === "cursor" && block?.type.name === "paragraph" && block.content.size === 0;
        target = emptyLine ? { from: start, to: end } : end; // write on the empty line, or below the block
      }
      editor.chain().focus().insertContentAt(target, blocks).run();
    }
    closeAiAssist(editor);
  };

  // ---- keyboard
  const onMenuKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length)
        setActive(
          (i) =>
            (Math.min(i, flat.length - 1) + (e.key === "ArrowDown" ? 1 : flat.length - 1)) %
            flat.length,
        );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[selected]) choose(flat[selected]);
      else runCustom();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (submenu) setSubmenu(null);
      else close();
    } else if (e.key === "Backspace" && !query && submenu) {
      setSubmenu(null);
    }
  };

  const onDoneKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (followUp.trim()) refine();
      else apply(primary);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  useEffect(() => {
    if (phase === "menu") inputRef.current?.focus();
    if (phase === "done") followRef.current?.focus();
  }, [phase]);

  // Esc stops the writing; a click outside closes the menu (but never throws away a result).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && phase === "writing") {
        e.preventDefault();
        cancelRef.current?.();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (phase === "menu" && !boxRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  });

  // ---- position: under the text it works on, as wide as the page column
  const dom = editor.view.dom.getBoundingClientRect();
  let anchor: { top: number; bottom: number };
  try {
    const end = editor.view.coordsAtPos(
      Math.min(hasSelection ? ai.to : ai.from, editor.state.doc.content.size),
    );
    const start = editor.view.coordsAtPos(Math.min(ai.from, editor.state.doc.content.size));
    anchor = { top: start.top, bottom: end.bottom };
  } catch {
    anchor = { top: dom.top, bottom: dom.top };
  }
  const width = Math.min(Math.max(dom.width, 460), window.innerWidth - 32);
  const left = Math.max(16, Math.min(dom.left, window.innerWidth - width - 16));
  const below = window.innerHeight - anchor.bottom - 12;
  const up = below < 300 && anchor.top > below;
  const style = up
    ? { left, width, bottom: window.innerHeight - anchor.top + 6, maxHeight: anchor.top - 16 }
    : { left, width, top: anchor.bottom + 6, maxHeight: below };

  const blocks = text ? toBlocks(text) : [];
  let index = -1;

  return createPortal(
    <div
      ref={boxRef}
      className="ai-inline"
      style={style}
      role="dialog"
      aria-label="Escribir con IA"
    >
      {(phase === "writing" || phase === "done") && (
        <div className="ai-inline-result" aria-live="polite">
          <Blocks nodes={blocks} />
          {phase === "writing" && <span className="ai-inline-caret" aria-hidden="true" />}
        </div>
      )}
      {phase === "error" && (
        <p className="ai-inline-error" role="alert">
          {error}
        </p>
      )}

      {phase === "menu" && (
        <div className="ai-inline-prompt">
          <Sparkles size={16} className="ai-inline-spark" aria-hidden="true" />
          {submenu && (
            <button
              type="button"
              className="ai-inline-chip"
              onClick={() => setSubmenu(null)}
              title="Volver"
            >
              <ChevronLeft size={14} />
              {submenu}
            </button>
          )}
          <input
            ref={inputRef}
            value={query}
            maxLength={2000}
            placeholder={
              hasSelection ? "Pide a la IA que edite o genere…" : "Pide a la IA que escriba…"
            }
            aria-label="Instrucción para la IA"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onMenuKey}
          />
          <button
            type="button"
            className="ai-inline-send"
            aria-label="Enviar"
            disabled={!query.trim()}
            onClick={runCustom}
          >
            <CornerDownLeft size={14} />
          </button>
        </div>
      )}

      {phase === "writing" && (
        <div className="ai-inline-status">
          <Loader2 size={15} className="ai-spin" aria-hidden="true" />
          <span>La IA está escribiendo…</span>
          <button type="button" onClick={() => cancelRef.current?.()}>
            <Square size={12} /> Detener <kbd>Esc</kbd>
          </button>
        </div>
      )}

      {(phase === "done" || phase === "error") && (
        <>
          {phase === "done" && (
            <div className="ai-inline-prompt">
              <Sparkles size={16} className="ai-inline-spark" aria-hidden="true" />
              <input
                ref={followRef}
                value={followUp}
                maxLength={2000}
                placeholder="Pide un cambio… (o Intro para aceptar)"
                aria-label="Pedir un cambio a la IA"
                onChange={(e) => setFollowUp(e.target.value)}
                onKeyDown={onDoneKey}
              />
            </div>
          )}
          <div className="ai-inline-menu" role="menu">
            {phase === "done" && (
              <>
                {canReplace && (
                  <button
                    type="button"
                    role="menuitem"
                    data-primary={primary === "replace"}
                    onClick={() => apply("replace")}
                  >
                    <PenLine size={15} /> Reemplazar la selección
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  data-primary={primary === "insert"}
                  onClick={() => apply("insert")}
                >
                  <CornerDownLeft size={15} /> {hasSelection ? "Insertar debajo" : "Insertar"}
                </button>
              </>
            )}
            <button type="button" role="menuitem" onClick={() => generate(sent.current)}>
              <RotateCcw size={15} /> Intentar de nuevo
            </button>
            <button type="button" role="menuitem" onClick={() => close()}>
              <X size={15} /> Descartar
            </button>
          </div>
          {hasSelection && !canReplace && phase === "done" && (
            <p className="ai-inline-note">
              La selección tiene algo más que texto (una imagen, una mención, el título…), así que
              el resultado va debajo para no perderlo.
            </p>
          )}
        </>
      )}

      {phase === "menu" && flat.length > 0 && (
        <div className="ai-inline-menu" role="listbox" aria-label="Acciones de IA">
          {rows.map((group) => (
            <div key={group.group || "custom"} role="group" aria-label={group.group}>
              {group.group && <div className="ai-inline-group">{group.group}</div>}
              {group.rows.map((row) => {
                const i = ++index;
                const common = {
                  role: "option",
                  "aria-selected": i === selected,
                  onMouseMove: () => i !== active && setActive(i),
                  onMouseDown: (e: React.MouseEvent) => e.preventDefault(), // keep the focus in the box
                  onClick: () => choose(row),
                };
                if (row.kind === "custom")
                  return (
                    <button key="custom" type="button" {...common}>
                      <PenLine size={15} />{" "}
                      <span className="ai-inline-label">«{query.trim()}»</span>
                    </button>
                  );
                if (row.kind === "submenu")
                  return (
                    <button key={row.group} type="button" {...common}>
                      <span className="ai-inline-label">{row.group}</span>
                      <ChevronRight size={15} className="ai-inline-chevron" />
                    </button>
                  );
                const Icon = row.action.icon;
                return (
                  <button key={row.action.id} type="button" {...common}>
                    <Icon size={15} /> <span className="ai-inline-label">{row.action.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

/** The in-page AI (Notion AI) for one editor: shown while `AiAssist` is open, a fresh box each time. */
export function AiInline({ editor }: { editor: Editor }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(false);

  useEffect(() => {
    editor.on("transaction", rerender);
    // keep the box under its text while the page scrolls or the window changes size
    window.addEventListener("scroll", rerender, true);
    window.addEventListener("resize", rerender);
    return () => {
      editor.off("transaction", rerender);
      window.removeEventListener("scroll", rerender, true);
      window.removeEventListener("resize", rerender);
    };
  }, [editor]);

  const ai = getAiAssist(editor.state);
  if (ai.open !== wasOpen) {
    // derived during render (React's advice for state that follows a change): a fresh box per opening
    setWasOpen(ai.open);
    if (ai.open) setSession((n) => n + 1);
  }
  if (!ai.open) return null;
  return <AiInlineBox key={session} editor={editor} ai={ai} />;
}
