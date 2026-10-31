import { invoke } from "@tauri-apps/api/core";
import type { JSONContent } from "@tiptap/react";
import type {
  BoardCard,
  BoardData,
  ChecklistItem,
  BoardInfo,
  BoardList,
  CalendarEntry,
  CellValue,
  DatabaseData,
  DatabaseSummary,
  Deadline,
  EntryInput,
  Families,
  PageSummary,
  PageInfo,
  PageRef,
  Property,
  PropertyKind,
  Scope,
  SearchResult,
  StatusGroup,
  TagColor,
  TrashItem,
  ViewConfig,
  ViewInfo,
  ViewKind,
  ViewResult,
} from "../types";

/** Checks the SQLite connection is alive and returns the current schema version. */
export async function dbPing(): Promise<number> {
  return invoke<number>("db_ping");
}

/** Returns the page's saved Tiptap document, or null if nothing has been saved yet. */
export async function getPageContent(pageId: string): Promise<JSONContent | null> {
  return invoke<JSONContent | null>("get_page_content", { pageId });
}

/** Persists the page's Tiptap document. */
export async function savePageContent(pageId: string, content: JSONContent): Promise<void> {
  return invoke("save_page_content", { pageId, content });
}

/** Returns a synced block's shared document, or null if no instance has been edited yet. */
export async function getSyncedBlock(id: string): Promise<JSONContent | null> {
  return invoke<JSONContent | null>("get_synced_block", { id });
}

/** Persists a synced block's shared document (creates the row on first save). */
export async function saveSyncedBlock(id: string, content: JSONContent): Promise<void> {
  return invoke("save_synced_block", { id, content });
}

/** Creates a database: a new root-level page of kind `database` (not a sub-page of anything). */
export async function createDatabasePage(): Promise<PageSummary> {
  return invoke<PageSummary>("create_database_page");
}

/** The Gestor's task database: its page and database ids. Created the first time. */
export interface TaskBase {
  pageId: string;
  databaseId: string;
}

export async function ensureTaskBase(): Promise<TaskBase> {
  return invoke<TaskBase>("ensure_task_base");
}

/** Quick add: a new task (a row of the task database) with this title. */
export async function addTask(title: string): Promise<PageSummary> {
  return invoke<PageSummary>("add_task", { title });
}

export async function getDatabase(id: string): Promise<DatabaseData | null> {
  return invoke<DatabaseData | null>("get_database", { id });
}

export async function listDatabases(): Promise<DatabaseSummary[]> {
  return invoke<DatabaseSummary[]>("list_databases");
}

export async function addProperty(
  databaseId: string,
  name: string,
  kind: PropertyKind,
  config: Property["config"] = {},
): Promise<Property> {
  return invoke<Property>("add_property", { databaseId, name, kind, config });
}

/** A column's own icon (a lucide name or an emoji); `null` goes back to its type's. */
export async function setPropertyIcon(id: string, icon: string | null): Promise<void> {
  return invoke("set_property_icon", { id, icon });
}

export async function renameProperty(id: string, name: string): Promise<void> {
  return invoke("rename_property", { id, name });
}

export async function deleteProperty(id: string): Promise<void> {
  return invoke("delete_property", { id });
}

export async function setSelectOptions(id: string, options: string[]): Promise<void> {
  return invoke("set_select_options", { id, options });
}

/** Renames one option of a select property, rewriting the values that used it. */
/** Moves an option of a status property to another group. */
export async function setOptionGroup(
  id: string,
  option: string,
  group: StatusGroup,
): Promise<void> {
  return invoke("set_option_group", { id, option, group });
}

export async function renameSelectOption(id: string, from: string, to: string): Promise<void> {
  return invoke("rename_select_option", { id, old: from, new: to });
}

export async function setOptionColor(id: string, option: string, color: TagColor): Promise<void> {
  return invoke("set_option_color", { id, option, color });
}

/** A copy of the property (type, options, every value), placed right after it. */
export async function duplicateProperty(id: string): Promise<Property> {
  return invoke<Property>("duplicate_property", { id });
}

/** Converts a property to another type; values that don't fit the new one are cleared. A relation needs `{ target }`. */
export async function changePropertyType(
  id: string,
  kind: PropertyKind,
  config: Property["config"] = {},
): Promise<void> {
  return invoke("change_property_type", { id, kind, config });
}

/** Sets the column order; `orderedIds` must be every property of the database, once each. */
export async function reorderProperties(databaseId: string, orderedIds: string[]): Promise<void> {
  return invoke("reorder_properties", { databaseId, orderedIds });
}

/** Sets the order of the rows; `orderedIds` must be every row of the database, once each. */
export async function reorderRows(databaseId: string, orderedIds: string[]): Promise<void> {
  return invoke("reorder_rows", { databaseId, orderedIds });
}

/** Renames a database row (rewrites the first heading of its page). */
export async function setRowTitle(pageId: string, title: string): Promise<void> {
  return invoke("set_row_title", { pageId, title });
}

export async function createView(
  databaseId: string,
  name: string,
  kind: ViewKind,
): Promise<ViewInfo> {
  return invoke<ViewInfo>("create_view", { databaseId, name, kind });
}

export async function renameView(id: string, name: string): Promise<void> {
  return invoke("rename_view", { id, name });
}

/** Rust refuses to delete a database's last view. */
export async function deleteView(id: string): Promise<void> {
  return invoke("delete_view", { id });
}

/** Saves a view's sort/filter/group; Rust validates every rule against the database's real schema. */
export async function updateViewConfig(id: string, config: ViewConfig): Promise<void> {
  return invoke("update_view_config", { id, config });
}

/** The rows a view shows: filtered, sorted and grouped by Rust. */
export async function queryView(viewId: string): Promise<ViewResult> {
  return invoke<ViewResult>("query_view", { viewId });
}

/** Path (relative to the attachments folder) of a map tile; Rust downloads it the first time and caches it. */
export async function fetchMapTile(z: number, x: number, y: number): Promise<string> {
  return invoke<string>("fetch_map_tile", { z, x, y });
}

export interface GeocodeResult {
  name: string;
  lat: number;
  lng: number;
}

/** Looks a place up by name (online only; Rust makes the request). */
export async function geocodePlace(query: string): Promise<GeocodeResult[]> {
  return invoke<GeocodeResult[]>("geocode_place", { query });
}

/** Creates a row from a form view's answers (property id or `title` → value). All or nothing: Rust refuses the lot if any answer is invalid or a required one is missing. */
export async function submitForm(
  viewId: string,
  values: Record<string, CellValue>,
): Promise<PageSummary> {
  return invoke<PageSummary>("submit_form", { viewId, values });
}

/** Adds a row (an ordinary page nested under the database's host page). */
export async function createRow(databaseId: string): Promise<PageSummary> {
  return invoke<PageSummary>("create_row", { databaseId });
}

/** Sets one cell; `null` clears it. Rust validates the value against the property's real type. */
export async function setValue(
  pageId: string,
  propertyId: string,
  value: CellValue | null,
): Promise<void> {
  return invoke("set_value", { pageId, propertyId, value });
}

/** Lists all pages, ordered by creation date. */
export async function listPages(): Promise<PageSummary[]> {
  return invoke<PageSummary[]>("list_pages");
}

/** Creates a new page (its title starts empty — the first block is an empty heading). `parentId` nests it under another page. */
export async function createPage(parentId?: string): Promise<PageSummary> {
  return invoke<PageSummary>("create_page", { parentId });
}

/** Deletes a page and all of its content. */
export async function listCalendarEntries(from: string, to: string): Promise<CalendarEntry[]> {
  return invoke<CalendarEntry[]>("list_calendar_entries", { from, to });
}

export async function createCalendarEntry(entry: EntryInput): Promise<CalendarEntry> {
  return invoke<CalendarEntry>("create_calendar_entry", { entry });
}

/** For a repeating entry, `occurrence` (the day it starts on) and `scope` say which ones the change reaches. */
export async function updateCalendarEntry(
  id: string,
  entry: EntryInput,
  scope?: Scope,
  occurrence?: string,
): Promise<CalendarEntry> {
  return invoke<CalendarEntry>("update_calendar_entry", { id, entry, scope, occurrence });
}

export async function deleteCalendarEntry(
  id: string,
  scope?: Scope,
  occurrence?: string,
): Promise<void> {
  return invoke("delete_calendar_entry", { id, scope, occurrence });
}

/** An appointment becomes a task (the entry now schedules it). */
export async function calendarEntryToTask(id: string): Promise<CalendarEntry> {
  return invoke<CalendarEntry>("calendar_entry_to_task", { id });
}

/** The entry stops scheduling its task and becomes an appointment with the task's title. */
export async function calendarEntryUnlinkTask(id: string): Promise<CalendarEntry> {
  return invoke<CalendarEntry>("calendar_entry_unlink_task", { id });
}

export async function calendarDeadlines(from: string, to: string): Promise<Deadline[]> {
  return invoke<Deadline[]>("calendar_deadlines", { from, to });
}

/** Saves the whole calendar as an `.ics` file (native «Save as» dialog); the saved path, or `null` if cancelled. */
export async function exportCalendar(includeDeadlines: boolean): Promise<string | null> {
  return invoke<string | null>("export_calendar", { includeDeadlines });
}

/** The ids of the tasks that have at least one entry. */
export async function calendarScheduledTasks(): Promise<string[]> {
  return invoke<string[]>("calendar_scheduled_tasks");
}

/** Links an ordinary page to a task; Rust checks both ends. */
export async function linkPage(taskId: string, pageId: string): Promise<void> {
  return invoke("link_page", { taskId, pageId });
}

export async function unlinkPage(taskId: string, pageId: string): Promise<void> {
  return invoke("unlink_page", { taskId, pageId });
}

export async function pagesOfTask(taskId: string): Promise<PageRef[]> {
  return invoke<PageRef[]>("pages_of_task", { taskId });
}

export async function tasksOfPage(pageId: string): Promise<PageRef[]> {
  return invoke<PageRef[]>("tasks_of_page", { pageId });
}

export async function setPageFavorite(pageId: string, favorite: boolean): Promise<void> {
  return invoke("set_page_favorite", { pageId, favorite });
}

export async function pageInfo(pageId: string): Promise<PageInfo> {
  return invoke<PageInfo>("page_info", { pageId });
}

/** A copy of a database row (body, cells and relations), titled «… (copia)». */
export async function duplicateRow(pageId: string): Promise<PageSummary> {
  return invoke<PageSummary>("duplicate_row", { pageId });
}

/** Moves a page, and what hangs from it, to the trash; returns the trash entry. */
export async function deletePage(pageId: string): Promise<string> {
  return invoke<string>("delete_page", { pageId });
}

export async function listTrash(): Promise<TrashItem[]> {
  return invoke<TrashItem[]>("list_trash");
}

/** Puts a trashed page back; returns its id. */
export async function restoreTrash(trashId: string): Promise<string> {
  return invoke<string>("restore_trash", { trashId });
}

/** Erases one entry for good. */
export async function purgeTrash(trashId: string): Promise<void> {
  return invoke("purge_trash", { trashId });
}

export async function emptyTrash(): Promise<void> {
  return invoke("empty_trash");
}

/** Pages matching `query` (title and text, FTS5), best first; an empty query lists recent pages. */
export async function searchPages(query: string): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("search_pages", { query });
}

/* ---- boards ---- */
export async function listBoards(): Promise<BoardInfo[]> {
  return invoke<BoardInfo[]>("list_boards");
}

export async function getBoard(id: string): Promise<BoardData> {
  return invoke<BoardData>("get_board", { id });
}

/** A new board with the three starting lists. */
export async function createBoard(name: string): Promise<BoardData> {
  return invoke<BoardData>("create_board", { name });
}

export async function renameBoard(id: string, name: string): Promise<void> {
  return invoke("rename_board", { id, name });
}

/** Deletes the board with its lists and cards; the tasks stay. */
export async function deleteBoard(id: string): Promise<void> {
  return invoke("delete_board", { id });
}

export async function addBoardList(boardId: string, name: string): Promise<BoardList> {
  return invoke<BoardList>("add_board_list", { boardId, name });
}

export async function renameBoardList(id: string, name: string): Promise<void> {
  return invoke("rename_board_list", { id, name });
}

/** Deletes the list with its cards; the tasks stay. */
export async function deleteBoardList(id: string): Promise<void> {
  return invoke("delete_board_list", { id });
}

export async function moveBoardList(id: string, index: number): Promise<void> {
  return invoke("move_board_list", { id, index });
}

/** A card for an existing task (one per board), at `index` or the end. */
export async function addBoardCard(
  listId: string,
  taskId: string,
  index?: number,
): Promise<BoardCard> {
  return invoke<BoardCard>("add_board_card", { listId, taskId, index });
}

/** A new task and its card at the end of the list. */
export async function createBoardCard(listId: string, title: string): Promise<BoardCard> {
  return invoke<BoardCard>("create_board_card", { listId, title });
}

/** Moves a card inside its board, to `index` of the list. */
export async function moveBoardCard(cardId: string, listId: string, index: number): Promise<void> {
  return invoke("move_board_card", { cardId, listId, index });
}

/** Removes the card; the task is untouched. */
export async function removeBoardCard(cardId: string): Promise<void> {
  return invoke("remove_board_card", { cardId });
}

/** A task's checklist; each change returns the whole list as it is stored. Items are addressed by position. */
export async function getTaskChecklist(taskId: string): Promise<ChecklistItem[]> {
  return invoke<ChecklistItem[]>("get_task_checklist", { taskId });
}

export async function setChecklistItem(
  taskId: string,
  index: number,
  checked: boolean,
): Promise<ChecklistItem[]> {
  return invoke<ChecklistItem[]>("set_checklist_item", { taskId, index, checked });
}

export async function removeChecklistItem(taskId: string, index: number): Promise<ChecklistItem[]> {
  return invoke<ChecklistItem[]>("remove_checklist_item", { taskId, index });
}

export async function addChecklistItem(taskId: string, text: string): Promise<ChecklistItem[]> {
  return invoke<ChecklistItem[]>("add_checklist_item", { taskId, text });
}

/** The boards a task is on. */
export async function boardsOfTask(taskId: string): Promise<BoardInfo[]> {
  return invoke<BoardInfo[]>("boards_of_task", { taskId });
}

/* ---- families ---- */
/** The task families by a select, tags or relation column (none = the first tags column), sized by count or a number column. */
export async function listFamilies(property?: string, measure?: string): Promise<Families> {
  return invoke<Families>("list_families", { property, measure });
}

/** A card for each task at the end of the board's first list; those already on the board are skipped. */
export async function addCardsToBoard(
  boardId: string,
  taskIds: string[],
): Promise<{ added: number; skipped: number }> {
  return invoke<{ added: number; skipped: number }>("add_cards_to_board", { boardId, taskIds });
}

/* ---- page icon and cover ---- */
/** An emoji for the page (`null` clears it). */
export async function setPageIcon(pageId: string, icon: string | null): Promise<void> {
  return invoke("set_page_icon", { pageId, icon });
}

/** `color:<name>`, `season:<name>` or `image:<attachment>` (`null` clears it). */
export async function setPageCover(pageId: string, cover: string | null): Promise<void> {
  return invoke("set_page_cover", { pageId, cover });
}
