import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { CanvasBlockView } from "./CanvasBlockView";
import { DEFAULT_HEIGHT, cleanHeight, sanitizeStrokes } from "./canvas-strokes";

/**
 * «Lienzo»: one canvas to draw, sketch or take handwritten notes on, like the ink of an
 * iPad notes app. The strokes live in the node itself as JSON, so the ink is always editable and
 * deleting the block takes its data with it. It can be converted when the user wants — to text
 * (read by the AI's vision model) or to an image block — and the ink is kept unless they replace it.
 */
export const CanvasBlock = Node.create({
  name: "canvasBlock",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      height: {
        default: DEFAULT_HEIGHT,
        parseHTML: (el: HTMLElement) => {
          const raw = el.getAttribute("data-height");
          return raw === null ? DEFAULT_HEIGHT : cleanHeight(Number(raw));
        },
        renderHTML: (attrs: Record<string, unknown>) => ({
          "data-height": String(cleanHeight(attrs.height)),
        }),
      },
      strokes: {
        default: [],
        // pasted HTML / old documents: keep what is valid, since Rust refuses a page with a bad stroke
        parseHTML: (el: HTMLElement) => {
          try {
            return sanitizeStrokes(JSON.parse(el.getAttribute("data-strokes") ?? "[]"));
          } catch {
            return [];
          }
        },
        renderHTML: (attrs: Record<string, unknown>) => ({
          "data-strokes": JSON.stringify(attrs.strokes ?? []),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="canvas-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "canvas-block" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CanvasBlockView);
  },
});
