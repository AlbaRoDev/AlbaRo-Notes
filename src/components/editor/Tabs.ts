import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin } from "@tiptap/pm/state";
import { TabsView } from "./TabsView";

export const MAX_TABS = 8;
export const MAX_TAB_TITLE = 60;

/**
 * Pestañas: a `tabs` container of 1–8 `tab` children, each with its own block
 * content (like `column`). Only the active tab is visible (CSS, by index); the
 * rest stay in the document so their content is never lost by switching.
 * `active` lives on the node so the open tab survives a restart.
 */
export const Tabs = Node.create({
  name: "tabs",
  group: "block",
  content: `tab{1,${MAX_TABS}}`,
  defining: true,
  addAttributes() {
    return { active: { default: 0 } };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-type="tabs"]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const n = Number(el.getAttribute("data-active"));
          return { active: Number.isInteger(n) && n >= 0 && n < MAX_TABS ? n : 0 };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "tabs",
        "data-active": String(node.attrs.active),
      }),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TabsView);
  },
  addProseMirrorPlugins() {
    return [
      // A caret that lands in a hidden tab (arrow keys, search, TOC click)
      // would be invisible and typing would go nowhere: reveal that tab.
      new Plugin({
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((t) => t.selectionSet || t.docChanged)) return null;
          const { $head } = state.selection;
          let tr = state.tr;
          let changed = false;
          for (let d = $head.depth; d >= 2; d--) {
            if ($head.node(d).type.name !== "tab") continue;
            const tabs = $head.node(d - 1);
            const index = $head.index(d - 1);
            if (tabs.type.name === "tabs" && tabs.attrs.active !== index) {
              tr = tr.setNodeAttribute($head.before(d - 1), "active", index);
              changed = true;
            }
          }
          return changed ? tr : null;
        },
      }),
    ];
  },
});

export const Tab = Node.create({
  name: "tab",
  content: "block+",
  isolating: true,
  addAttributes() {
    return { title: { default: "Pestaña" } };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-type="tab"]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          return { title: (el.getAttribute("data-title") || "Pestaña").slice(0, MAX_TAB_TITLE) };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "tab", "data-title": node.attrs.title }),
      0,
    ];
  },
});
