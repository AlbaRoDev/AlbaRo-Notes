import { Mark } from "@tiptap/core";

/** Notion's colour names, shared with the tag colours of the databases (App.css has both the text and the background figure). */
export const MARK_COLORS = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;
type MarkColor = (typeof MARK_COLORS)[number];

const isColor = (value: string | null): value is MarkColor =>
  MARK_COLORS.includes(value as MarkColor);

/**
 * A mark that holds one of the colour names, not a colour value: the figure comes from App.css, so the same
 * text is readable in light and dark and in every season. A pasted colour that is not one of the names is dropped.
 */
function colorMark(name: string, attribute: string) {
  return Mark.create({
    name,
    addAttributes() {
      return {
        color: {
          default: null,
          parseHTML: (element) => {
            const value = element.getAttribute(attribute);
            return isColor(value) ? value : null;
          },
          renderHTML: (attributes) =>
            isColor(attributes.color) ? { [attribute]: attributes.color } : {},
        },
      };
    },
    parseHTML() {
      return [
        {
          tag: `span[${attribute}]`,
          getAttrs: (el) => (isColor(el.getAttribute(attribute)) ? null : false),
        },
      ];
    },
    renderHTML({ HTMLAttributes }) {
      return ["span", HTMLAttributes, 0];
    },
  });
}

/** Coloured text (the mark is `textColor`, with `color`). */
export const TextColor = colorMark("textColor", "data-text-color");
/** A coloured background behind the text, like a highlighter (`backgroundColor`). */
export const BackgroundColor = colorMark("backgroundColor", "data-bg-color");
