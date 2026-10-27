import type { CalendarEntry, EntryInput } from "../../types";
import type { KeyboardEvent } from "react";

/** The whole entry as Rust takes it back (a scheduled task sends no title: it is the task's). */
export function toInput(entry: CalendarEntry): EntryInput {
  return {
    taskId: entry.taskId,
    title: entry.taskId ? null : entry.title,
    start: entry.start,
    end: entry.end,
    allDay: entry.allDay,
    color: entry.color,
    location: entry.location,
    note: entry.note,
    repeat: entry.repeat,
  };
}

/** Occurrences of one series share an id, so each is told apart by the day it starts on. */
export function keyOf(entry: CalendarEntry): string {
  return entry.occurrence ? `${entry.id}@${entry.occurrence}` : entry.id;
}

/**
 * Enter ends the edit of a field and hands the focus back to the calendar. Just blurring would leave it on nothing,
 * and then Supr could not reach the calendar to delete the selected entry.
 */
export function leaveOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== "Enter") return;
  const calendar = e.currentTarget.closest<HTMLElement>(".cal");
  if (calendar) calendar.focus();
  else e.currentTarget.blur();
}
