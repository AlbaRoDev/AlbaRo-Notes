import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { CodeBlockView } from "./CodeBlockView";
import { loadLanguage, lowlight, PLAIN_TEXT } from "./code-languages";

/** Languages already asked for (or not offered at all): each is fetched once. */
const settled = new Set<string>();

/**
 * Grammars are loaded on demand (see code-languages.ts), so a block can appear
 * before its language is registered. This fetches what the document needs and,
 * once it is there, rewrites those blocks with their own attributes: that is
 * the transaction the highlighting plugin needs to compute the colors again.
 * Not an edit — kept out of the undo history and of the `update` event, so it
 * neither undoes into nothing nor makes a page that was only opened look edited.
 */
function highlightLoadedLanguages(view: EditorView) {
  const wanted = new Set<string>();
  view.state.doc.descendants((node) => {
    if (node.type.name !== "codeBlock") return true;
    const language = node.attrs.language as string | null;
    if (language && !settled.has(language) && !lowlight.registered(language)) wanted.add(language);
    return false;
  });
  for (const language of wanted) {
    settled.add(language);
    loadLanguage(language).then(
      () => {
        if (view.isDestroyed) return;
        const { state } = view;
        const tr = state.tr;
        state.doc.descendants((node, pos) => {
          if (node.type.name !== "codeBlock") return true;
          if (node.attrs.language === language) tr.setNodeMarkup(pos, undefined, node.attrs);
          return false;
        });
        if (tr.docChanged)
          view.dispatch(tr.setMeta("addToHistory", false).setMeta("preventUpdate", true));
      },
      // the block stays uncolored; forgetting the name retries it on the next edit
      () => settled.delete(language),
    );
  }
}

/**
 * Replaces StarterKit's plain `codeBlock` (disabled in PageEditor) — same node
 * name, same `language` attr, so saved documents and the existing "/" item and
 * ``` input rule keep working. Adds syntax highlighting and, via the NodeView,
 * a language selector and copy button.
 */
export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        view: (view) => {
          highlightLoadedLanguages(view);
          return {
            update: (updated, previous) => {
              if (updated.state.doc !== previous.doc) highlightLoadedLanguages(updated);
            },
          };
        },
      }),
    ];
  },
}).configure({ lowlight, defaultLanguage: PLAIN_TEXT });
