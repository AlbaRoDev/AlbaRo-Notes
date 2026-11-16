// The phone app cannot replace itself: Android only installs an APK the person opens, and asks them
// to confirm. So the app looks at GitHub's latest release, tells when there is a newer one with its
// APK, and the button hands the APK's address to the system browser, which downloads it; opening
// the download installs it over the old version (Android refuses it unless it carries the same
// signing key). These answer the same commands as `app_update.rs`, so the page needs no platform check.
use std::{io::Read, sync::Mutex, thread, time::Duration};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::release_check::{newer_release, Found};

const LATEST: &str = "https://api.github.com/repos/AlbaRoDev/AlbaRo-Notes/releases/latest";
const FIRST_CHECK: Duration = Duration::from_secs(20);
const CHECK_EVERY: Duration = Duration::from_secs(12 * 60 * 60);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const TIMEOUT: Duration = Duration::from_secs(20);
/// GitHub's reply is a few KB (a release with its notes and five assets); more than this is not it.
const MAX_REPLY: u64 = 512 * 1024;

/// The newer release the last check found, kept until it is installed.
#[derive(Default)]
pub struct Pending {
    found: Mutex<Option<Found>>,
}

/// What the page is told. `manual`: the person finishes the install themselves (the page words it that way).
#[derive(Clone, Serialize)]
pub struct UpdateInfo {
    version: String,
    manual: bool,
}

impl From<&Found> for UpdateInfo {
    fn from(found: &Found) -> Self {
        Self {
            version: found.version.clone(),
            manual: true,
        }
    }
}

/// Looks a little after start and then twice a day; errors (no connection) are only logged.
pub fn start(app: AppHandle) {
    thread::spawn(move || {
        thread::sleep(FIRST_CHECK);
        loop {
            if let Err(err) = tauri::async_runtime::block_on(check(&app)) {
                eprintln!("app update check failed: {err}");
            }
            thread::sleep(CHECK_EVERY);
        }
    });
}

pub fn pending(app: &AppHandle) -> Option<UpdateInfo> {
    let pending = app.state::<Pending>();
    let found = pending.found.lock().ok()?;
    found.as_ref().map(UpdateInfo::from)
}

fn fetch_latest() -> Result<String, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_connect(Some(CONNECT_TIMEOUT))
        .timeout_global(Some(TIMEOUT))
        .user_agent("AlbaRoNotes")
        .build()
        .into();
    let resp = agent
        .get(LATEST)
        .header("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("could not reach the release server: {e}"))?;
    let mut bytes = Vec::new();
    resp.into_body().into_reader().take(MAX_REPLY + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_REPLY {
        return Err("the release reply is too large".to_string());
    }
    String::from_utf8(bytes).map_err(|_| "unreadable reply from the release server".to_string())
}

pub async fn check(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let reply = tauri::async_runtime::spawn_blocking(fetch_latest).await.map_err(|e| e.to_string())??;
    let found = newer_release(&reply, env!("CARGO_PKG_VERSION"))?;
    let info = found.as_ref().map(UpdateInfo::from);
    if let Ok(mut pending) = app.state::<Pending>().found.lock() {
        *pending = found;
    }
    if let Some(info) = &info {
        // The page may not be listening yet; it asks with `get_app_update` when it starts.
        let _ = app.emit("app-update-available", info.clone());
    }
    Ok(info)
}

/// Hands the APK's address to the system browser. Nothing is downloaded by the app itself.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let url = {
        let pending = app.state::<Pending>();
        let found = pending.found.lock().map_err(|_| "update state is poisoned".to_string())?;
        found.as_ref().map(|f| f.url.clone()).ok_or("nothing newer to install")?
    };
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}
