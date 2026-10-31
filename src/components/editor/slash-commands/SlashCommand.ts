import { Extension } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import { SlashMenu } from "./SlashMenu";
import { suggestionRender } from "./suggestion-render";
import { filterSlashCommandItems, type SlashCommandItem } from "./items";

/**
 * Opens a floating "/" command menu for inserting block types. Coexists with
 * the native Markdown input rules (`# `, `- `, `[] `) — this is an additional
 * way in, not a replacement.
 */
export const SlashCommand = Extension.create({
  name: "slashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem, SlashCommandItem>({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        // `requires` hides items whose node the editor doesn't have (e.g. no nested synced block).
        items: ({ editor, query }) =>
          filterSlashCommandItems(query).filter(
            (item) => !item.requires || editor.schema.nodes[item.requires],
          ),
        command: ({ editor, range, props }) => {
          props.run(editor, range);
        },
        render: suggestionRender(SlashMenu),
      }),
    ];
  },
});
