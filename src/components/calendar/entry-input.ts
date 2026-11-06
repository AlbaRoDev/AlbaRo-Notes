import type { CalendarEntry, EntryInput } from "../../types";
import type { KeyboardEvent } from "react";

/** The whole entry as Rust takes it back (a scheduled task's title is its own name in the calendar: the task keeps its title). */
export function toInput(entry: CalendarEntry): EntryInput {
  return {
    taskId: entry.taskId,
    title: entry.title,
    start: entry.start,
    end: entry.end,
    allDay: entry.allDay,
    color: entry.color,
    location: entry.location,
    note: entry.note,
    repeat: entry.repeat,
  };
}

/** The entry as it will look once `input` is saved (what the panel shows while the change waits to be confirmed). */
export function withInput(entry: CalendarEntry, input: EntryInput): CalendarEntry {
  const { title, start, end, allDay, color, location, note } = input;
  return { ...entry, title: title ?? entry.title, start, end, allDay, color, location, note };
}

/** Occurrences of one series share an id, so each is told apart by the day it starts on. */
export function keyOf(entry: CalendarEntry): string {
  return entry.occurrence ? `${entry.id}@${entry.occurrence}` : entry.id;
}

/** Ctrl/⌘ or Shift held on a click: it adds the entry to the selection (or takes it out) instead of replacing it. */
export function isAdditive(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
  return e.ctrlKey || e.metaKey || e.shiftKey;
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

/**
 * Dragging over empty space makes an appointment, but only with a mouse or a pen. A finger dragging is scrolling:
 * on a touch screen the appointment comes from a double tap (a one-hour one, as with a double click).
 */
export function dragCreates(pointerType: string): boolean {
  return pointerType !== "touch";
}
