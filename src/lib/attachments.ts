import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";

export type MediaKind = "image" | "video" | "audio" | "file";

/** Keep in sync with MAX_ATTACHMENT_BYTES in src-tauri/src/attachments.rs — Rust enforces it regardless. */
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export interface AttachmentInfo {
  file: string;
  size: number;
}

export interface LinkPreview {
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: string | null;
}

/** Same shape Rust accepts (`valid_attachment_name`). Used to drop malformed refs coming from pasted HTML. */
const ATTACHMENT_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/;

export function asAttachmentName(value: unknown): string | null {
  return typeof value === "string" && ATTACHMENT_NAME.test(value) ? value : null;
}

export function asHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const { protocol } = new URL(value.trim());
    return protocol === "http:" || protocol === "https:" ? value.trim() : null;
  } catch {
    return null;
  }
}

/** Tauri rejects with the plain string a Rust command returned; anything else is an unexpected failure. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Error desconocido";
}

export function formatSize(bytes: number): string {
  const nf = new Intl.NumberFormat("es", { maximumFractionDigits: 1 });
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${nf.format(bytes / 1024)} KB`;
  return `${nf.format(bytes / (1024 * 1024))} MB`;
}

export function mediaKindOf(mime: string): MediaKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

/** Copies a File into the app's attachments folder. The bytes travel as a raw IPC body — no JSON, no base64. */
export async function storeAttachment(file: File): Promise<AttachmentInfo> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`El archivo supera el límite de ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB`);
  }
  // Header values must be ASCII; Rust sanitizes again.
  const ext = (file.name.includes(".") ? (file.name.split(".").pop() ?? "") : "").replace(
    /[^a-zA-Z0-9]/g,
    "",
  );
  const bytes = new Uint8Array(await file.arrayBuffer());
  return invoke<AttachmentInfo>("store_attachment", bytes, { headers: { "x-file-ext": ext } });
}

export function downloadAttachment(url: string, kind: MediaKind): Promise<AttachmentInfo> {
  return invoke<AttachmentInfo>("download_attachment", { url, kind });
}

export function fetchLinkPreview(url: string): Promise<LinkPreview> {
  return invoke<LinkPreview>("fetch_link_preview", { url });
}

export function openAttachment(file: string): Promise<void> {
  return invoke("open_attachment", { file });
}

/** Resolves to false if the user cancelled the native dialog. */
export function saveAttachmentAs(file: string, suggestedName: string): Promise<boolean> {
  return invoke<boolean>("save_attachment_as", { file, suggestedName });
}

/** Best-effort display name for a downloaded URL: its last path segment, decoded. */
export function nameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : new URL(url).hostname;
  } catch {
    return "archivo";
  }
}

let attachmentsDir: Promise<string> | null = null;

/** Asset-protocol URL for an attachment. Only `$APPDATA/attachments/**` is in the protocol's scope (tauri.conf.json). */
export function attachmentUrl(file: string): Promise<string> {
  attachmentsDir ??= appDataDir().then((dir) => join(dir, "attachments"));
  return attachmentsDir.then((dir) => join(dir, file)).then(convertFileSrc);
}
