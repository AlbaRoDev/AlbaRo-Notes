// Updates of the app itself, through `tauri-plugin-updater`. It only ever tells the user: the page
// shows "version X is available" and nothing is downloaded or installed until the user presses the
// button. The plugin is used from Rust only and no capability grants it to the page (a test in
// lib.rs checks that). Updates are signed with a key of this project (the public half is in
// `tauri.conf.json`); the plugin refuses an artifact whose signature does not match, or whose
// signed version is not the one the manifest announces (`requireSignedVersion`).
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

/// First look a little after start, so it does not compete with the start-up work.
const FIRST_CHECK: Duration = Duration::from_secs(20);
const CHECK_EVERY: Duration = Duration::from_secs(12 * 60 * 60);

/// The only servers an installer may be fetched from: GitHub's release page and the two hosts it
/// redirects asset downloads to. If GitHub moves its downloads elsewhere, updating stops until the
/// list changes: failing closed is the point (the signature protects the content, this the route).
const ALLOWED_HOSTS: [&str; 3] = ["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"];

/// The update the last check found, kept until it is installed.
#[derive(Default)]
pub struct Pending {
    update: Mutex<Option<Update>>,
    installing: AtomicBool,
}

/// What the page is told: the version only. The release notes come from the update server, so they
/// stay out of the interface.
#[derive(Clone, Serialize)]
pub struct UpdateInfo {
    version: String,
}

/// Looks now and then, in a thread of its own; errors (no connection, no release yet) are only
/// logged, because an update check must never bother the user.
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

/// Looks now, at the user's request (the "check for updates" button), and says what it found.
pub async fn check(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    #[allow(unused_mut)] // only changed by the debug override below
    let mut builder = app.updater_builder();
    // To try an update by hand: a local `latest.json` in a debug build. Release builds only ever
    // ask the endpoint in `tauri.conf.json`, over HTTPS.
    #[cfg(debug_assertions)]
    if let Ok(url) = std::env::var("ALBARO_UPDATE_URL") {
        let url = url.parse().map_err(|e| format!("ALBARO_UPDATE_URL: {e}"))?;
        builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
    }
    let update = builder.build().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let Some(update) = update else { return Ok(None) };
    if !download_allowed(&update.download_url) {
        return Err(format!(
            "the update is served from {}, which is not on the list of servers the app may use",
            update.download_url.host_str().unwrap_or("?")
        ));
    }
    let info = UpdateInfo { version: update.version.clone() };
    if let Ok(mut pending) = app.state::<Pending>().update.lock() {
        *pending = Some(update);
    }
    // The page may not be listening yet; it asks with `get_app_update` when it starts.
    let _ = app.emit("app-update-available", info.clone());
    Ok(Some(info))
}

/// Whether the installer's address is one the app may fetch from. A debug build trying an update
/// by hand (`ALBARO_UPDATE_URL`) may use its own server.
fn download_allowed(url: &Url) -> bool {
    (cfg!(debug_assertions) && std::env::var_os("ALBARO_UPDATE_URL").is_some()) || allowed(url)
}

/// https, port 443, no credentials, and one of `ALLOWED_HOSTS`.
fn allowed(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && url.host_str().is_some_and(|host| ALLOWED_HOSTS.contains(&host.to_ascii_lowercase().as_str()))
}

/// The update found so far, if any.
pub fn pending(app: &AppHandle) -> Option<UpdateInfo> {
    let pending = app.state::<Pending>();
    let update = pending.update.lock().ok()?;
    update.as_ref().map(|u| UpdateInfo { version: u.version.clone() })
}

/// Downloads, verifies and installs the update, then restarts. The page has already written
/// whatever was waiting to be saved (see `UpdateBanner`). On Windows the installer ends the app
/// itself, and elsewhere `restart` does.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let pending = app.state::<Pending>();
    // Cloned, not taken: if the download fails, the user can press the button again.
    let update = pending.update.lock().map_err(|_| "update state is poisoned")?.clone().ok_or("no update is available")?;
    if pending.installing.swap(true, Ordering::SeqCst) {
        return Err("the update is already being installed".into());
    }
    let result = update.download_and_install(|_, _| {}, || {}).await;
    if let Err(e) = result {
        pending.installing.store(false, Ordering::SeqCst);
        return Err(format!("update failed: {e}"));
    }
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::{allowed, Url};
    use base64::{engine::general_purpose::STANDARD, Engine};
    use minisign_verify::{PublicKey, Signature};

    // What the shipped app trusts and asks, read from the config that gets compiled in.
    const CONFIG: &str = include_str!("../tauri.conf.json");

    // A file signed with a throwaway key (not the project's) by `tauri signer sign --app-version 0.2.0`,
    // the way a release is signed; the signature file holds what `latest.json` carries in `signature`.
    // `OTHER_KEY` is that throwaway key's public half. `PROJECT_SIGNATURE` is the same file signed with
    // the project's own key, the way the release workflow signs (made with the key the CI uses).
    const FILE: &[u8] = include_bytes!("../tests/fixtures/update-fixture.bin");
    const SIGNATURE: &str = include_str!("../tests/fixtures/update-fixture.bin.sig");
    const PROJECT_SIGNATURE: &str = include_str!("../tests/fixtures/update-fixture.bin.project.sig");
    const OTHER_KEY: &str =
        "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDhENEU5QUE4QjI2Q0VFQjEKUldTeDdteXlxSnBPaldvazk1MHVNSzdITk1ZcjlOU1pjb0V5UjlvMmI2azBVNWtqdGhOM3F6L3oK";

    fn config() -> serde_json::Value {
        serde_json::from_str(CONFIG).unwrap()
    }

    fn url(text: &str) -> Url {
        text.parse().unwrap()
    }

    #[test]
    fn the_installer_may_come_only_from_github_over_https() {
        for ok in [
            "https://github.com/AlbaRoDev/AlbaRo-Notes/releases/download/v0.7.0/setup.exe",
            "https://release-assets.githubusercontent.com/github-production-release-asset/1/x?sp=r",
            "https://objects.githubusercontent.com/x",
            "https://GitHub.com:443/x",
        ] {
            assert!(allowed(&url(ok)), "{ok}");
        }
        for bad in [
            "http://github.com/x",
            "https://example.com/x",
            "https://github.com.evil.test/x",
            "https://evil.test/github.com",
            "https://evil.test@github.com/x",
            "https://github.com@evil.test/x",
            "https://user:pw@github.com/x",
            "https://github.com:8443/x",
            "https://raw.githubusercontent.com/x",
            "https://githubusercontent.com/x",
            "https://sub.github.com/x",
            "file:///C:/x",
        ] {
            assert!(!allowed(&url(bad)), "{bad}");
        }
    }

    /// The key in the config is a well-formed minisign public key, and the signed version is
    /// required, so an old release cannot be presented as a new one.
    #[test]
    fn the_config_trusts_a_valid_key_and_requires_the_signed_version() {
        let updater = &config()["plugins"]["updater"];
        let key = String::from_utf8(STANDARD.decode(updater["pubkey"].as_str().unwrap().trim()).unwrap()).unwrap();
        PublicKey::decode(&key).unwrap();
        assert_eq!(updater["requireSignedVersion"], true);
    }

    fn decode(base64: &str) -> String {
        String::from_utf8(STANDARD.decode(base64.trim()).unwrap()).unwrap()
    }

    /// What the release key signs verifies with the key in the app's config, and the announced version
    /// is inside the signed part (what `requireSignedVersion` reads).
    #[test]
    fn what_the_project_key_signs_verifies_with_the_key_in_the_app() {
        let signature = Signature::decode(&decode(PROJECT_SIGNATURE)).unwrap();
        let ours = PublicKey::decode(&decode(config()["plugins"]["updater"]["pubkey"].as_str().unwrap())).unwrap();
        ours.verify(FILE, &signature, true).unwrap();
        assert!(
            signature.trusted_comment().split('\t').any(|field| field == "version:0.2.0"),
            "{}",
            signature.trusted_comment()
        );
        // and not with the throwaway key, so the two fixtures really are of different keys
        assert!(PublicKey::decode(&decode(OTHER_KEY)).unwrap().verify(FILE, &signature, true).is_err());
    }

    /// What is signed with another key, or changed after signing, is refused by the key the app trusts.
    #[test]
    fn a_signature_of_another_key_or_a_changed_installer_is_refused() {
        let signature = Signature::decode(&decode(SIGNATURE)).unwrap();
        // Control: the fixture is well signed, and its version is in the signed part (what
        // `requireSignedVersion` reads); without this the refusals below would prove nothing.
        let other = PublicKey::decode(&decode(OTHER_KEY)).unwrap();
        other.verify(FILE, &signature, true).unwrap();
        assert!(
            signature.trusted_comment().split('\t').any(|field| field == "version:0.2.0"),
            "{}",
            signature.trusted_comment()
        );

        let ours = PublicKey::decode(&decode(config()["plugins"]["updater"]["pubkey"].as_str().unwrap())).unwrap();
        assert!(ours.verify(FILE, &signature, true).is_err(), "the app's key accepted a signature of another key");
        for at in [0, 10, FILE.len() - 1] {
            let mut bad = FILE.to_vec();
            bad[at] ^= 1;
            assert!(other.verify(&bad, &signature, true).is_err(), "byte {at}");
        }
        assert!(other.verify(b"", &signature, true).is_err());
    }

    /// The only server the app asks about updates is this repository's GitHub, over HTTPS, and
    /// nothing weakens that.
    #[test]
    fn the_app_asks_one_server_over_https_and_trusts_no_insecure_transport() {
        let updater = &config()["plugins"]["updater"];
        let endpoints = updater["endpoints"].as_array().unwrap();
        assert_eq!(endpoints.len(), 1);
        assert_eq!(endpoints[0], "https://github.com/AlbaRoDev/AlbaRo-Notes/releases/latest/download/latest.json");
        for weakening in [
            "dangerousInsecureTransportProtocol",
            "dangerousAcceptInvalidCerts",
            "dangerousAcceptInvalidHostnames",
            "allowDowngrades",
        ] {
            assert!(updater.get(weakening).is_none(), "{weakening} is set");
        }
        // The release workflow turns the artifacts on (with `--config`); the app config does not.
        assert!(config()["bundle"].get("createUpdaterArtifacts").is_none());
    }
}
