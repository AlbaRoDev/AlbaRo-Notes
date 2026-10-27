import { Table } from "@tiptap/extension-table";

// Mirrored in Rust (validate.rs): a bigger table would make the page unsavable.
export const MAX_TABLE_ROWS = 200;
export const MAX_TABLE_COLS = 30;

/**
 * The stock table, with its one unbounded path closed: Tab in the last cell
 * appends a row, which would otherwise walk past the limit Rust enforces on
 * save. The toolbar buttons (TableControls) disable themselves at the limits.
 */
export const LimitedTable = Table.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Tab: ({ editor }) => {
        if (editor.commands.goToNextCell()) return true;
        if (!editor.can().addRowAfter()) return false;
        const { $from } = editor.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === "table" && $from.node(d).childCount >= MAX_TABLE_ROWS)
            return true;
        }
        return editor.chain().addRowAfter().goToNextCell().run();
      },
    };
  },
});
