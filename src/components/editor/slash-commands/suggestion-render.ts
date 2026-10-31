import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
import type { ForwardRefExoticComponent, RefAttributes } from "react";

export interface SuggestionMenuHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface MenuProps<I> {
  items: I[];
  command: (item: I) => void;
}

/** The floating list of a Suggestion plugin (the «/» menu, the «@» one): mounts a React menu at the cursor and hands it the keys. */
export function suggestionRender<I>(
  Menu: ForwardRefExoticComponent<MenuProps<I> & RefAttributes<SuggestionMenuHandle>>,
): SuggestionOptions<I, I>["render"] {
  return () => {
    let component: ReactRenderer<SuggestionMenuHandle, MenuProps<I>> | null = null;
    let unmount: (() => void) | null = null;

    return {
      onStart: (props) => {
        component = new ReactRenderer(Menu, { props, editor: props.editor });
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
  };
}
