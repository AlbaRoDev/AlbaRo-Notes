import { dayNumber, fromDayNumber } from "../../lib/date-utils";

/** An entry laid out on a calendar or timeline. A single day has `end === start`. */
export interface DatedItem {
  id: string;
  title: string;
  start: string;
  end: string;
}

/** An item with no usable date: listed apart so it isn't lost. */
export interface UndatedItem {
  id: string;
  title: string;
}

/** A calendar event / timeline item as the standalone blocks store it in the page document. */
export interface StoredEvent {
  id: string;
  title: string;
  start: string;
  /** Absent for a single day. */
  end?: string;
}

/** A map pin as the standalone map block stores it. */
export interface StoredPin {
  id: string;
  title: string;
  lat: number;
  lng: number;
}

/** A standalone chart block's entry: a label and a number (null while still empty). */
export interface StoredEntry {
  id: string;
  title: string;
  value: number | null;
}

/** Mirrors the caps in validate.rs — Rust re-checks everything on save. */
export const MAX_ITEMS = 500;
export const MAX_CHART_ENTRIES = 100;
export const MAX_CHART_VALUE = 1e15;
export const MAX_ITEM_TITLE = 200;

/** A real calendar day (rejects 2026-02-30), not just something shaped like one. */
function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return fromDayNumber(dayNumber(value)) === value;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function cleanTitle(value: unknown): string | null {
  return typeof value === "string" && value.length <= MAX_ITEM_TITLE ? value : null;
}

/**
 * Whatever came out of pasted HTML or an old document becomes a valid list or
 * nothing: Rust refuses a page with one malformed item, which would make it
 * impossible to save, so bad entries are dropped here instead.
 */
export function sanitizeEvents(raw: unknown): StoredEvent[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: StoredEvent[] = [];
  for (const item of raw.slice(0, MAX_ITEMS)) {
    if (!isRecord(item)) continue;
    const title = cleanTitle(item.title);
    if (
      typeof item.id !== "string" ||
      seen.has(item.id) ||
      title === null ||
      !isIsoDate(item.start)
    )
      continue;
    const end = item.end === undefined || item.end === null ? undefined : item.end;
    if (end !== undefined && (!isIsoDate(end) || end < item.start)) continue;
    seen.add(item.id);
    out.push({ id: item.id, title, start: item.start, ...(end ? { end } : {}) });
  }
  return out;
}

export function sanitizeEntries(raw: unknown): StoredEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: StoredEntry[] = [];
  for (const item of raw.slice(0, MAX_CHART_ENTRIES)) {
    if (!isRecord(item)) continue;
    const title = cleanTitle(item.title);
    const { id, value } = item;
    if (typeof id !== "string" || seen.has(id) || title === null) continue;
    if (
      value !== null &&
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_CHART_VALUE)
    )
      continue;
    seen.add(id);
    out.push({ id, title, value: value ?? null });
  }
  return out;
}

export function sanitizePins(raw: unknown): StoredPin[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: StoredPin[] = [];
  for (const item of raw.slice(0, MAX_ITEMS)) {
    if (!isRecord(item)) continue;
    const title = cleanTitle(item.title);
    const { id, lat, lng } = item;
    if (typeof id !== "string" || seen.has(id) || title === null) continue;
    if (
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    )
      continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    seen.add(id);
    out.push({ id, title, lat, lng });
  }
  return out;
}

/** The shape the views draw. */
export function toDatedItems(events: StoredEvent[]): DatedItem[] {
  return events.map((e) => ({
    id: e.id,
    title: e.title || "Sin título",
    start: e.start,
    end: e.end ?? e.start,
  }));
}
