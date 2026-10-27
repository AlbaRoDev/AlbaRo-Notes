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

/** The days a possibly multi-day all-day entry covers inside `from..=to`, for the chips of a week or month. */
export function daysOf(start: string, end: string, from: string, to: string): string[] {
  const out: string[] = [];
  const last = end < to ? end : to;
  for (let d = start < from ? from : start; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}
