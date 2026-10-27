// Layout of the two halves: which one is the main zone and how much of the width it takes.

export type Half = "notes" | "manager";

/** Share of the width taken by the main zone. 1 = the companion is folded; 0 = the main zone is (the companion fills the window). */
export const SNAPS = [0, 1 / 3, 1 / 2, 2 / 3, 1] as const;
export const DEFAULT_SPLIT = 2 / 3;

/** How close (as a share of the width) a drag must get to a snap point to stick to it. */
const SNAP_RANGE = 0.04;

export function snapSplit(ratio: number): number {
  const clamped = Math.min(1, Math.max(0, ratio));
  return SNAPS.find((s) => Math.abs(s - clamped) <= SNAP_RANGE) ?? clamped;
}

export const otherHalf = (half: Half): Half => (half === "notes" ? "manager" : "notes");

/** A stored split, or the default when it is missing or garbage. */
export function parseSplit(raw: string | null): number {
  const n = Number(raw);
  return raw !== null && Number.isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULT_SPLIT;
}

/** What the window shows: `main` is the half in the big zone (`null` = the start screen) and `split` its share of the width. */
export interface Layout {
  main: Half | null;
  split: number;
}

/** The half that is on screen when only one is (the companion fills the window at split 0). */
export const shownHalf = ({ main, split }: Layout): Half | null =>
  main && (split === 0 ? otherHalf(main) : main);

/** Makes `half` the main zone; a window where the main zone was folded away gets its default width back. */
export const promote = (l: Layout, half: Half): Layout => ({
  main: half,
  split: l.split === 0 ? DEFAULT_SPLIT : l.split,
});

/** The switcher, Ctrl+1/Ctrl+2 and the start screen: go to `half` the least disruptive way. */
export function enter(l: Layout, half: Half): Layout {
  if (l.main === null) return promote(l, half);
  if (half === shownHalf(l)) return l;
  // the half asked for is the main zone folded away: unfold it instead of swapping the roles
  return l.split === 0 ? { ...l, split: DEFAULT_SPLIT } : promote(l, half);
}
