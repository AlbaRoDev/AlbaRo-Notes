import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SquareCheck } from "lucide-react";
import { WEEKDAYS, dayNumber, todayIso } from "../../lib/date-utils";
import {
  DAY_MINUTES,
  SLOT,
  absOf,
  clamp,
  clock,
  dragSpan,
  edgeDirection,
  edgeSpeed,
  endFromAbs,
  layoutDay,
  shiftEntry,
  snap,
  stamp,
  timeFromAbs,
} from "../../lib/calendar";
import { hasDragItem, readDragItem } from "../../lib/drag-item";
import type { CalendarEntry, Deadline, EntryInput } from "../../types";
import { dragCreates, isAdditive, keyOf, toInput } from "./entry-input";
import { TaskChecklist } from "../boards/TaskChecklist";
import { t } from "../../lib/i18n.ts";
import { useSizeClass } from "../../lib/viewport.ts";

/** Pixels per hour: 15 minutes are 12 px. */
const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;
/** A press that moves less than this is a click, not a drag. */
const CLICK_SLOP = 4;
const FIRST_VISIBLE_HOUR = 7;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
/** A block at least this tall (px) has room for the task's checklist under its title and time. */
const LIST_MIN_PX = 90;
/** The shortest a block is drawn (a 15-minute one is 12 px); below `SHORT_PX` it drops its padding to fit one line. */
const MIN_BLOCK_PX = 16;
const SHORT_PX = 30;
/**
 * Holding a block within `EDGE_PX` of the grid's side (or past it) scrolls the days: after `SCROLL_DELAY` ms one day every
 * `SLOW_STEP` ms, down to `FAST_STEP` ms the further past the edge. Each step slides the columns over its own length.
 */
const EDGE_PX = 56;
const SCROLL_DELAY = 250;
const SLOW_STEP = 420;
const FAST_STEP = 130;

interface Preview {
  /** The entry being dragged (none while creating). */
  id: string | null;
  /** Absolute minutes (see `absOf`): a block can cross midnight. */
  start: number;
  end: number;
  /** Set when the dragged block is one of a selection: the others move by the same amount. */
  group?: { minutes: number; days: number };
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
  selectedIds,
  showLists,
  onSelect,
  onPoint,
  onOpenDay,
  onCreate,
  onCreateAllDay,
  onChange,
  onChangeMany,
  onDropTask,
  onSlide,
}: {
  /** A block is held at the side of the grid: the days scroll by one (-1 earlier, 1 later). */
  onSlide: (dir: -1 | 1) => void;
  days: string[];
  entries: CalendarEntry[];
  deadlines: Deadline[];
  selectedIds: Set<string>;
  /** Show a task's checklist inside its block when the block is tall enough. */
  showLists: boolean;
  /** `additive`: Ctrl/⌘/Shift was held, so the entry joins the selection (or leaves it) instead of replacing it. */
  onSelect: (id: string | null, additive?: boolean) => void;
  /** The grid was pressed on an empty spot: where a paste lands (minutes are null in the all-day strip). */
  onPoint: (date: string, minutes: number | null) => void;
  onOpenDay: (date: string) => void;
  onCreate: (input: EntryInput) => void;
  /** A double click on a day of the all-day strip. */
  onCreateAllDay: (date: string) => void;
  onChange: (entry: CalendarEntry, input: EntryInput) => void;
  /** A block of a multi-selection was dragged: all of them moved by the same amount. */
  onChangeMany: (moves: { entry: CalendarEntry; input: EntryInput }[]) => void;
  /** A task dropped on a day: at a time (a one-hour block) or, with `null`, as an all-day entry. */
  onDropTask: (taskId: string, date: string, start: number | null) => void;
}) {
  const today = todayIso();
  const [preview, setPreview] = useState<Preview | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const repage = useRef<(() => void) | null>(null);
  const slide = useRef<{ dir: -1 | 1; ms: number } | null>(null);
  const sliding = useRef<{ dir: -1 | 1; ms: number; w: number; at: number } | null>(null);
  // The days scrolled by one under a held block: the columns slide over the step (so the calendar flows instead of
  // jumping) and the block is placed again where the pointer now is, staying put on screen while they pass under it.
  useLayoutEffect(() => {
    const moved = slide.current;
    slide.current = null;
    const grid = root.current;
    if (moved && grid) {
      const w = grid.querySelector(".cal-col")?.getBoundingClientRect().width ?? 0;
      grid.querySelectorAll(".cal-block[data-dragging]").forEach((el) => {
        for (const a of el.getAnimations()) a.cancel();
      });
      for (const el of grid.querySelectorAll(".cal-day-head, .cal-allday-cell, .cal-col"))
        el.animate([{ transform: `translateX(${moved.dir * w}px)` }, { transform: "none" }], {
          duration: moved.ms,
          easing: "linear",
        });
      sliding.current = { ...moved, w, at: performance.now() };
    }
    repage.current?.();
  }, [days]);
  // the dragged blocks appear (placed again) after the slide began: they undo what is left of it
  useLayoutEffect(() => {
    const s = sliding.current;
    if (!s) return;
    const left = s.ms - (performance.now() - s.at);
    if (left <= 0) return;
    root.current?.querySelectorAll(".cal-block[data-dragging]").forEach((el) => {
      if (el.getAnimations().length) return;
      el.animate(
        [{ transform: `translateX(${(-s.dir * s.w * left) / s.ms}px)` }, { transform: "none" }],
        { duration: left, easing: "linear" },
      );
    });
  }, [preview]);
  // the blocks being dragged stay drawn after the days scroll to a range that does not list them
  const [carried, setCarried] = useState<CalendarEntry[]>([]);
  const [ghost, setGhost] = useState<{ date: string; start: number } | null>(null);
  const [allDayOver, setAllDayOver] = useState<string | null>(null);
  // tasks whose checklist is folded in their blocks (a view state, not saved)
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const toggleFolded = (taskId: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (!next.delete(taskId)) next.add(taskId);
      return next;
    });
  const [now, setNow] = useState(() => new Date());
  const scrollRef = useRef<HTMLDivElement>(null);
  const columns = useRef(new Map<string, HTMLDivElement>());

  // On a narrow screen the grid is as tall as the day and the page scrolls (not a box inside the page): it opens
  // with the page scrolled to the first visible hour, the day headers kept in view by CSS.
  const compact = useSizeClass() !== "expanded";
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    if (!compact) {
      box.scrollTop = FIRST_VISIBLE_HOUR * HOUR_PX;
      return;
    }
    const head = box.parentElement?.querySelector<HTMLElement>(".cal-head")?.offsetHeight ?? 0;
    const bar = document.querySelector<HTMLElement>(".workspace-bar")?.offsetHeight ?? 0;
    window.scrollTo(
      0,
      box.getBoundingClientRect().top + window.scrollY + FIRST_VISIBLE_HOUR * HOUR_PX - head - bar,
    );
    // only when the grid appears: moving between weeks keeps where the person is
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Cancelling the press keeps the browser from moving the focus, so a field being typed in (the panel's title) would
    // stay focused until the entry is dropped from under it — and a removed field never saves. Leave it now instead.
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
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
    onPoint(date, anchor);
    if (!dragCreates(e.pointerType)) return; // a finger dragging here scrolls the page
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
      title: t("Nueva cita"),
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
    const additive = isAdditive(e);
    // dragging one block of a selection drags them all
    const together = mode === "move" && selectedIds.size > 1 && selectedIds.has(keyOf(entry));
    const moving = together ? entries.filter((x) => selectedIds.has(keyOf(x))) : [entry];
    if (mode === "move") setCarried(moving);
    let last: Preview = { id: keyOf(entry), start: from, end: to };
    let dayShift = 0;
    // Holding the block at a side of the grid scrolls the calendar a day at a time (each step slides, see `slide`), faster
    // the further past the edge it is, so it can go on into the next weeks and not only to a day in view.
    let edge: -1 | 0 | 1 = 0;
    let pointerX = 0;
    let scroller: number | undefined;
    const stopScrolling = () => {
      window.clearTimeout(scroller);
      edge = 0;
    };
    /** The grid's sides now (the columns change as the days scroll, so `days` of this render would be stale) and the zone that counts as the edge. */
    const sides = () => {
      const rects = [...columns.current.values()].map((el) => el.getBoundingClientRect());
      if (!rects.length) return null;
      return {
        left: Math.min(...rects.map((r) => r.left)),
        right: Math.max(...rects.map((r) => r.right)),
        // never more than half a column, or in a narrow window the middle of a column would count as the edge
        zone: Math.min(EDGE_PX, Math.min(...rects.map((r) => r.width)) / 2),
      };
    };
    const watchEdge = (x: number) => {
      pointerX = x;
      const s = sides();
      const dir = s ? edgeDirection(x, s.left, s.right, s.zone) : 0;
      if (dir === edge) return;
      stopScrolling();
      edge = dir;
      if (!dir) return;
      const step = () => {
        const now = sides();
        const speed = now ? edgeSpeed(pointerX, now.left, now.right, now.zone) : 0;
        const ms = SLOW_STEP - (SLOW_STEP - FAST_STEP) * speed;
        slide.current = { dir, ms };
        onSlide(dir);
        scroller = window.setTimeout(step, ms);
      };
      scroller = window.setTimeout(step, SCROLL_DELAY);
    };
    const follow = (x: number, y: number, dy: number) => {
      dayShift =
        mode === "move" ? dayNumber(locate(x, y)?.date ?? grabDate) - dayNumber(grabDate) : 0;
      const span = dragSpan(mode, from, to, dy / PX_PER_MIN + dayShift * DAY_MINUTES);
      last = {
        id: keyOf(entry),
        ...span,
        group: together ? { minutes: span.start - from, days: dayShift } : undefined,
      };
      setPreview(last);
    };
    track(
      e,
      (x, y, _dx, dy) => {
        if (mode === "move") {
          watchEdge(x);
          // the pointer stays put while the page turns: the columns under it change, so the block is placed again
          repage.current = () => follow(x, y, dy);
        }
        follow(x, y, dy);
      },
      (clicked) => {
        stopScrolling();
        repage.current = null;
        setPreview(null);
        setCarried([]);
        if (clicked) return onSelect(keyOf(entry), additive);
        if (last.start === from && last.end === to) return;
        if (last.group) {
          const { minutes, days: shifted } = last.group;
          onChangeMany(
            moving.map((x) => ({
              entry: x,
              input: { ...toInput(x), ...shiftEntry(x, minutes, shifted) },
            })),
          );
        } else
          onChange(entry, {
            ...toInput(entry),
            start: timeFromAbs(last.start),
            end: endFromAbs(last.end),
          });
      },
    );
  };

  const timed = useMemo(() => {
    const listed = new Set(entries.map(keyOf));
    return [...entries, ...carried.filter((c) => !listed.has(keyOf(c)))].filter((e) => !e.allDay);
  }, [entries, carried]);
  const allDay = useMemo(() => entries.filter((e) => e.allDay), [entries]);

  /** The part of each timed block that falls on one day (a block across midnight has a piece in each), the one being dragged shown where it would land. */
  const blocksOf = (date: string) => {
    const dayStart = dayNumber(date) * DAY_MINUTES;
    const dayEnd = dayStart + DAY_MINUTES;
    const shown = timed
      .map((entry) => {
        if (preview?.id === keyOf(entry)) return { entry, from: preview.start, to: preview.end };
        const [from, to] = [absOf(entry.start), absOf(entry.end)];
        // the other blocks of a selection travel with the one being dragged
        const shift = preview?.group && selectedIds.has(keyOf(entry)) ? preview.group.minutes : 0;
        return { entry, from: from + shift, to: to + shift };
      })
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
    <div
      className="cal-grid"
      ref={root}
      style={{ "--cal-days": days.length } as React.CSSProperties}
    >
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
        <div className="cal-gutter cal-gutter-label">{t("todo el día")}</div>
        {days.map((date) => (
          <div
            key={date}
            className="cal-allday-cell"
            data-over={allDayOver === date || undefined}
            onPointerDown={(e) => e.target === e.currentTarget && onPoint(date, null)}
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
                <div
                  key={d.taskId}
                  className="cal-deadline"
                  title={t("Fecha límite: {title}", { title: d.title })}
                >
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
                  data-selected={selectedIds.has(keyOf(entry)) || undefined}
                  onClick={(e) => onSelect(keyOf(entry), isAdditive(e))}
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
                    data-short={(end - start) * PX_PER_MIN < SHORT_PX || undefined}
                    data-selected={selectedIds.has(keyOf(entry)) || undefined}
                    data-dragging={
                      preview?.id === keyOf(entry) ||
                      (preview?.group && selectedIds.has(keyOf(entry))) ||
                      undefined
                    }
                    data-before={before || undefined}
                    data-after={after || undefined}
                    style={{
                      top: start * PX_PER_MIN,
                      height: Math.max((end - start) * PX_PER_MIN, MIN_BLOCK_PX),
                      left: `${(column / cols) * 100}%`,
                      width: `${100 / cols}%`,
                    }}
                    onPointerDown={(e) => startDrag(e, entry, "move", date)}
                  >
                    {/* title and time share the line when they fit; otherwise the time drops below (and is clipped in a short block) */}
                    <div className="cal-block-head">
                      <strong>
                        {entry.taskId && <SquareCheck size={13} aria-hidden="true" />}
                        {entry.repeat ? "↻ " : ""}
                        {entry.title}
                      </strong>
                      <span>
                        {label}
                        {entry.location ? ` · ${entry.location}` : ""}
                      </span>
                    </div>
                    {showLists && entry.taskId && (end - start) * PX_PER_MIN >= LIST_MIN_PX && (
                      // ticking an item must not start a drag of the block, but the rest of the area (the list may be short or
                      // empty) is still the block: a press there selects it
                      <div
                        className="cal-block-list"
                        onPointerDown={(e) =>
                          (e.target as HTMLElement).closest("button, input, label") &&
                          e.stopPropagation()
                        }
                      >
                        <TaskChecklist
                          taskId={entry.taskId}
                          compact
                          collapsed={folded.has(entry.taskId)}
                          onToggle={() => toggleFolded(entry.taskId!)}
                        />
                      </div>
                    )}
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
