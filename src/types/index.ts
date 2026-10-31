export interface PageSummary {
  id: string;
  title: string;
  parentId: string | null;
  /** Set when the page is a row of a database (hidden from the sidebar tree). */
  databaseId: string | null;
  /** `database` pages *are* a database: a kind of page, not a sub-page. */
  kind: "page" | "database";
  /** The database a `database` page owns. */
  ownDatabaseId: string | null;
  /** `"tasks"` on the page of the Gestor's task database (it can't be deleted). */
  role: "tasks" | null;
  /** Pinned by the user: shown in the «Favoritos» group too. */
  favorite: boolean;
  /** An emoji shown before the title. */
  icon: string | null;
  /** `color:<name>`, `season:<name>` or `image:<attachment>`. */
  cover: string | null;
}

/** How a calendar entry repeats (Rust's `Repeat`): every `interval` days/weeks/months/years; weekly can name weekdays (0 = Monday … 6 = Sunday); ends never, on `until` or after `count` times. */
export interface Repeat {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  weekdays: number[];
  until: string | null;
  count: number | null;
  /** Monthly or yearly: the 1st–4th (or -1 = the last) weekday of the month instead of a day number. */
  nth: number | null;
  /** Monthly: the last day of the month. */
  lastDay: boolean;
}

/** How far an edit or a deletion of a repeating entry reaches. */
export type Scope = "this" | "following" | "all";

/** An entry of the Gestor's calendar (Rust's `CalendarEntry`): a scheduled task or an appointment. Times are `YYYY-MM-DDTHH:MM`, all-day entries bare dates. */
export interface CalendarEntry {
  id: string;
  taskId: string | null;
  /** The task's title, or the appointment's own. */
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  color: TagColor | null;
  location: string | null;
  note: string | null;
  repeat: Repeat | null;
  /** For a repeating entry, the day this occurrence starts on. */
  occurrence: string | null;
}

/** What is sent to create or change an entry: the whole entry each time (Rust's `EntryInput`). */
export interface EntryInput {
  taskId: string | null;
  /** Only for an appointment; a scheduled task takes its title from the task. */
  title: string | null;
  start: string;
  end: string;
  allDay: boolean;
  color: TagColor | null;
  location: string | null;
  note: string | null;
  repeat: Repeat | null;
}

/** A task's due date, to show on its day. */
export interface Deadline {
  taskId: string;
  title: string;
  date: string;
}

/** boards (Rust's `boards.rs`). A card is a reference to a task: its title is the task's. */
export interface BoardInfo {
  id: string;
  name: string;
}

/** An item of a task's checklist (the «[ ]» list of its page). */
export interface ChecklistItem {
  text: string;
  checked: boolean;
}

export interface BoardCard {
  id: string;
  taskId: string;
  title: string;
  checklist: { done: number; total: number };
}

export interface BoardList {
  id: string;
  name: string;
  cards: BoardCard[];
}

export interface BoardData extends BoardInfo {
  lists: BoardList[];
}

/** the task families (Rust's `families.rs`). */
interface FamilyTask {
  id: string;
  title: string;
}

export interface Family {
  key: string;
  label: string;
  color: TagColor | null;
  size: number;
  tasks: FamilyTask[];
}

export interface Families {
  property: string | null;
  groupable: { id: string; name: string }[];
  measurable: { id: string; name: string }[];
  families: Family[];
  total: number;
}

/** A page or task in a list of links (Rust's `PageRef`). */
export interface PageRef {
  id: string;
  title: string;
}

/** What a page's menu shows at its foot (Rust's `PageInfo`). */
export interface PageInfo {
  /** `YYYY-MM-DD HH:MM:SS`, UTC. */
  updatedAt: string;
  words: number;
}

export type PropertyKind =
  "text" | "number" | "date" | "select" | "relation" | "place" | "checkbox" | "tags";

export interface Property {
  id: string;
  name: string;
  type: PropertyKind;
  /** select: `{ options, colors? }` (colour by option text); relation: `{ target }` (a database id); text: `{ format? }`. */
  config: {
    options?: string[];
    colors?: Record<string, TagColor>;
    target?: string;
    format?: TextFormat;
    /** A select that is Notion's «Estado»: its options belong to groups. */
    status?: boolean;
    groups?: Record<string, StatusGroup>;
  };
  /** The icon picked for the column (a lucide icon name or an emoji); none = the type's own. */
  icon?: string | null;
}

/** The three groups of a status property's options (Rust's `STATUS_GROUPS`). */
export type StatusGroup = "todo" | "doing" | "done";

/** A text property shown as a link, a mail address or a phone number (Rust's `TEXT_FORMATS`). */
export type TextFormat = "url" | "email" | "phone";

/** Notion's tag colours (Rust's `databases::COLORS`). */
export type TagColor =
  "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";

/** A table footer calculation (Rust's `views::Calc`). */
export type Calc =
  | "count_all"
  | "count_values"
  | "count_empty"
  | "count_unique"
  | "percent_empty"
  | "percent_not_empty"
  | "sum"
  | "avg"
  | "median"
  | "min"
  | "max"
  | "range"
  | "earliest"
  | "latest";

/** A place, like Notion's: a label/address and map coordinates (both or neither). */
export interface PlaceValue {
  name?: string;
  lat?: number;
  lng?: number;
}

/** text/date/select: string (a date may be a `start/end` range); number: number; relation: row page ids; place: PlaceValue. Absent = no value. */
/** A checkbox is `true` when checked; unchecked is no value at all. */
export type CellValue = string | number | boolean | string[] | PlaceValue;

export interface DatabaseRow {
  pageId: string;
  title: string;
  values: Record<string, CellValue>;
}

export type Direction = "asc" | "desc";
export type Granularity = "day" | "week" | "month" | "year";
export type Operator =
  | "contains"
  | "not_contains"
  | "is"
  | "is_not"
  | "is_empty"
  | "is_not_empty"
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "before"
  | "after"
  | "on_or_before"
  | "on_or_after";

export interface SortRule {
  /** A property id, or `"title"` for the row's own title. */
  property: string;
  direction: Direction;
}

export interface FilterRule {
  property: string;
  operator: Operator;
  /** Absent while the rule is still being filled in (Rust ignores it until then). */
  value?: string | number | boolean;
}

interface GroupRule {
  property: string;
  granularity?: Granularity;
  hideEmpty: boolean;
}

/** Sort, filter and group of one saved view. Rust validates it against the database's real schema. */
export interface ViewConfig {
  sorts: SortRule[];
  filter: { op: "and" | "or"; rules: FilterRule[] };
  group?: GroupRule;
  /** Properties this view leaves out (columns / card fields). Hidden, not visible, so new properties show up by default. */
  hiddenProperties?: string[];
  /** Table columns resized by hand: px by property id or "title" (Rust allows 60–1000). */
  columnWidths?: Record<string, number>;
  /** Table footer: one calculation per column (property id or "title"). */
  calculations?: Record<string, Calc>;
  /** Table: columns up to and including this one stay put while scrolling sideways. */
  frozenUpTo?: string;
  /** Table: columns whose content wraps instead of being cut. */
  wrapped?: string[];
  /** Gallery/feed: show the page's first image and text snippet (on unless false). */
  showPreview?: boolean;
  /** Calendar/timeline: the date property the view is laid out by (unset = the first one). */
  dateProperty?: string;
  /** Map: the place property whose coordinates become pins (unset = the first one). */
  placeProperty?: string;
  /** Form views only. */
  form?: FormConfig;
  /** Chart views only; the X axis is `group`. */
  chart?: ChartConfig;
  /** Dashboard views only. */
  dashboard?: DashboardConfig;
}

/** One tile of a dashboard: a chart or a number with its own X axis, calculation and filter. */
export interface DashboardWidget {
  id: string;
  title?: string;
  chart: ChartConfig;
  group?: GroupRule;
  filter: { op: "and" | "or"; rules: FilterRule[] };
  /** Takes the whole row instead of half of it. */
  wide: boolean;
}

interface DashboardConfig {
  widgets: DashboardWidget[];
}

export type ChartType = "number" | "donut" | "bar" | "hbar" | "line";
export type Aggregate = "count" | "sum" | "avg" | "min" | "max";
/** `x`: the groups' own order. */
export type ChartSort = "x" | "asc" | "desc";

export interface ChartConfig {
  type?: ChartType;
  aggregate?: Aggregate;
  /** The number property sum/avg/min/max work on. */
  value?: string;
  sort?: ChartSort;
}

export interface ChartPoint {
  key: string;
  label: string;
  /** Null when the group has no numbers to aggregate. */
  value: number | null;
}

/** One question of a form view: a property of the database, or the row `title`. */
export interface FormField {
  property: string;
  /** The question's text (the property's name when absent). */
  label?: string;
  help?: string;
  required?: boolean;
}

export interface FormConfig {
  title?: string;
  description?: string;
  /** Absent = the title (required) and every property. */
  fields?: FormField[];
  submitLabel?: string;
  successMessage?: string;
}

export type ViewKind =
  | "table"
  | "list"
  | "gallery"
  | "feed"
  | "board"
  | "calendar"
  | "timeline"
  | "map"
  | "form"
  | "chart"
  | "dashboard";

export interface ViewInfo {
  id: string;
  name: string;
  type: ViewKind;
  config: Partial<ViewConfig>;
}

export interface RowPreview {
  /** An attachment file name. */
  image: string | null;
  snippet: string;
}

interface ViewGroup {
  key: string;
  label: string;
  rowIds: string[];
}

/** What a view shows: row ids already filtered and sorted, and the groups if it groups. */
export interface ViewResult {
  rowIds: string[];
  groups: ViewGroup[] | null;
  /** Gallery/feed only: row id -> card preview. */
  previews: Record<string, RowPreview> | null;
  /** Chart views only. `total` counts the points before the cap. */
  chart: { points: ChartPoint[]; total: number } | null;
  /** Dashboard views only: what each widget draws, in the widgets' order. */
  widgets: { points: ChartPoint[]; total: number }[] | null;
}

export interface DatabaseData {
  id: string;
  /** The database's own page; its title is the database's name. */
  pageId: string;
  name: string;
  properties: Property[];
  rows: DatabaseRow[];
  views: ViewInfo[];
}

export interface DatabaseSummary {
  id: string;
  name: string;
}

/** A deleted page waiting in the trash (with what hung from it). Dates are `YYYY-MM-DD HH:MM:SS`, UTC. */
export interface TrashItem {
  id: string;
  title: string;
  kind: "page" | "database";
  icon: string | null;
  /** The page deleted and what went with it (sub-pages, rows). */
  pageCount: number;
  deletedAt: string;
  /** When it is erased for good. */
  expiresAt: string;
}

/** One search hit. Matches in `title`/`snippet` are wrapped in U+E000 … U+E001. */
export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  kind: "page" | "database";
  isRow: boolean;
  /** Titles of the ancestors, root first. */
  path: string[];
}
