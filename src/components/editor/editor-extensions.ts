import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { LimitedTable } from "./LimitedTable";
import { Callout } from "./Callout";
import { Toggle, ToggleSummary, ToggleContent } from "./Toggle";
import { ColumnList, Column } from "./Columns";
import { Tabs, Tab } from "./Tabs";
import { ButtonBlock } from "./ButtonBlock";
import { PageLink } from "./PageLink";
import { Breadcrumb } from "./Breadcrumb";
import { TableOfContents } from "./TableOfContents";
import { EmojiPicker } from "./EmojiPicker";
import { DateMention } from "./DateMention";
import { PageMention } from "./PageMention";
import { Equation } from "./Equation";
import { EquationBlock } from "./EquationBlock";
import { CodeBlock } from "./CodeBlock";
import { ImageBlock, VideoBlock, AudioBlock, FileBlock } from "./MediaBlocks";
import { WebBookmark } from "./WebBookmark";
import { CanvasBlock } from "./CanvasBlock";
import { BackgroundColor, TextColor } from "./ColorMarks";
import { LinkOpen } from "./LinkOpen";
import { CalendarBlock, ChartBlock, MapBlock, TimelineBlock } from "../views/view-blocks";

/**
 * Every content node, shared by the page editor and by the editor inside a
 * synced block, so both accept exactly the same blocks. What the page editor
 * adds on top (protected title, bridge, slash menu, `syncedBlock` itself) is
 * NOT here — in particular `syncedBlock`, so a synced block's own schema
 * cannot hold another one (no reference cycles; Rust re-checks on save).
 */
export const contentExtensions = [
  // trailingNode: false — otherwise StarterKit auto-appends an empty
  // paragraph whenever the doc's last node isn't one (e.g. right after
  // a slash command turns the trailing paragraph into a heading/list/etc).
  // codeBlock: false — replaced by CodeBlock below (same node name, adds highlighting).
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    trailingNode: false,
    codeBlock: false,
    // links: never followed by the webview (LinkOpen opens them on Ctrl+click) and only these schemes; a typed
    // address without one gets https://
    link: {
      openOnClick: false,
      autolink: true,
      defaultProtocol: "https",
      protocols: ["http", "https", "mailto"],
    },
  }),
  TextColor,
  BackgroundColor,
  LinkOpen,
  CodeBlock,
  TaskList,
  TaskItem.configure({ nested: true }),
  Callout,
  Toggle,
  ToggleSummary,
  ToggleContent,
  ColumnList,
  Column,
  Tabs,
  Tab,
  LimitedTable,
  TableRow,
  TableHeader,
  TableCell,
  ButtonBlock,
  PageLink,
  Breadcrumb,
  TableOfContents,
  EmojiPicker,
  DateMention,
  PageMention,
  Equation,
  EquationBlock,
  ImageBlock,
  VideoBlock,
  AudioBlock,
  FileBlock,
  WebBookmark,
  // standalone views: they keep their entries in the node itself, with no database behind
  CalendarBlock,
  TimelineBlock,
  MapBlock,
  ChartBlock,
  CanvasBlock,
];
