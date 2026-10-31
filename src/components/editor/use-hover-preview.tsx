import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { PagePreviewCard } from "./PagePreviewCard";
import type { PageSummary } from "../../types";

/** How long the pointer rests on a link before its card shows, and how long the card waits before going when it leaves. */
const SHOW_MS = 400;
const HIDE_MS = 150;

/**
 * Hover preview for a link to `page`: spread `bind` on the link and render `card`. The card shows after the
 * pointer rests on the link, stays while the pointer is on it, and closes on leaving, Esc, a key (so it never
 * covers what is being written), a scroll or a press outside. The page is only read when the card shows.
 */
export function useHoverPreview(
  page: PageSummary | undefined,
  pages: PageSummary[],
  onOpen: (pageId: string) => void,
) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const showTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);

  const stopTimers = useCallback(() => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
  }, []);
  const close = useCallback(() => {
    stopTimers();
    setAnchor(null);
  }, [stopTimers]);
  const leaveSoon = useCallback(() => {
    window.clearTimeout(showTimer.current);
    hideTimer.current = window.setTimeout(() => setAnchor(null), HIDE_MS);
  }, []);

  useEffect(() => stopTimers, [stopTimers]);

  useEffect(() => {
    if (!anchor) return;
    const onPress = (e: Event) => {
      if (!(e.target as Element | null)?.closest?.(".page-preview")) close();
    };
    document.addEventListener("keydown", close, true);
    document.addEventListener("pointerdown", onPress, true);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("keydown", close, true);
      document.removeEventListener("pointerdown", onPress, true);
      document.removeEventListener("scroll", close, true);
    };
  }, [anchor, close]);

  const bind = {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      if (!page) return;
      window.clearTimeout(hideTimer.current);
      window.clearTimeout(showTimer.current);
      const el = e.currentTarget;
      showTimer.current = window.setTimeout(() => setAnchor(el), SHOW_MS);
    },
    onMouseLeave: leaveSoon,
  };

  const card =
    anchor && page ? (
      <PagePreviewCard
        key={page.id}
        page={page}
        pages={pages}
        anchor={anchor}
        onPointer={(inside) => (inside ? window.clearTimeout(hideTimer.current) : leaveSoon())}
        onOpen={(pageId) => {
          close();
          onOpen(pageId);
        }}
      />
    ) : null;

  return { bind, card };
}
