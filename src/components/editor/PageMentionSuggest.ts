import { Extension } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { PageMentionMenu } from "./PageMentionMenu";
import { suggestionRender } from "./slash-commands/suggestion-render";
import { getKnownPages, searchPages } from "../../lib/page-links";
import type { PageSummary } from "../../types";

/** `@` or `[[` (at the start or after a space) opens the list of pages to mention; typing narrows it. */
export const PageMentionSuggest = Extension.create({
  name: "pageMentionSuggest",
  // Over the keys of the blocks it can sit in (Enter in a toggle's title would otherwise open the toggle, not pick a page).
  priority: 1000,

  addProseMirrorPlugins() {
    return ["@", "[["].map((char) =>
      Suggestion<PageSummary, PageSummary>({
        pluginKey: new PluginKey(`pageMention${char}`),
        editor: this.editor,
        char,
        items: ({ query }) => searchPages(getKnownPages(), query),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: "pageMention", attrs: { pageId: props.id } },
              { type: "text", text: " " },
            ])
            .run();
        },
        render: suggestionRender(PageMentionMenu),
      }),
    );
  },
});
