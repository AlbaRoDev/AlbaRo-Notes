import { useEffect, useMemo, useRef, useState } from "react";
import { WEEKDAYS, dayNumber, todayIso } from "../../lib/date-utils";
import {
  DAY_MINUTES,
  SLOT,
  absOf,
  clamp,
  clock,
  dragSpan,
  endFromAbs,
  layoutDay,
  snap,
  stamp,
  timeFromAbs,
} from "../../lib/calendar";
import { hasDragItem, readDragItem } from "../../lib/drag-item";
import type { CalendarEntry, Deadline, EntryInput } from "../../types";
import { keyOf, toInput } from "./entry-input";

/** Pixels per hour: 15 minutes are 12 px. */
const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;
/** A press that moves less than this is a click, not a drag. */
const CLICK_SLOP = 4;
const FIRST_VISIBLE_HOUR = 7;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

interface Preview {
  /** The entry being dragged (none while creating). */
  id: string | null;
  /** Absolute minutes (see `absOf`): a block can cross midnight. */
  start: number;
  end: number;
}

const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = WEEKDAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
  return { weekday, day: d };
};

/**
 * The day and week views: a column per day with an hour axis, an all-day strip above. Drag on an empty
 * stretch to make a block, drag a block to move it (to another day too) and its bottom edge to stretch it — all
 * snapping to 15 minutes — or drop a task from the tray to schedule it where it lands.
 */
export function TimeGrid({
  days,
  entries,
  deadlines,
  selectedId,
  onSelect,
  onOpenDay,
  onCreate,
  onCreateAllDay,
  onChange,
  onDropTask,
}: {
  days: string[];
  entries: CalendarEntry[];
  deadlines: Deadline[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpenDay: (date: string) => void;
  onCreate: (input: EntryInput) => void;
  /** A double click on a day of the all-day strip. */
  onCreateAllDay: (date: string) => void;
  onChange: (entry: CalendarEntry, input: EntryInput) => void;
  /** A task dropped on a day: at a time (a one-hour block) or, with `null`, as an all-day entry. */
  onDropTask: (taskId: string, date: string, start: number | null) => void;
}) {
  const today = todayIso();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ghost, setGhost] = useState<{ date: string; start: number } | null>(null);
  const [allDayOver, setAllDayOver] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const scrollRef = useRef<HTMLDivElement>(null);
  const columns = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = FIRST_VISIBLE_HOUR * HOUR_PX;
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  /** The column under a screen x (the nearest one past the edges) and the minutes under a screen y. */
  const locate = (clientX: number, clientY: number) => {
    let best: { date: string; rect: DOMRect } | null = null;
    for (const [date, el] of columns.current) {
      const rect = el.getBoundingClientRect();
      if (
        !best ||
        Math.abs(clientX - (rect.left + rect.width / 2)) <
          Math.abs(clientX - (best.rect.left + best.rect.width / 2))
      )
        best = { date, rect };
    }
    return best ? { date: best.date, minutes: (clientY - best.rect.top) / PX_PER_MIN } : null;
  };

  /** Follows the pointer until it is released; `move` gets every position, `done` the final one (and whether it was a click). */
  const track = (
    e: React.PointerEvent,
    move: (x: number, y: number, dx: number, dy: number) => void,
    done: (clicked: boolean) => void,
  ) => {
    e.preventDefault();
    const [x0, y0] = [e.clientX, e.clientY];
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const [dx, dy] = [ev.clientX - x0, ev.clientY - y0];
      if (!moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
      moved = true;
      move(ev.clientX, ev.clientY, dx, dy);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      done(!moved);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const startCreate = (e: React.PointerEvent<HTMLDivElement>, date: string) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return; // a block takes its own presses
    const at = locate(e.clientX, e.clientY);
    if (!at) return;
    const anchor = clamp(Math.floor(at.minutes / SLOT) * SLOT, 0, 24 * 60 - SLOT);
    const midnight = dayNumber(date) * DAY_MINUTES;
    let span = { start: anchor, end: Math.min(anchor + 60, 24 * 60) };
    track(
      e,
      (_x, y) => {
        const here = locate(e.clientX, y)?.minutes ?? anchor;
        const cursor = clamp(snap(here), 0, 24 * 60);
        span =
          cursor >= anchor
            ? { start: anchor, end: Math.max(cursor, anchor + SLOT) }
            : { start: Math.min(cursor, anchor - SLOT), end: anchor };
        setPreview({ id: null, start: midnight + span.start, end: midnight + span.end });
      },
      (clicked) => {
        // dragging makes the length you drag; a single click only deselects (a double click makes the appointment)
        setPreview(null);
        onSelect(null);
        if (clicked) return;
        createTimed(date, span.start, span.end);
      },
    );
  };

  /** A new appointment on `date` from minute `start` to minute `end` of that day (`end` may be 24:00). */
  const createTimed = (date: string, start: number, end: number) =>
    onCreate({
      taskId: null,
      title: "Nueva cita",
      start: stamp(date, start),
      end: endFromAbs(dayNumber(date) * DAY_MINUTES + end),
      allDay: false,
      color: null,
      location: null,
      note: null,
      repeat: null,
    });

  /** A double click on empty space: a one-hour appointment at the time pressed (as in Notion). */
  const createAt = (e: React.MouseEvent<HTMLDivElement>, date: string) => {
    if (e.target !== e.currentTarget) return;
    const at = locate(e.clientX, e.clientY);
    if (!at) return;
    const start = clamp(Math.floor(at.minutes / SLOT) * SLOT, 0, 24 * 60 - SLOT);
    createTimed(date, start, Math.min(start + 60, 24 * 60));
  };

  /** `grabDate` is the day of the segment that was pressed (a block across midnight has one in each column). */
  const startDrag = (
    e: React.PointerEvent,
    entry: CalendarEntry,
    mode: "move" | "resize",
    grabDate: string,
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const from = absOf(entry.start);
    const to = absOf(entry.end);
    let last: Preview = { id: keyOf(entry), start: from, end: to };
    track(
      e,
      (x, y, _dx, dy) => {
        const days =
          mode === "move" ? dayNumber(locate(x, y)?.date ?? grabDate) - dayNumber(grabDate) : 0;
        last = {
          id: keyOf(entry),
          ...dragSpan(mode, from, to, dy / PX_PER_MIN + days * DAY_MINUTES),
        };
        setPreview(last);
      },
      (clicked) => {
        setPreview(null);
        if (clicked) return onSelect(keyOf(entry));
        if (last.start !== from || last.end !== to)
          onChange(entry, {
            ...toInput(entry),
            start: timeFromAbs(last.start),
            end: endFromAbs(last.end),
          });
      },
    );
  };

  const timed = useMemo(() => entries.filter((e) => !e.allDay), [entries]);
  const allDay = useMemo(() => entries.filter((e) => e.allDay), [entries]);

  /** The part of each timed block that falls on one day (a block across midnight has a piece in each), the one being dragged shown where it would land. */
  const blocksOf = (date: string) => {
    const dayStart = dayNumber(date) * DAY_MINUTES;
    const dayEnd = dayStart + DAY_MINUTES;
    const shown = timed
      .map((entry) =>
        preview?.id === keyOf(entry)
          ? { entry, from: preview.start, to: preview.end }
          : { entry, from: absOf(entry.start), to: absOf(entry.end) },
      )
      .filter((b) => b.from < dayEnd && b.to > dayStart)
      .map((b) => ({
        entry: b.entry,
        start: Math.max(b.from, dayStart) - dayStart,
        end: Math.min(b.to, dayEnd) - dayStart,
        label: `${clock(((b.from % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES)}–${clock(((b.to % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES)}`,
        before: b.from < dayStart,
        after: b.to > dayEnd,
      }));
    const layout = layoutDay(
      shown.map((b) => ({ id: keyOf(b.entry), start: b.start, end: b.end })),
    );
    return shown.map((b) => ({
      ...b,
      ...(layout.get(keyOf(b.entry)) ?? { column: 0, columns: 1 }),
    }));
  };

  /** The block being made by dragging on an empty stretch, on the day it falls on. */
  const creating = (date: string) => {
    if (!preview || preview.id !== null) return null;
    const dayStart = dayNumber(date) * DAY_MINUTES;
    return preview.start >= dayStart && preview.start < dayStart + DAY_MINUTES
      ? { start: preview.start - dayStart, end: preview.end - dayStart }
      : null;
  };

  const dropOn = (e: React.DragEvent, date: string, start: number | null) => {
    setGhost(null);
    setAllDayOver(null);
    const item = readDragItem(e);
    if (!item) return;
    e.preventDefault();
    if (item.kind === "task") onDropTask(item.id, date, start);
  };

  return (
    <div className="cal-grid" style={{ "--cal-days": days.length } as React.CSSProperties}>
      <div className="cal-head">
        <div className="cal-gutter" />
        {days.map((date) => {
          const { weekday, day } = dayLabel(date);
          return (
            <button
              key={date}
              type="button"
              className="cal-day-head"
              data-today={date === today || undefined}
              onClick={() => onOpenDay(date)}
            >
              <span>{weekday}</span>
              <strong>{day}</strong>
            </button>
          );
        })}
      </div>

      <div className="cal-allday">
        <div className="cal-gutter cal-gutter-label">todo el día</div>
        {days.map((date) => (
          <div
            key={date}
            className="cal-allday-cell"
            data-over={allDayOver === date || undefined}
            onDoubleClick={(e) =>
              !(e.target as HTMLElement).closest("button, .cal-deadline") && onCreateAllDay(date)
            }
            onDragOver={(e) => {
              if (!hasDragItem(e)) return;
              e.preventDefault();
              setAllDayOver(date);
            }}
            onDragLeave={() => setAllDayOver(null)}
            onDrop={(e) => dropOn(e, date, null)}
          >
            {deadlines
              .filter((d) => d.date === date)
              .map((d) => (
                <div key={d.taskId} className="cal-deadline" title={`Fecha límite: ${d.title}`}>
                  ⚑ {d.title}
                </div>
              ))}
            {allDay
              .filter((e) => e.start <= date && e.end >= date)
              .map((entry) => (
                <button
                  key={keyOf(entry)}
                  type="button"
                  className="cal-chip"
                  data-color={entry.color ?? undefined}
                  data-selected={keyOf(entry) === selectedId || undefined}
                  onClick={() => onSelect(keyOf(entry))}
                >
                  {entry.repeat ? "↻ " : ""}
                  {entry.title}
                </button>
              ))}
          </div>
        ))}
      </div>

      <div className="cal-scroll" ref={scrollRef}>
        <div className="cal-body" style={{ height: 24 * HOUR_PX }}>
          <div className="cal-gutter cal-hours">
            {HOURS.map((h) => (
              <span key={h} style={{ top: h * HOUR_PX }}>
                {h === 0 ? "" : clock(h * 60)}
              </span>
            ))}
          </div>
          {days.map((date) => (
            <div
              key={date}
              className="cal-col"
              data-today={date === today || undefined}
              ref={(el) => {
                if (el) columns.current.set(date, el);
                else columns.current.delete(date);
              }}
              onPointerDown={(e) => startCreate(e, date)}
              onDoubleClick={(e) => createAt(e, date)}
              onDragOver={(e) => {
                if (!hasDragItem(e)) return;
                e.preventDefault();
                const at = locate(e.clientX, e.clientY);
                if (at)
                  setGhost({
                    date,
                    start: clamp(Math.floor(at.minutes / SLOT) * SLOT, 0, 23 * 60),
                  });
              }}
              onDragLeave={() => setGhost(null)}
              onDrop={(e) => dropOn(e, date, ghost?.date === date ? ghost.start : null)}
            >
              {date === today && (
                <div
                  className="cal-now"
                  style={{ top: (now.getHours() * 60 + now.getMinutes()) * PX_PER_MIN }}
                />
              )}
              {blocksOf(date).map(
                ({ entry, start, end, label, before, after, column, columns: cols }) => (
                  <div
                    key={keyOf(entry)}
                    className="cal-block"
                    data-color={entry.color ?? undefined}
                    data-task={entry.taskId ? "" : undefined}
                    data-selected={keyOf(entry) === selectedId || undefined}
                    data-dragging={preview?.id === keyOf(entry) || undefined}
                    data-before={before || undefined}
                    data-after={after || undefined}
                    style={{
                      top: start * PX_PER_MIN,
                      height: Math.max((end - start) * PX_PER_MIN, 14),
                      left: `${(column / cols) * 100}%`,
                      width: `${100 / cols}%`,
                    }}
                    onPointerDown={(e) => startDrag(e, entry, "move", date)}
                  >
                    <strong>
                      {entry.repeat ? "↻ " : ""}
                      {entry.title}
                    </strong>
                    <span>
                      {label}
                      {entry.location ? ` · ${entry.location}` : ""}
                    </span>
                    {!after && (
                      <div
                        className="cal-resize"
                        onPointerDown={(e) => startDrag(e, entry, "resize", date)}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                ),
              )}
              {creating(date) && (
                <div
                  className="cal-block cal-block-new"
                  style={{
                    top: creating(date)!.start * PX_PER_MIN,
                    height: (creating(date)!.end - creating(date)!.start) * PX_PER_MIN,
                  }}
                >
                  <span>
                    {clock(creating(date)!.start)}–{clock(creating(date)!.end % DAY_MINUTES)}
                  </span>
                </div>
              )}
              {ghost && ghost.date === date && (
                <div
                  className="cal-block cal-block-new"
                  style={{ top: ghost.start * PX_PER_MIN, height: HOUR_PX }}
                >
                  <span>{clock(ghost.start)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
