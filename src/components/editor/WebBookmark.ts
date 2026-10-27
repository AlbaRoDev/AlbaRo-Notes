import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { asAttachmentName, asHttpUrl } from "../../lib/attachments";
import { WebBookmarkView } from "./WebBookmarkView";

/**
 * "Miniatura web": a link card. `url: null` is the "still picking" state.
 * The preview fields are fetched once (by Rust) when the URL is confirmed and
 * then stored here, so the card renders offline forever after; a node with a
 * url but no title is the "no preview" fallback — a plain link.
 */
export const WebBookmark = Node.create({
  name: "webBookmark",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    const text = (key: string, data: string) => ({
      default: null,
      parseHTML: (el: HTMLElement) => el.getAttribute(data),
      renderHTML: (attrs: Record<string, unknown>) =>
        attrs[key] ? { [data]: String(attrs[key]) } : {},
    });
    return {
      url: {
        default: null,
        parseHTML: (el) => asHttpUrl(el.getAttribute("data-url")),
        renderHTML: (attrs) => (attrs.url ? { "data-url": attrs.url } : {}),
      },
      title: text("title", "data-title"),
      description: text("description", "data-description"),
      siteName: text("siteName", "data-site-name"),
      image: {
        default: null,
        parseHTML: (el) => asAttachmentName(el.getAttribute("data-image")),
        renderHTML: (attrs) => (attrs.image ? { "data-image": attrs.image } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="web-bookmark"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-type": "web-bookmark" }, HTMLAttributes)];
  },
  addNodeView() {
    return ReactNodeViewRenderer(WebBookmarkView);
  },
});
