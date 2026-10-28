use crate::ai::{self, AiReply, AiSettings, AiSettingsInput, AiStatus, Applied, WriteMessage};
use crate::attachments::{self, AttachmentInfo, AttachmentsDir, LinkPreview};
use crate::boards;
use crate::calendar;
use crate::databases::{self, DatabaseData, DatabaseSummary, PropertyInfo};
use crate::db::{self, DbState, PageSummary};
use crate::families;
use crate::ics;
use crate::maps::{self, GeocodeResult};
use crate::search::{self, SearchResult};
use crate::tasks;
use crate::views::{self, ViewInfo, ViewResult};
use serde_json::Value;
use std::fs;
use std::path::Path;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// Verifies the SQLite connection is alive and migrations have run.
#[tauri::command]
pub fn db_ping(state: State<DbState>) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.query_row("PRAGMA user_version", [], |row| row.get(0)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_page_content(state: State<DbState>, page_id: String) -> Result<Option<Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_page_content(&conn, &page_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_page_content(state: State<DbState>, page_id: String, content: Value) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::save_page_content(&conn, &page_id, &content)
}

#[tauri::command]
pub fn get_synced_block(state: State<DbState>, id: String) -> Result<Option<Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_synced_block(&conn, &id)
}

#[tauri::command]
pub fn save_synced_block(state: State<DbState>, id: String, content: Value) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::save_synced_block(&conn, &id, &content)
}

#[tauri::command]
pub fn list_pages(state: State<DbState>) -> Result<Vec<PageSummary>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::list_pages(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_page(state: State<DbState>, parent_id: Option<String>) -> Result<PageSummary, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::create_page(&conn, parent_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_page(state: State<DbState>, dir: State<AttachmentsDir>, page_id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    tasks::check_deletable(&conn, &page_id)?;
    attachments::delete_page_and_leftovers(&conn, &dir.0, &page_id)
}

/// The Gestor's task database, created the first time.
#[tauri::command]
pub fn ensure_task_base(state: State<DbState>) -> Result<tasks::TaskBase, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    tasks::ensure_task_base(&conn)
}

/// Quick add: a new task with this title.
#[tauri::command]
pub fn add_task(state: State<DbState>, title: String) -> Result<PageSummary, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    tasks::add_task(&conn, &title)
}

/// A new database: a root-level page of kind `database` (see databases.rs).
#[tauri::command]
pub fn create_database_page(state: State<DbState>) -> Result<PageSummary, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    databases::create_database_page(&conn)
}

#[tauri::command]
pub fn get_database(state: State<DbState>, id: String) -> Result<Option<DatabaseData>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    databases::get_database(&conn, &id)
}

#[tauri::command]
pub fn list_databases(state: State<DbState>) -> Result<Vec<DatabaseSummary>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    databases::list_databases(&conn)
}

#[tauri::command]
pub fn add_property(state: State<DbState>, database_id: String, name: String, kind: String, config: Value) -> Result<PropertyInfo, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    databases::add_property(&conn, &database_id, &name, &kind, &config)
}

#[tauri::command]
pub fn rename_property(state: State<DbState>, id: String, name: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    databases::rename_property(&conn, &id, &name)
}

#[tauri::command]
pub fn delete_property(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    databases::delete_property(&conn, &id)
}

#[tauri::command]
pub fn set_select_options(state: State<DbState>, id: String, options: Value) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    databases::set_select_options(&conn, &id, &options)
}

#[tauri::command]
pub fn rename_select_option(state: State<DbState>, id: String, old: String, new: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    databases::rename_select_option(&conn, &id, &old, &new)
}

// the AI (off, local Ollama or online); off the main thread so the window never freezes.
#[tauri::command]
pub async fn ai_status(app: AppHandle) -> Result<AiStatus, String> {
    tauri::async_runtime::spawn_blocking(move || ai::status(&app)).await.map_err(|e| e.to_string())
}

/// The AI's settings (never the API key, only whether there is one).
#[tauri::command]
pub fn ai_get_settings(app: AppHandle) -> AiSettings {
    ai::load_config(&app).settings()
}

#[tauri::command]
pub fn ai_set_settings(app: AppHandle, settings: AiSettingsInput) -> Result<AiSettings, String> {
    ai::save_settings(&app, &settings)
}

/// Embeds the pages that changed since last time; returns how many.
#[tauri::command]
pub async fn ai_index(app: AppHandle) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || ai::sync_embeddings(&app)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ai_ask(app: AppHandle, chat_id: String, message: String, today: String, page_id: Option<String>) -> Result<AiReply, String> {
    tauri::async_runtime::spawn_blocking(move || ai::ask(&app, &chat_id, &message, &today, page_id.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

/// Applies a change the assistant proposed, once the user confirms it.
#[tauri::command]
pub async fn ai_apply(app: AppHandle, id: String) -> Result<Applied, String> {
    tauri::async_runtime::spawn_blocking(move || ai::apply(&app, &id)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn ai_discard(app: AppHandle, id: String) -> Result<(), String> {
    ai::discard(&app, &id)
}

/// Writing for the page (Notion AI): streams `ai-write` events and returns the whole text.
#[tauri::command]
pub async fn ai_write(app: AppHandle, id: String, messages: Vec<WriteMessage>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || ai::write(&app, &id, &messages))
        .await
        .map_err(|e| e.to_string())?
}

/// Reads a handwritten canvas (a base64 PNG) with the AI's vision model and returns its text.
#[tauri::command]
pub async fn ai_read_handwriting(app: AppHandle, image: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || ai::read_handwriting(&app, &image))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn ai_cancel(app: AppHandle, id: String) -> Result<(), String> {
    ai::cancel_write(&app, &id)
}

#[tauri::command]
pub fn search_pages(state: State<DbState>, query: String) -> Result<Vec<SearchResult>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    search::search_pages(&conn, &query)
}

#[tauri::command]
pub fn set_option_color(state: State<DbState>, id: String, option: String, color: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    databases::set_option_color(&conn, &id, &option, &color)
}

#[tauri::command]
pub fn set_property_icon(state: State<DbState>, id: String, icon: Option<String>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    databases::set_property_icon(&conn, &id, icon.as_deref())
}

#[tauri::command]
pub fn set_option_group(state: State<DbState>, id: String, option: String, group: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    databases::set_option_group(&conn, &id, &option, &group)
}

#[tauri::command]
pub fn duplicate_property(state: State<DbState>, id: String) -> Result<PropertyInfo, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    databases::duplicate_property(&conn, &id)
}

#[tauri::command]
pub fn change_property_type(state: State<DbState>, id: String, kind: String, config: Value) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    databases::change_property_type(&conn, &id, &kind, &config)
}

#[tauri::command]
pub fn reorder_properties(state: State<DbState>, database_id: String, ordered_ids: Vec<String>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    databases::reorder_properties(&conn, &database_id, &ordered_ids)
}

#[tauri::command]
pub fn reorder_rows(state: State<DbState>, database_id: String, ordered_ids: Vec<String>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    databases::reorder_rows(&conn, &database_id, &ordered_ids)
}

#[tauri::command]
pub fn list_calendar_entries(state: State<DbState>, from: String, to: String) -> Result<Vec<calendar::CalendarEntry>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    calendar::list_entries(&conn, &from, &to)
}

#[tauri::command]
pub fn create_calendar_entry(state: State<DbState>, entry: calendar::EntryInput) -> Result<calendar::CalendarEntry, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    calendar::create_entry(&conn, &entry)
}

#[tauri::command]
pub fn update_calendar_entry(
    state: State<DbState>,
    id: String,
    entry: calendar::EntryInput,
    scope: Option<calendar::Scope>,
    occurrence: Option<String>,
) -> Result<calendar::CalendarEntry, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    calendar::update_series(&conn, &id, &entry, scope.unwrap_or(calendar::Scope::All), occurrence.as_deref())
}

#[tauri::command]
pub fn delete_calendar_entry(state: State<DbState>, id: String, scope: Option<calendar::Scope>, occurrence: Option<String>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    calendar::delete_series(&conn, &id, scope.unwrap_or(calendar::Scope::All), occurrence.as_deref())
}

#[tauri::command]
pub fn calendar_entry_to_task(state: State<DbState>, id: String) -> Result<calendar::CalendarEntry, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    calendar::entry_to_task(&conn, &id)
}

#[tauri::command]
pub fn calendar_entry_unlink_task(state: State<DbState>, id: String) -> Result<calendar::CalendarEntry, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    calendar::entry_unlink_task(&conn, &id)
}

#[tauri::command]
pub fn calendar_scheduled_tasks(state: State<DbState>) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    calendar::scheduled_tasks(&conn)
}

#[tauri::command]
pub fn calendar_deadlines(state: State<DbState>, from: String, to: String) -> Result<Vec<calendar::Deadline>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    calendar::deadlines(&conn, &from, &to)
}

/// Exports the calendar as an `.ics` file: the text is made first (the lock is not held while the dialog is open), then
/// the native «Save as» dialog is shown from Rust so the page never supplies a path. Returns the saved path, or
/// `None` if the user cancelled.
#[tauri::command]
pub async fn export_calendar(app: AppHandle, state: State<'_, DbState>, include_deadlines: bool) -> Result<Option<String>, String> {
    let text = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let now: String = conn.query_row("SELECT datetime('now')", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        ics::export(&conn, include_deadlines, &now)?
    };
    let Some(dest) = app
        .dialog()
        .file()
        .set_file_name("albaro-notes.ics")
        .add_filter("Calendario (.ics)", &["ics"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let dest = dest.into_path().map_err(|e| e.to_string())?;
    fs::write(&dest, text).map_err(|e| format!("No se pudo guardar el archivo: {e}"))?;
    Ok(Some(dest.to_string_lossy().into_owned()))
}

/// boards. Every rule lives in `boards.rs`; these only lock the database and pass the call on.
#[tauri::command]
pub fn list_boards(state: State<DbState>) -> Result<Vec<boards::BoardInfo>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    boards::list_boards(&conn)
}

#[tauri::command]
pub fn get_board(state: State<DbState>, id: String) -> Result<boards::BoardData, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    boards::get_board(&conn, &id)
}

#[tauri::command]
pub fn create_board(state: State<DbState>, name: String) -> Result<boards::BoardData, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    boards::create_board(&conn, &name)
}

#[tauri::command]
pub fn rename_board(state: State<DbState>, id: String, name: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    boards::rename_board(&conn, &id, &name)
}

#[tauri::command]
pub fn delete_board(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    boards::delete_board(&conn, &id)
}

#[tauri::command]
pub fn add_board_list(state: State<DbState>, board_id: String, name: String) -> Result<boards::BoardList, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    boards::add_list(&conn, &board_id, &name)
}

#[tauri::command]
pub fn rename_board_list(state: State<DbState>, id: String, name: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    boards::rename_list(&conn, &id, &name)
}

#[tauri::command]
pub fn delete_board_list(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    boards::delete_list(&conn, &id)
}

#[tauri::command]
pub fn move_board_list(state: State<DbState>, id: String, index: usize) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    boards::move_list(&conn, &id, index)
}

#[tauri::command]
pub fn add_board_card(state: State<DbState>, list_id: String, task_id: String, index: Option<usize>) -> Result<boards::Card, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    boards::add_card(&conn, &list_id, &task_id, index)
}

#[tauri::command]
pub fn create_board_card(state: State<DbState>, list_id: String, title: String) -> Result<boards::Card, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    boards::create_card(&conn, &list_id, &title)
}

#[tauri::command]
pub fn move_board_card(state: State<DbState>, card_id: String, list_id: String, index: usize) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    boards::move_card(&conn, &card_id, &list_id, index)
}

#[tauri::command]
pub fn remove_board_card(state: State<DbState>, card_id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    boards::remove_card(&conn, &card_id)
}

#[tauri::command]
pub fn boards_of_task(state: State<DbState>, task_id: String) -> Result<Vec<boards::BoardInfo>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    boards::boards_of_task(&conn, &task_id)
}

/// the task families, and a whole family onto a board.
#[tauri::command]
pub fn list_families(state: State<DbState>, property: Option<String>, measure: Option<String>) -> Result<families::Families, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    families::list_families(&conn, property.as_deref(), measure.as_deref())
}

#[tauri::command]
pub fn add_cards_to_board(state: State<DbState>, board_id: String, task_ids: Vec<String>) -> Result<boards::Added, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    boards::add_cards(&conn, &board_id, &task_ids)
}

#[tauri::command]
pub fn link_page(state: State<DbState>, task_id: String, page_id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    tasks::link_page(&conn, &task_id, &page_id)
}

#[tauri::command]
pub fn unlink_page(state: State<DbState>, task_id: String, page_id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    tasks::unlink_page(&conn, &task_id, &page_id)
}

#[tauri::command]
pub fn pages_of_task(state: State<DbState>, task_id: String) -> Result<Vec<tasks::PageRef>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    tasks::pages_of_task(&conn, &task_id)
}

#[tauri::command]
pub fn tasks_of_page(state: State<DbState>, page_id: String) -> Result<Vec<tasks::PageRef>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    tasks::tasks_of_page(&conn, &page_id)
}

#[tauri::command]
pub fn set_page_icon(state: State<DbState>, page_id: String, icon: Option<String>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::set_page_icon(&conn, &page_id, icon.as_deref())
}

#[tauri::command]
pub fn set_page_cover(state: State<DbState>, page_id: String, cover: Option<String>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::set_page_cover(&conn, &page_id, cover.as_deref())
}

#[tauri::command]
pub fn set_page_favorite(state: State<DbState>, page_id: String, favorite: bool) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::set_page_favorite(&conn, &page_id, favorite)
}

#[tauri::command]
pub fn page_info(state: State<DbState>, page_id: String) -> Result<db::PageInfo, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::page_info(&conn, &page_id)
}

#[tauri::command]
pub fn duplicate_row(state: State<DbState>, page_id: String) -> Result<PageSummary, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    databases::duplicate_row(&conn, &page_id)
}

#[tauri::command]
pub fn set_row_title(state: State<DbState>, page_id: String, title: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::set_row_title(&conn, &page_id, &title)
}

#[tauri::command]
pub fn create_view(state: State<DbState>, database_id: String, name: String, kind: String) -> Result<ViewInfo, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    views::create_view(&conn, &database_id, &name, &kind)
}

#[tauri::command]
pub fn rename_view(state: State<DbState>, id: String, name: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    views::rename_view(&conn, &id, &name)
}

#[tauri::command]
pub fn delete_view(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    views::delete_view(&conn, &id)
}

#[tauri::command]
pub fn update_view_config(state: State<DbState>, id: String, config: Value) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    views::update_view_config(&conn, &id, &config)
}

#[tauri::command]
pub fn query_view(state: State<DbState>, view_id: String) -> Result<ViewResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    views::query_view(&conn, &view_id)
}

/// Path of a map tile relative to the attachments folder, downloading it on first use.
#[tauri::command]
pub async fn fetch_map_tile(dir: State<'_, AttachmentsDir>, z: u32, x: u32, y: u32) -> Result<String, String> {
    let dir = dir.0.clone();
    tauri::async_runtime::spawn_blocking(move || maps::fetch_tile(&dir, z, x, y))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn geocode_place(query: String) -> Result<Vec<GeocodeResult>, String> {
    tauri::async_runtime::spawn_blocking(move || maps::geocode(&query)).await.map_err(|e| e.to_string())?
}

/// Creates a row from a form view's answers; all-or-nothing (see views::submit_form).
#[tauri::command]
pub fn submit_form(state: State<DbState>, view_id: String, values: serde_json::Map<String, Value>) -> Result<PageSummary, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    views::submit_form(&conn, &view_id, &values)
}

#[tauri::command]
pub fn create_row(state: State<DbState>, database_id: String) -> Result<PageSummary, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    databases::create_row(&conn, &database_id)
}

#[tauri::command]
pub fn set_value(state: State<DbState>, page_id: String, property_id: String, value: Value) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    databases::set_value(&conn, &page_id, &property_id, &value)
}

/// Raw-bytes IPC (no JSON/base64): the file is the request body, its extension
/// the `x-file-ext` header. The display name never reaches Rust — the frontend
/// keeps it in the node, only the sanitized extension names the file on disk.
#[tauri::command]
pub async fn store_attachment(dir: State<'_, AttachmentsDir>, request: Request<'_>) -> Result<AttachmentInfo, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Se esperaba el contenido del archivo como bytes".to_string());
    };
    let ext = request.headers().get("x-file-ext").and_then(|v| v.to_str().ok()).unwrap_or("");
    attachments::store_bytes(&dir.0, bytes, ext)
}

#[tauri::command]
pub async fn download_attachment(dir: State<'_, AttachmentsDir>, url: String, kind: String) -> Result<AttachmentInfo, String> {
    let dir = dir.0.clone();
    tauri::async_runtime::spawn_blocking(move || attachments::download(&dir, &url, &kind))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fetch_link_preview(dir: State<'_, AttachmentsDir>, url: String) -> Result<LinkPreview, String> {
    let dir = dir.0.clone();
    tauri::async_runtime::spawn_blocking(move || attachments::link_preview(&dir, &url))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_attachment(app: AppHandle, dir: State<'_, AttachmentsDir>, file: String) -> Result<(), String> {
    let path = attachments::resolve(&dir.0, &file)?;
    attachments::ensure_openable(&file)?;
    app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// Shows the native "Save as" dialog from Rust and copies the attachment to
/// the chosen path, so the frontend never supplies a destination path.
/// Returns false if the user cancelled.
#[tauri::command]
pub async fn save_attachment_as(app: AppHandle, dir: State<'_, AttachmentsDir>, file: String, suggested_name: String) -> Result<bool, String> {
    let source = attachments::resolve(&dir.0, &file)?;
    let suggested = Path::new(&suggested_name).file_name().and_then(|n| n.to_str()).unwrap_or(&file).to_string();
    let Some(dest) = app.dialog().file().set_file_name(suggested).blocking_save_file() else {
        return Ok(false);
    };
    let dest = dest.into_path().map_err(|e| e.to_string())?;
    fs::copy(&source, &dest).map_err(|e| format!("No se pudo guardar el archivo: {e}"))?;
    Ok(true)
}

/// The update the background check found, if any (the page may start listening after the event).
#[tauri::command]
pub fn get_app_update(app: AppHandle) -> Option<crate::app_update::UpdateInfo> {
    crate::app_update::pending(&app)
}

/// Looks for an update now (the button), instead of waiting for the background check. Returns the
/// version found, or `None` when the app is up to date; installing still needs its own button.
#[tauri::command]
pub async fn check_app_update(app: AppHandle) -> Result<Option<crate::app_update::UpdateInfo>, String> {
    crate::app_update::check(&app).await
}

/// Downloads, verifies the signature of and installs the update, then restarts. Only when the user
/// presses the button.
#[tauri::command]
pub async fn install_app_update(app: AppHandle) -> Result<(), String> {
    crate::app_update::install(&app).await
}
