/** How many times the gap between two fingers must grow (or shrink) for one zoom level. */
export const PINCH_STEP = 1.7;

/**
 * The zoom change (+1, -1 or 0) when two fingers go from `from` px apart to `now` px apart. The caller takes
 * `now` as the new `from` after a change, so a long pinch goes level by level.
 */
export function pinchLevel(from: number, now: number): -1 | 0 | 1 {
  if (from <= 0 || now <= 0) return 0;
  if (now / from >= PINCH_STEP) return 1;
  if (from / now >= PINCH_STEP) return -1;
  return 0;
}
