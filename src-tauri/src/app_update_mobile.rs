// The phone app has no updater of its own: a new version is installed over the old one. These
// answer the same commands as `app_update.rs` so the page needs no platform check.
use serde::Serialize;
use tauri::AppHandle;

#[derive(Clone, Serialize)]
pub struct UpdateInfo {
    version: String,
}

pub fn pending(_app: &AppHandle) -> Option<UpdateInfo> {
    None
}

pub async fn check(_app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    Ok(None)
}

pub async fn install(_app: &AppHandle) -> Result<(), String> {
    Err("no update is available".into())
}
