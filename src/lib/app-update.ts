// updates of the app itself. Rust looks for them in the background and only tells;
// nothing is downloaded until `installAppUpdate` (the user's button). See src-tauri/src/app_update.rs.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface AppUpdate {
  version: string;
}

/** The update the last check found, if any (the event may have come before the page listened). */
export async function getAppUpdate(): Promise<AppUpdate | null> {
  return invoke<AppUpdate | null>("get_app_update");
}

/** Looks for an update right now. Resolves to the version found, or `null` when the app is up to date; rejects with the reason if it could not ask. */
export async function checkAppUpdate(): Promise<AppUpdate | null> {
  return invoke<AppUpdate | null>("check_app_update");
}

const CHECK_REQUESTED = "albaro:check-app-update";

/** Asks the update note (`UpdateBanner`) to look now and show the outcome; any button or command can call it. */
export function requestUpdateCheck(): void {
  window.dispatchEvent(new Event(CHECK_REQUESTED));
}

export function onUpdateCheckRequested(handler: () => void): () => void {
  window.addEventListener(CHECK_REQUESTED, handler);
  return () => window.removeEventListener(CHECK_REQUESTED, handler);
}

/** Downloads, checks the signature of and installs the update, then restarts. On success it never settles. */
export async function installAppUpdate(): Promise<void> {
  return invoke("install_app_update");
}

export function onAppUpdateAvailable(handler: (update: AppUpdate) => void): Promise<UnlistenFn> {
  return listen<AppUpdate>("app-update-available", (event) => handler(event.payload));
}
