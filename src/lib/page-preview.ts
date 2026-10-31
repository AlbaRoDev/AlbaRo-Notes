import { getPageContent } from "./db-client";
import { previewItems, type PreviewItem } from "./markdown-blocks";

const MAX_LINES = 8;
/** A page just read is not read again for this long (the card reappears at once when the pointer comes back). */
const FRESH_MS = 15_000;
const cache = new Map<string, { at: number; items: PreviewItem[] }>();

/**
 * The first lines of what a page says (and the pages it links to), for the card that shows when the pointer rests on a link to it. The page's
 * title is its first block and is not repeated. Read only when asked, never ahead of the pointer.
 */
export async function pagePreview(pageId: string): Promise<PreviewItem[]> {
  const hit = cache.get(pageId);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.items;
  const doc = await getPageContent(pageId);
  const items = previewItems((doc?.content ?? []).slice(1), MAX_LINES);
  cache.set(pageId, { at: Date.now(), items });
  return items;
}
