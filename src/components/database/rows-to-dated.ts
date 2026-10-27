import { splitRange } from "../../lib/date-utils";
import type { DatabaseRow, Property } from "../../types";
import type { DatedItem, UndatedItem } from "../views/view-items";

/** Splits rows into dated entries (a range spans days) and the ones without a date. */
export function rowsToDated(
  rows: DatabaseRow[],
  dateProp: Property,
): { items: DatedItem[]; undated: UndatedItem[] } {
  const items: DatedItem[] = [];
  const undated: UndatedItem[] = [];
  for (const row of rows) {
    const range = splitRange(row.values[dateProp.id]);
    if (range) items.push({ id: row.pageId, title: row.title, start: range.start, end: range.end });
    else undated.push({ id: row.pageId, title: row.title });
  }
  return { items, undated };
}
