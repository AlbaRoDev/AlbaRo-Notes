import { Node, mergeAttributes } from "@tiptap/react";
import { Selection } from "@tiptap/pm/state";

/**
 * Toggle list / toggle heading. `headingLevel` (null | 1) distinguishes
 * "Lista desplegable" from "Encabezado desplegable" — same node, different
 * default attrs and CSS, to avoid duplicating an near-identical schema for a
 * heading-styled variant.
 *
 * Native <details>/<summary> looked like the free, native-platform way to
 * get collapse/expand — but browsers suppress a <summary>'s default click
 * action when it sits inside a contentEditable region (same reason a link
 * inside contentEditable doesn't navigate on click): clicking it just places
 * a text cursor, so collapsing never actually fires. Hence the manual
 * NodeView below: a `contenteditable="false"` marker button with its own
 * click handler, and `data-open` driving visibility in CSS instead of the
 * `open` DOM attribute.
 */
export const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "toggleSummary toggleContent",
  defining: true,
  addAttributes() {
    return {
      open: { default: true },
      headingLevel: { default: null },
    };
  },
  parseHTML() {
    return [
      // the editor wraps what follows the <summary> in a toggleContent itself (the schema requires one)
      { tag: "details", getAttrs: () => ({ open: true, headingLevel: null }) },
      {
        tag: 'div[data-type="toggle"]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const level = el.getAttribute("data-heading-level");
          return {
            open: el.getAttribute("data-open") !== "false",
            headingLevel: level ? Number(level) : null,
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes, node }) {
    const attrs: Record<string, string> = {
      "data-type": "toggle",
      "data-open": node.attrs.open ? "true" : "false",
    };
    if (node.attrs.headingLevel) attrs["data-heading-level"] = String(node.attrs.headingLevel);
    return ["div", mergeAttributes(HTMLAttributes, attrs), 0];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      const marker = document.createElement("button");
      marker.type = "button";
      marker.contentEditable = "false";
      marker.className = "toggle-marker";
      marker.setAttribute("aria-label", "Mostrar/ocultar");
      const body = document.createElement("div");
      body.className = "toggle-body";
      dom.append(marker, body);

      const applyAttrs = (attrs: typeof node.attrs) => {
        dom.dataset.type = "toggle";
        dom.dataset.open = attrs.open ? "true" : "false";
        if (attrs.headingLevel) dom.dataset.headingLevel = String(attrs.headingLevel);
        else delete dom.dataset.headingLevel;
      };
      applyAttrs(node.attrs);

      marker.addEventListener("click", () => {
        const pos = getPos();
        if (pos == null) return;
        const current = editor.state.doc.nodeAt(pos);
        if (!current) return;
        editor.view.dispatch(
          editor.view.state.tr.setNodeAttribute(pos, "open", !current.attrs.open),
        );
      });

      return {
        dom,
        contentDOM: body,
        update(updatedNode) {
          if (updatedNode.type.name !== "toggle") return false;
          applyAttrs(updatedNode.attrs);
          return true;
        },
      };
    };
  },
});

export const ToggleSummary = Node.create({
  name: "toggleSummary",
  content: "inline*",
  parseHTML() {
    return [{ tag: 'div[data-type="toggle-summary"]' }, { tag: "summary" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "toggle-summary" }), 0];
  },
  addKeyboardShortcuts() {
    return {
      // Default splitBlock can't add a second toggleSummary (the schema
      // allows exactly one), so ProseMirror's fallback instead moves the
      // summary's own text into toggleContent — losing the title. Enter
      // here should just move the cursor into the content area untouched.
      Enter: () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        if ($from.parent.type.name !== "toggleSummary") return false;
        const summaryDepth = $from.depth;
        const contentPos = $from.before(summaryDepth) + $from.node(summaryDepth).nodeSize;
        const target = Selection.near(state.doc.resolve(contentPos), 1);
        return this.editor.commands.setTextSelection(target.from);
      },
    };
  },
});

export const ToggleContent = Node.create({
  name: "toggleContent",
  content: "block+",
  parseHTML() {
    return [{ tag: 'div[data-type="toggle-content"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "toggle-content" }), 0];
  },
});
