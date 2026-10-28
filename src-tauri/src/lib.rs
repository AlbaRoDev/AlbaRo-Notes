mod ai;
mod app_update;
mod attachments;
mod boards;
mod calendar;
mod commands;
mod databases;
mod db;
mod families;
mod fsprivate;
mod ics;
mod maps;
mod search;
mod secret;
mod tasks;
mod validate;
mod views;
mod webview_privacy;

use attachments::AttachmentsDir;
use db::DbState;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // The window can only show the app itself.
        .plugin(navigation_guard())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let conn = db::init(&app_data_dir)?;

            // The content of pages deleted long ago (see db::sweep_orphan_blocks) goes first: while it
            // exists it keeps its attachments and synced blocks "in use".
            match db::sweep_orphan_blocks(&conn) {
                Ok(0) => {}
                Ok(n) => eprintln!("removed {n} block(s) of pages that no longer exist"),
                Err(e) => eprintln!("orphaned block sweep failed: {e}"),
            }

            // Sweeps run before any command can be served — see
            // attachments::sweep_orphans. Synced blocks go first: attachments
            // only referenced from a deleted synced block then go with it.
            match db::sweep_synced_blocks(&conn) {
                Ok(0) => {}
                Ok(n) => eprintln!("removed {n} orphaned synced block(s)"),
                Err(e) => eprintln!("synced block sweep failed: {e}"),
            }
            let attachments_dir = app_data_dir.join("attachments");
            match attachments::sweep_orphans(&conn, &attachments_dir) {
                Ok(0) => {}
                Ok(n) => eprintln!("removed {n} orphaned attachment file(s)"),
                Err(e) => eprintln!("attachment sweep failed: {e}"),
            }
            app.manage(AttachmentsDir(attachments_dir));
            app.manage(DbState(Mutex::new(conn)));
            // a key an older version left in ai-config.json moves to the credential store
            ai::migrate_key(app.handle());
            app.manage(ai::AiState::default());
            // the browser keeps the text typed into the app (search, cells…) unless told not to
            webview_privacy::forget_typed_text(app);
            // Only used from Rust, to look for a new version of the app. No `updater:*` permission
            // goes to the page (see the capability test below).
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                app.manage(app_update::Pending::default());
                app_update::start(app.handle().clone());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_ping,
            commands::get_page_content,
            commands::save_page_content,
            commands::get_synced_block,
            commands::save_synced_block,
            commands::create_database_page,
            commands::get_database,
            commands::list_databases,
            commands::add_property,
            commands::rename_property,
            commands::delete_property,
            commands::set_select_options,
            commands::rename_select_option,
            commands::reorder_properties,
            commands::reorder_rows,
            commands::set_option_color,
            commands::set_property_icon,
            commands::set_option_group,
            commands::list_calendar_entries,
            commands::create_calendar_entry,
            commands::update_calendar_entry,
            commands::delete_calendar_entry,
            commands::calendar_entry_to_task,
            commands::calendar_entry_unlink_task,
            commands::calendar_deadlines,
            commands::export_calendar,
            commands::list_boards,
            commands::get_board,
            commands::create_board,
            commands::rename_board,
            commands::delete_board,
            commands::add_board_list,
            commands::rename_board_list,
            commands::delete_board_list,
            commands::move_board_list,
            commands::add_board_card,
            commands::create_board_card,
            commands::move_board_card,
            commands::remove_board_card,
            commands::boards_of_task,
            commands::list_families,
            commands::add_cards_to_board,
            commands::calendar_scheduled_tasks,
            commands::link_page,
            commands::unlink_page,
            commands::pages_of_task,
            commands::tasks_of_page,
            commands::set_page_favorite,
            commands::set_page_icon,
            commands::set_page_cover,
            commands::page_info,
            commands::duplicate_row,
            commands::duplicate_property,
            commands::change_property_type,
            commands::set_row_title,
            commands::create_view,
            commands::rename_view,
            commands::delete_view,
            commands::update_view_config,
            commands::query_view,
            commands::fetch_map_tile,
            commands::geocode_place,
            commands::submit_form,
            commands::create_row,
            commands::set_value,
            commands::list_pages,
            commands::search_pages,
            commands::ai_status,
            commands::ai_get_settings,
            commands::ai_set_settings,
            commands::ai_index,
            commands::ai_ask,
            commands::ai_apply,
            commands::ai_discard,
            commands::ai_write,
            commands::ai_read_handwriting,
            commands::ai_cancel,
            commands::create_page,
            commands::delete_page,
            commands::ensure_task_base,
            commands::add_task,
            commands::store_attachment,
            commands::download_attachment,
            commands::fetch_link_preview,
            commands::open_attachment,
            commands::save_attachment_as,
            commands::get_app_update,
            commands::check_app_update,
            commands::install_app_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Without this, `location.href = "https://example.com"` (from a script that got into the page,
/// or a link the editor failed to intercept) would load a stranger's site inside the app's window,
/// looking like part of the app. The app never needs to leave its own origin: links go to the
/// system browser through the opener plugin.
fn navigation_guard() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|webview, url| {
            // `None` outside debug builds: the dev server is never an allowed origin in release.
            let dev_url = if cfg!(debug_assertions) {
                webview.app_handle().config().build.dev_url.as_ref()
            } else {
                None
            };
            is_app_page(url, dev_url)
        })
        .build()
}

/// The app's own origin: `tauri.localhost` on Windows, `tauri://localhost` elsewhere, and (debug
/// only, the caller passes `None` otherwise) the configured Vite server.
fn is_app_page(url: &tauri::Url, dev_url: Option<&tauri::Url>) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || dev_url.is_some_and(|dev| url.scheme() == dev.scheme() && url.host_str() == dev.host_str() && url.port_or_known_default() == dev.port_or_known_default())
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::is_app_page;

    fn page(url: &str, dev: Option<&str>) -> bool {
        let dev = dev.map(|d| d.parse().unwrap());
        is_app_page(&url.parse().unwrap(), dev.as_ref())
    }

    #[test]
    fn only_the_apps_own_pages_may_be_shown() {
        assert!(page("http://tauri.localhost/", None));
        assert!(page("https://tauri.localhost/index.html", None));
        assert!(page("tauri://localhost/", None));
        for other in [
            "https://example.com/",
            "http://example.com/",
            // A look-alike host must not pass.
            "https://tauri.localhost.evil.test/",
            "https://evil.test/tauri.localhost",
            "https://user@evil.test/",
            "tauri://evil.test/",
            "file:///C:/Windows/win.ini",
            "data:text/html,<script>1</script>",
            "javascript:alert(1)",
            "about:blank",
            "ftp://tauri.localhost/",
            // The dev server is not an origin of a release build.
            "http://localhost:1420/",
            "http://127.0.0.1:1420/",
        ] {
            assert!(!page(other, None), "{other}");
        }
    }

    #[test]
    fn the_dev_server_is_allowed_only_when_the_caller_passes_it() {
        let dev = Some("http://localhost:1420");
        assert!(page("http://localhost:1420/", dev));
        assert!(page("http://localhost:1420/#/x", dev));
        for other in [
            "http://localhost:8080/",
            "https://localhost:1420/",
            "http://localhost.evil.test:1420/",
            "http://127.0.0.1:1420/",
        ] {
            assert!(!page(other, dev), "{other}");
        }
    }

    /// What the page may ask of Tauri itself. Adding a permission must be a decision made here,
    /// with its reason. `core:default` would let the page build tray icons and menus, read image
    /// files, emit events and inspect windows; `opener:default` would also reveal arbitrary paths
    /// in the file manager; `dialog` is only ever used from Rust. App commands (`invoke_handler`)
    /// need no permission by themselves: the page can always call all of them.
    #[test]
    fn the_page_gets_exactly_the_permissions_it_needs() {
        let capability: serde_json::Value = serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let mut permissions: Vec<&str> = capability["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p.as_str().expect("a permission with a scope is not expected"))
            .collect();
        permissions.sort_unstable();
        assert_eq!(
            permissions,
            [
                // `getVersion()` for the footer.
                "core:app:allow-version",
                // The streaming events of the AI.
                "core:event:allow-listen",
                "core:event:allow-unlisten",
                // `appDataDir()` + `join()` to build asset URLs.
                "core:path:allow-join",
                "core:path:allow-resolve-directory",
                // Ctrl+click on a link, bookmarks and url/email/phone cells; `safe` in JS limits the scheme, this limits it again.
                "opener:allow-default-urls",
                "opener:allow-open-url",
            ]
        );
        assert_eq!(capability["windows"], serde_json::json!(["main"]));
        assert!(capability.get("remote").is_none(), "no remote origin may use IPC");
    }

    #[test]
    fn the_prototype_is_frozen_and_the_release_csp_has_no_inline_scripts() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let security = &conf["app"]["security"];
        assert_eq!(security["freezePrototype"], true);
        assert!(!security["csp"].as_str().unwrap().contains("script-src 'self' 'unsafe-inline'"));
        assert!(!security["csp"].as_str().unwrap().contains("unsafe-eval"));
    }
}
