import { useEffect, useState } from "react";
import { attachmentUrl } from "../lib/attachments";

/** Resolves an attachment file name to its asset-protocol URL (null until resolved). */
export function useAttachmentUrl(file: string | null): string | null {
  const [resolved, setResolved] = useState<{ file: string; url: string } | null>(null);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    void attachmentUrl(file)
      .then((url) => {
        if (!cancelled) setResolved({ file, url });
      })
      .catch((err) => console.error("Failed to resolve attachment URL", err));
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Tied to `file` so a stale URL from the previous file is never returned.
  return file && resolved?.file === file ? resolved.url : null;
}
