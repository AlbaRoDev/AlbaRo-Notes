import { Extension, InputRule, markInputRule, textInputRule } from "@tiptap/core";
import { lastColors } from "./ColorMarks";
import { blockSelection } from "./BlockSelect";
import {
  duplicateBlock,
  moveBlock,
  toggleFromBlock,
  turnInto,
  type TurnKind,
} from "./block-commands";

/** Asks the selection toolbar to open its link box (Ctrl+K with text selected). */
export const OPEN_LINK_EVENT = "albaro-open-link";

/** Ctrl+Shift+0…8 turn the current block into these, as in Notion (9 makes a sub-page). */
const TURN_KEYS: Record<string, TurnKind> = {
  "0": "paragraph",
  "1": "h1",
  "2": "h2",
  "3": "h3",
  "4": "task",
  "5": "bullet",
  "6": "ordered",
  "7": "toggle",
  "8": "code",
};

/** `$latex$` and `$$latex$$` (no space just inside the dollars, so prices like «$5 and $6» are left alone). */
const LATEX_BODY = String.raw`([^$\s](?:[^$]*[^$\s])?)`;

/**
 * Notion's keyboard shortcuts and typing rules that the editor's defaults lack: turn the block into something
 * (Ctrl+Shift+0…9), duplicate it (Ctrl+D), move it (Ctrl+Shift+↑/↓), tick a to-do or open a toggle (Ctrl+Enter),
 * highlight (Ctrl+Shift+H), inline equation (Ctrl+Shift+E); and typing `> ` (a toggle), `" ` (a quote), `~text~`,
 * `$latex$` and `->`. High priority: the defaults give some of these keys other jobs (Ctrl+Shift+7 was «numbered list»).
 */
export const NotionShortcuts = Extension.create({
  name: "notionShortcuts",
  priority: 1000,

  addKeyboardShortcuts() {
    const turn = (kind: TurnKind) => () => turnInto(this.editor, kind);
    const shortcuts: Record<string, () => boolean> = {
      "Mod-d": () => duplicateBlock(this.editor, blockSelection(this.editor.state)),
      "Mod-Shift-ArrowUp": () => moveBlock(this.editor, -1),
      "Mod-Shift-ArrowDown": () => moveBlock(this.editor, 1),

      "Mod-Shift-h": () => {
        const chain = this.editor.chain().focus();
        return this.editor.isActive("backgroundColor")
          ? chain.unsetMark("backgroundColor").run()
          : chain.setMark("backgroundColor", { color: lastColors.backgroundColor }).run();
      },

      "Mod-Shift-e": () => {
        const { from, to, empty } = this.editor.state.selection;
        const latex = empty ? "" : this.editor.state.doc.textBetween(from, to, " ").slice(0, 10000);
        return this.editor
          .chain()
          .focus()
          .insertContentAt({ from, to }, { type: "equationInline", attrs: { latex } })
          .run();
      },

      // To-do: tick it. Toggle: open or close it. Anything else keeps its default (a soft line break).
      "Mod-Enter": () => {
        const { $from } = this.editor.state.selection;
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth);
          const name = node.type.name;
          if (name !== "taskItem" && name !== "toggle") continue;
          const attr = name === "taskItem" ? "checked" : "open";
          const tr = this.editor.state.tr.setNodeMarkup($from.before(depth), undefined, {
            ...node.attrs,
            [attr]: !node.attrs[attr],
          });
          this.editor.view.dispatch(tr);
          return true;
        }
        return false;
      },

      // A new sub-page right here: it takes the empty line, or goes under the current block.
      "Mod-Shift-9": () => {
        const bridge = this.editor.storage.editorBridge;
        if (!bridge?.createChildPage) return false;
        const { $from } = this.editor.state.selection;
        const empty = $from.parent.type.name === "paragraph" && $from.parent.content.size === 0;
        const at = empty ? { from: $from.before(), to: $from.after() } : $from.after();
        void bridge.createChildPage().then((page: { id: string }) => {
          this.editor
            .chain()
            .insertContentAt(at, { type: "pageLink", attrs: { pageId: page.id } })
            .run();
        });
        return true;
      },
    };
    for (const [digit, kind] of Object.entries(TURN_KEYS))
      shortcuts[`Mod-Shift-${digit}`] = turn(kind);
    return shortcuts;
  },

  addInputRules() {
    const { strike } = this.editor.schema.marks;
    const rules: InputRule[] = [
      // Notion: `> ` starts a toggle and `" ` a quote (the Markdown quote is not what `>` means there).
      new InputRule({
        find: /^>\s$/,
        handler: ({ chain, range }) => {
          chain().deleteRange(range).command(toggleFromBlock).run();
        },
      }),
      new InputRule({
        find: /^"\s$/,
        handler: ({ chain, range }) => {
          chain().deleteRange(range).toggleBlockquote().run();
        },
      }),
      // `$$x$$` and `$x$` become an inline equation holding x.
      ...[String.raw`\$\$${LATEX_BODY}\$\$`, String.raw`\$${LATEX_BODY}\$`].map(
        (body) =>
          new InputRule({
            find: new RegExp(String.raw`(?:^|\s)${body}$`),
            handler: ({ chain, range, match }) => {
              // the typed closing `$` is not in the document yet, and the match may begin with a space
              const start = range.from + match[0].length - match[0].trimStart().length;
              chain()
                .insertContentAt(
                  { from: start, to: range.to },
                  { type: "equationInline", attrs: { latex: match[1] } },
                )
                .run();
            },
          }),
      ),
      // `@` or `[[` (at the start or after a space) asks which page to mention; `:` and two letters, which emoji.
      new InputRule({
        find: /(?:^|\s)(@|\[\[)$/,
        handler: ({ chain, range, match }) => {
          const from = range.from + match[0].length - match[0].trimStart().length;
          chain()
            .insertContentAt(
              { from, to: range.to },
              { type: "pageMention", attrs: { pageId: null } },
            )
            .run();
        },
      }),
      new InputRule({
        find: /(?:^|\s):([\p{L}]{2,})$/u,
        handler: ({ chain, range, match }) => {
          const from = range.from + match[0].length - match[0].trimStart().length;
          chain()
            .insertContentAt(
              { from, to: range.to },
              { type: "emojiPicker", attrs: { query: match[1] } },
            )
            .run();
        },
      }),
      textInputRule({ find: /->$/, replace: "→" }),
      textInputRule({ find: /<-$/, replace: "←" }),
      textInputRule({ find: /=>$/, replace: "⇒" }),
    ];
    // Notion strikes with a single tilde; the default rule wants two.
    if (strike)
      rules.push(markInputRule({ find: /(?:^|\s)(~(?!\s+~)([^~]+)~(?!\s+~))$/, type: strike }));
    return rules;
  },
});
