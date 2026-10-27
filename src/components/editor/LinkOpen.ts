import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { openUrl } from "@tauri-apps/plugin-opener";
import { asHttpUrl } from "../../lib/attachments";

/**
 * A plain click on a link edits the text as usual (the link is a mark, and the formatting bar edits its address);
 * Ctrl/⌘ + click opens it in the browser, and only an http(s) address does: the webview itself never navigates.
 */
export const LinkOpen = Extension.create({
  name: "linkOpen",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleClick(_view, _pos, event) {
            const anchor = (event.target as HTMLElement | null)?.closest("a");
            if (!anchor) return false;
            // the Link mark never lets the webview follow it
            event.preventDefault();
            if (!(event.ctrlKey || event.metaKey)) return false;
            const safe = asHttpUrl(anchor.getAttribute("href"));
            if (safe) void openUrl(safe).catch((err) => console.error("Failed to open URL", err));
            return true;
          },
        },
      }),
    ];
  },
});
