import type { Editor } from "@tiptap/core";
import { Bold, Code, Italic, Strikethrough, Underline } from "lucide-react";
import { t } from "../../lib/i18n.ts";

/** The text formats of the toolbar over the selection and of the bar over the keyboard. */
export const MARKS = [
  {
    mark: "bold",
    label: t("Negrita"),
    hint: t("Ctrl+B"),
    Icon: Bold,
    run: (e: Editor) => e.chain().focus().toggleBold().run(),
  },
  {
    mark: "italic",
    label: t("Cursiva"),
    hint: t("Ctrl+I"),
    Icon: Italic,
    run: (e: Editor) => e.chain().focus().toggleItalic().run(),
  },
  {
    mark: "underline",
    label: t("Subrayado"),
    hint: t("Ctrl+U"),
    Icon: Underline,
    run: (e: Editor) => e.chain().focus().toggleUnderline().run(),
  },
  {
    mark: "strike",
    label: t("Tachado"),
    hint: t("Ctrl+Shift+S"),
    Icon: Strikethrough,
    run: (e: Editor) => e.chain().focus().toggleStrike().run(),
  },
  {
    mark: "code",
    label: t("Código"),
    hint: t("Ctrl+E"),
    Icon: Code,
    run: (e: Editor) => e.chain().focus().toggleCode().run(),
  },
];
