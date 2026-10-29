import { Extension, ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import { SlashMenu, type SlashMenuHandle } from "./SlashMenu";
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
        render: () => {
          let component: ReactRenderer<SlashMenuHandle> | null = null;
          let unmount: (() => void) | null = null;

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashMenu, { props, editor: props.editor });
              // The popup mounts in <body>, outside any stacking context: without a z-index it
              // sits under the task peek (a fixed layer) and the menu looked empty there.
              (component.element as HTMLElement).style.zIndex = "1300";
              unmount = props.mount(component.element as HTMLElement);
            },
            onUpdate: (props) => {
              component?.updateProps(props);
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") {
                unmount?.();
                unmount = null;
                return true;
              }
              return component?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              unmount?.();
              component?.destroy();
            },
          };
        },
      }),
    ];
  },
});
