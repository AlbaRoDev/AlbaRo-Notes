//! What the embedded browser keeps of what is typed into the app.
//!
//! WebView2 (Edge) remembers the text typed into form fields, with the date, in its own profile
//! (`%LOCALAPPDATA%\<identifier>\EBWebView\Default\Web Data`, table `autofill_edge_field_values`):
//! the search box, a cell, a title field. That file is not the notes' database, so `secure_delete`
//! and the page deletion never touched it, and `autocomplete="off"` is not honoured by that table
//! (tried). The way to stop it is the browser's own setting, and to clear what is already there.
//!
//! macOS (WKWebView) and Linux (WebKitGTK) keep no such history that was found; that was not
//! checked on those systems.

/// Turns the browser's form autofill and password saving off and clears what they kept.
#[cfg(windows)]
pub fn forget_typed_text(app: &tauri::App) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else { return };
    // Runs on the thread that owns the webview, once it exists.
    let _ = window.with_webview(|webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Profile2, ICoreWebView2Settings4, ICoreWebView2_13, COREWEBVIEW2_BROWSING_DATA_KINDS_GENERAL_AUTOFILL, COREWEBVIEW2_BROWSING_DATA_KINDS_PASSWORD_AUTOSAVE,
        };
        use windows_core::Interface;

        let Ok(core) = webview.controller().CoreWebView2() else { return };
        if let Ok(settings) = core.Settings().and_then(|s| s.cast::<ICoreWebView2Settings4>()) {
            let _ = settings.SetIsGeneralAutofillEnabled(false);
            let _ = settings.SetIsPasswordAutosaveEnabled(false);
        }
        // what an earlier run already saved: cleared at every start (cheap, and nothing to remember)
        if let Ok(profile) = core.cast::<ICoreWebView2_13>().and_then(|c| c.Profile()).and_then(|p| p.cast::<ICoreWebView2Profile2>()) {
            let done = webview2_com::ClearBrowsingDataCompletedHandler::create(Box::new(|_| Ok(())));
            let _ = profile.ClearBrowsingData(
                COREWEBVIEW2_BROWSING_DATA_KINDS_GENERAL_AUTOFILL | COREWEBVIEW2_BROWSING_DATA_KINDS_PASSWORD_AUTOSAVE,
                &done,
            );
        }
    });
}

#[cfg(not(windows))]
pub fn forget_typed_text(_app: &tauri::App) {}
