import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
import { menuRoom } from "./menu-room.ts";
import type { ForwardRefExoticComponent, RefAttributes } from "react";

type FloatingMiddleware = NonNullable<
  NonNullable<SuggestionOptions["floatingUi"]>["middleware"]
>[number];

/**
 * Tells the list how much room it has (`--menu-room`, read by its CSS) on the side it ended up: a phone in landscape
 * with its keyboard up has a few lines of window, and the menu, anchored on the cursor, would be cut off.
 * It sits after `flip`, so it measures the side that was chosen, and asks for the position again if the room changed.
 */
export const fitInWindow: FloatingMiddleware = {
  name: "fitInWindow",
  fn({ elements, placement }) {
    const cursor = elements.reference.getBoundingClientRect();
    const bar = document.querySelector<HTMLElement>(".mobile-bar")?.offsetHeight ?? 0;
    const value = `${menuRoom(placement, cursor, window.innerHeight, bar)}px`;
    const floating = elements.floating as HTMLElement;
    if (floating.style.getPropertyValue("--menu-room") === value) return {};
    floating.style.setProperty("--menu-room", value);
    return { reset: { rects: true } };
  },
};

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
