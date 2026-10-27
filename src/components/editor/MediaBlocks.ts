import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { asAttachmentName } from "../../lib/attachments";
import { MediaView } from "./MediaView";

/**
 * Image, Video, Audio and Archivo are the same data (a file copied into the
 * app's attachments folder + its display name and size) rendered four ways,
 * so one factory builds all four. `file: null` is the "still picking" state
 * (upload or URL), the same convention as PageLink's `pageId: null`.
 *
 * `file` is re-validated when parsed from pasted HTML — Rust rejects any
 * malformed reference on save, and one bad paste must not make the page
 * permanently unsaveable.
 */
function createMediaNode(name: string) {
  return Node.create({
    name,
    group: "block",
    atom: true,
    draggable: true,
    addAttributes() {
      return {
        file: {
          default: null,
          parseHTML: (el) => asAttachmentName(el.getAttribute("data-file")),
          renderHTML: (attrs) => (attrs.file ? { "data-file": attrs.file } : {}),
        },
        name: {
          default: null,
          parseHTML: (el) => el.getAttribute("data-name"),
          renderHTML: (attrs) => (attrs.name ? { "data-name": attrs.name } : {}),
        },
        size: {
          default: null,
          parseHTML: (el) => {
            const n = Number(el.getAttribute("data-size"));
            return Number.isFinite(n) && n >= 0 ? n : null;
          },
          renderHTML: (attrs) => (attrs.size != null ? { "data-size": String(attrs.size) } : {}),
        },
      };
    },
    parseHTML() {
      return [{ tag: `div[data-type="${name}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes({ "data-type": name }, HTMLAttributes)];
    },
    addNodeView() {
      return ReactNodeViewRenderer(MediaView);
    },
  });
}

export const ImageBlock = createMediaNode("image");
export const VideoBlock = createMediaNode("video");
export const AudioBlock = createMediaNode("audio");
export const FileBlock = createMediaNode("fileBlock");
