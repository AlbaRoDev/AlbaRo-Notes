/**
 * Pure helpers of the Gestor's calendar. Times are «floating» local times, `YYYY-MM-DDTHH:MM`, as in Rust's
 * `calendar.rs`; an all-day entry holds bare dates. Everything is in whole minutes since midnight so the snap, the layout
 * and the drags are plain arithmetic and never touch a `Date` (no time zones, no daylight-saving surprises).
 */
import { addDays, dayNumber, fromDayNumber } from "./date-utils.ts";

/** Blocks snap to this many minutes. */
export const SLOT = 15;
export const DAY_MINUTES = 24 * 60;

const pad = (n: number) => String(n).padStart(2, "0");

export function snap(minutes: number, step = SLOT): number {
  return Math.round(minutes / step) * step;
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** `10:30` for 630. */
export function clock(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** `2026-10-21T10:30` for a date and 630 minutes. */
export function stamp(date: string, minutes: number): string {
  return `${date}T${clock(minutes)}`;
}

/** The date and minutes of a `YYYY-MM-DDTHH:MM` time. */
export function unstamp(time: string): { date: string; minutes: number } {
  const [date, hm = "00:00"] = time.split("T");
  const [h, m] = hm.split(":").map(Number);
  return { date, minutes: h * 60 + m };
}

/** `10:30` out of a time (or `""` for an all-day date). */
export function timeOf(time: string): string {
  return time.includes("T") ? time.split("T")[1] : "";
}

/** `HH:MM` typed in a time box to minutes, or null when it is not a time. */
export function parseClock(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2])];
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** A block of time as the layout needs it. */
export interface Span {
  id: string;
  start: number;
  end: number;
}

/**
 * Lays overlapping blocks of one day side by side. Blocks that touch through a chain of overlaps share a cluster and
 * its width is split into as many columns as the cluster needs; each block takes the first column that is free.
 * (Blocks that merely end when another begins don't overlap.)
 */
export function layoutDay(spans: Span[]): Map<string, { column: number; columns: number }> {
  const out = new Map<string, { column: number; columns: number }>();
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: { span: Span; column: number }[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const columns = Math.max(0, ...cluster.map((c) => c.column + 1));
    for (const c of cluster) out.set(c.span.id, { column: c.column, columns });
    cluster = [];
  };
  const columnEnds: number[] = [];
  for (const span of sorted) {
    if (cluster.length > 0 && span.start >= clusterEnd) {
      flush();
      columnEnds.length = 0;
    }
    let column = columnEnds.findIndex((end) => end <= span.start);
    if (column < 0) column = columnEnds.length;
    columnEnds[column] = span.end;
    cluster.push({ span, column });
    clusterEnd = Math.max(clusterEnd < 0 || cluster.length === 1 ? span.end : clusterEnd, span.end);
  }
  flush();
  return out;
}

/** A time as minutes since 1970-01-01 00:00, so a block that crosses midnight is plain arithmetic. */
export function absOf(time: string): number {
  const { date, minutes } = unstamp(time);
  return dayNumber(date) * DAY_MINUTES + minutes;
}

/** The time of an absolute minute (a multiple of the slot is a clean `HH:MM`). */
export function timeFromAbs(abs: number): string {
  const day = Math.floor(abs / DAY_MINUTES);
  return stamp(fromDayNumber(day), abs - day * DAY_MINUTES);
}

/** The same for the end of a block: one that ends exactly at midnight ends at `24:00` of its own day, not `00:00` of the next. */
export function endFromAbs(abs: number): string {
  const day = Math.floor(abs / DAY_MINUTES);
  const minutes = abs - day * DAY_MINUTES;
  return minutes === 0 ? `${fromDayNumber(day - 1)}T24:00` : stamp(fromDayNumber(day), minutes);
}

/** What a drag of a block changes, in absolute minutes: moving shifts both ends (across days too), resizing only the end. */
export function dragSpan(
  mode: "move" | "resize",
  start: number,
  end: number,
  deltaMinutes: number,
): { start: number; end: number } {
  if (mode === "resize") return { start, end: Math.max(snap(end + deltaMinutes), start + SLOT) };
  const moved = snap(start + deltaMinutes);
  return { start: moved, end: moved + (end - start) };
}

/**
 * An entry's start and end moved by a drag of `minutes` (a timed entry, across days too) or of `days` (an all-day one,
 * which only moves by whole days).
 */
export function shiftEntry(
  entry: { start: string; end: string; allDay: boolean },
  minutes: number,
  days: number,
): { start: string; end: string } {
  if (entry.allDay) return { start: addDays(entry.start, days), end: addDays(entry.end, days) };
  return {
    start: timeFromAbs(absOf(entry.start) + minutes),
    end: endFromAbs(absOf(entry.end) + minutes),
  };
}

type Scope = "this" | "following" | "all";

/**
 * What a change to several selected entries sends to Rust, each with its own scope: a plain entry always acts on itself
 * (`all`); of the occurrences of one series, «all» acts once, «following» once from the earliest one (it already reaches
 * the later ones, whose series would no longer exist after the cut) and «this» on each.
 */
export function planBatch<
  T extends { entry: { id: string; occurrence: string | null; repeat: unknown } },
>(items: T[], scope: Scope): (T & { scope: Scope })[] {
  const taken = new Map<string, T & { scope: Scope }>();
  const out: (T & { scope: Scope })[] = [];
  for (const item of items) {
    const { id, occurrence, repeat } = item.entry;
    if (!repeat) {
      out.push({ ...item, scope: "all" });
      continue;
    }
    const planned = { ...item, scope };
    const earlier = taken.get(id);
    if (scope === "this") out.push(planned);
    else if (!earlier) {
      taken.set(id, planned);
      out.push(planned);
    } else if (scope === "following" && (occurrence ?? "") < (earlier.entry.occurrence ?? "")) {
      out[out.indexOf(earlier)] = planned;
      taken.set(id, planned);
    }
  }
  return out;
}

/** The days a possibly multi-day all-day entry covers inside `from..=to`, for the chips of a week or month. */
export function daysOf(start: string, end: string, from: string, to: string): string[] {
  const out: string[] = [];
  const last = end < to ? end : to;
  for (let d = start < from ? from : start; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The fields of an entry that `placeCopy` moves. */
export interface CopySource {
  start: string;
  end: string;
  allDay: boolean;
  repeat: unknown;
}

/**
 * Copies of several entries as one block: the earliest is placed like `placeCopy` and the others keep their distance
 * from it (in days for an all-day entry, in minutes for a timed one).
 */
export function placeGroup<T extends CopySource>(
  srcs: T[],
  date: string,
  minutes: number | null,
): T[] {
  const first = srcs.reduce((a, b) => (b.start < a.start ? b : a));
  const placed = placeCopy(first, date, minutes);
  const days = dayNumber(placed.start.slice(0, 10)) - dayNumber(first.start.slice(0, 10));
  const shift = first.allDay ? days * DAY_MINUTES : absOf(placed.start) - absOf(first.start);
  return srcs.map((s) =>
    s === first ? placed : { ...s, repeat: null, ...shiftEntry(s, shift, days) },
  );
}

/**
 * A one-off copy of `src` moved to `date` (a timed one also to minute `minutes` of it, or keeping its own time of day
 * when that is null), with the same length. A repeating entry is copied as a single appointment.
 */
export function placeCopy<T extends CopySource>(src: T, date: string, minutes: number | null): T {
  const copy = { ...src, repeat: null };
  if (src.allDay) {
    const span = dayNumber(src.end) - dayNumber(src.start);
    return { ...copy, start: date, end: fromDayNumber(dayNumber(date) + span) };
  }
  const length = absOf(src.end) - absOf(src.start);
  const from = minutes ?? unstamp(src.start).minutes;
  return {
    ...copy,
    start: stamp(date, from),
    end: endFromAbs(dayNumber(date) * DAY_MINUTES + from + length),
  };
}
