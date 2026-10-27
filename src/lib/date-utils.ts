/**
 * Calendar-day helpers on ISO strings (`2026-10-15`). Everything goes through UTC
 * day numbers, so daylight-saving changes and the user's time zone can never
 * shift a day. A date property may hold a range (`start/end`, like Notion).
 */

export const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

/** Weeks start on Monday. */
export const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

const DAY_MS = 86_400_000;

/** Days since 1970-01-01. */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** Today in the user's own calendar. */
export function todayIso(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export const addDays = (iso: string, days: number) => fromDayNumber(dayNumber(iso) + days);

/** Monday of the week containing `iso` (1970-01-01 was a Thursday). */
function mondayOf(iso: string): string {
  const n = dayNumber(iso);
  return fromDayNumber(n - ((((n + 3) % 7) + 7) % 7));
}

/** The 7 days of the week containing `iso`. */
export function weekDays(iso: string): string[] {
  const monday = dayNumber(mondayOf(iso));
  return Array.from({ length: 7 }, (_, i) => fromDayNumber(monday + i));
}

/** Whole weeks (Monday first) that cover a month; `month` is 1-12. */
export function monthGrid(year: number, month: number): string[][] {
  const first = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = `${first.slice(0, 8)}${String(lastDay).padStart(2, "0")}`;
  const start = dayNumber(mondayOf(first));
  const end = dayNumber(mondayOf(last)) + 6;
  const weeks: string[][] = [];
  for (let n = start; n <= end; n += 7)
    weeks.push(Array.from({ length: 7 }, (_, i) => fromDayNumber(n + i)));
  return weeks;
}

/** `{ start, end }` of a date value (end = start for a single day), or null when empty. */
export function splitRange(value: unknown): { start: string; end: string } | null {
  if (typeof value !== "string" || !value) return null;
  const [start, end] = value.split("/");
  return { start, end: end || start };
}

export function formatMonthYear(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** `15 oct` — for timeline ticks. */
export function formatDayMonth(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3).toLowerCase()}`;
}
