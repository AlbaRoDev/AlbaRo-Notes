import { Node } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";

/**
 * The editor of a database page only edits its title: the table
 * below it is drawn by the app, not stored as a block, so it can't be deleted
 * or duplicated from the page. The schema itself allows a lone heading —
 * Enter in the title does nothing — and Rust re-checks it on save.
 */
const TitleOnlyDoc = Node.create({ name: "doc", topNode: true, content: "heading" });

export const databasePageExtensions = [
  StarterKit.configure({
    document: false,
    heading: { levels: [1] },
    trailingNode: false,
    codeBlock: false,
  }),
  TitleOnlyDoc,
  Placeholder.configure({ placeholder: "Base de datos sin título" }),
];
