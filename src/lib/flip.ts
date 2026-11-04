import { useLayoutEffect, useRef, type RefObject } from "react";

type Rects = Map<string, DOMRect>;

function measure(root: HTMLElement | null): Rects {
  const rects: Rects = new Map();
  for (const el of root?.querySelectorAll<HTMLElement>("[data-flip]") ?? [])
    if (el.dataset.flip) rects.set(el.dataset.flip, el.getBoundingClientRect());
  return rects;
}

/**
 * Things marked `data-flip="id"` inside `root` glide from where they were to where they are, instead of jumping,
 * when `data` (what the list is drawn from) changes. Call the returned `snapshot` once a write is done and
 * just before the data is read again: the page still shows the old layout then. A change nobody took a
 * snapshot for (a rename, a reload from elsewhere) does not animate.
 */
export function useFlip(root: RefObject<HTMLElement | null>, data: unknown) {
  const before = useRef<{ at: number; rects: Rects } | null>(null);
  const snapshot = () => {
    before.current = { at: Date.now(), rects: measure(root.current) };
  };

  useLayoutEffect(() => {
    const from = before.current;
    before.current = null;
    // a snapshot whose reload never came must not animate some later, unrelated change
    if (!from || Date.now() - from.at > 2000) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const [id, now] of measure(root.current)) {
      const was = from.rects.get(id);
      if (!was || (was.left === now.left && was.top === now.top)) continue;
      const el = root.current?.querySelector<HTMLElement>(`[data-flip="${CSS.escape(id)}"]`);
      el?.animate(
        [
          { transform: `translate(${was.left - now.left}px, ${was.top - now.top}px)` },
          { transform: "none" },
        ],
        { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    }
  }, [root, data]);

  return snapshot;
}
