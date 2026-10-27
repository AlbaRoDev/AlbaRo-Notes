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

/** Downloads, checks the signature of and installs the update, then restarts. On success it never settles. */
export async function installAppUpdate(): Promise<void> {
  return invoke("install_app_update");
}

export function onAppUpdateAvailable(handler: (update: AppUpdate) => void): Promise<UnlistenFn> {
  return listen<AppUpdate>("app-update-available", (event) => handler(event.payload));
}
