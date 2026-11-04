import { Plus } from "lucide-react";
import { WEEKDAYS, monthGrid, todayIso } from "../../lib/date-utils";
import { daysOf, timeOf } from "../../lib/calendar";
import { hasDragItem, readDragItem } from "../../lib/drag-item";
import { useState } from "react";
import type { CalendarEntry, Deadline } from "../../types";
import { isAdditive, keyOf } from "./entry-input";
import { t } from "../../lib/i18n.ts";

/** Chips shown per day before «+N más». */
const SHOWN = 3;

/**
 * The month view: whole weeks of day cells, each with its entries as chips. A task dropped on a day becomes an
 * all-day entry; «+» on a day starts an appointment there; the number opens the day.
 */
export function MonthGrid({
  year,
  month,
  entries,
  deadlines,
  selectedIds,
  onSelect,
  onPoint,
  onOpenDay,
  onCreateOnDay,
  onDropTask,
}: {
  year: number;
  month: number;
  entries: CalendarEntry[];
  deadlines: Deadline[];
  selectedIds: Set<string>;
  /** `additive`: Ctrl/⌘/Shift was held, so the entry joins the selection (or leaves it). */
  onSelect: (id: string, additive?: boolean) => void;
  /** A day cell was pressed: where a paste lands. */
  onPoint: (date: string) => void;
  onOpenDay: (date: string) => void;
  onCreateOnDay: (date: string) => void;
  onDropTask: (taskId: string, date: string) => void;
}) {
  const weeks = monthGrid(year, month);
  const today = todayIso();
  const [over, setOver] = useState<string | null>(null);

  /** The entries of one day, all-day ones first (the server already sorts that way). */
  const on = (date: string) =>
    entries.filter((e) => daysOf(e.start.slice(0, 10), e.end.slice(0, 10), date, date).length > 0);

  return (
    <div className="cal-month">
      <div className="cal-month-head">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]} className="cal-week">
          {week.map((date) => {
            const items = on(date);
            const due = deadlines.filter((d) => d.date === date);
            const inMonth = date.slice(0, 7) === `${year}-${String(month).padStart(2, "0")}`;
            return (
              <div
                key={date}
                className="cal-month-cell"
                data-today={date === today || undefined}
                data-other={!inMonth || undefined}
                data-over={over === date || undefined}
                onPointerDown={() => onPoint(date)}
                onDoubleClick={(e) =>
                  !(e.target as HTMLElement).closest("button, .cal-deadline") && onCreateOnDay(date)
                }
                onDragOver={(e) => {
                  if (!hasDragItem(e)) return;
                  e.preventDefault();
                  setOver(date);
                }}
                onDragLeave={() => setOver((o) => (o === date ? null : o))}
                onDrop={(e) => {
                  setOver(null);
                  const item = readDragItem(e);
                  if (item?.kind !== "task") return;
                  e.preventDefault();
                  onDropTask(item.id, date);
                }}
              >
                <div className="cal-month-num">
                  <button type="button" onClick={() => onOpenDay(date)} title={t("Abrir el día")}>
                    {Number(date.slice(8))}
                  </button>
                  <button
                    type="button"
                    className="cal-add"
                    onClick={() => onCreateOnDay(date)}
                    aria-label={t("Nueva cita el {date}", { date })}
                    title={t("Nueva cita")}
                  >
                    <Plus size={13} aria-hidden="true" />
                  </button>
                </div>
                {due.slice(0, SHOWN).map((d) => (
                  <div
                    key={d.taskId}
                    className="cal-deadline"
                    title={t("Fecha límite: {title}", { title: d.title })}
                  >
                    ⚑ {d.title}
                  </div>
                ))}
                {items.slice(0, SHOWN).map((entry) => (
                  <button
                    key={keyOf(entry)}
                    type="button"
                    className="cal-chip"
                    data-color={entry.color ?? undefined}
                    data-selected={selectedIds.has(keyOf(entry)) || undefined}
                    onClick={(e) => onSelect(keyOf(entry), isAdditive(e))}
                    title={entry.title}
                  >
                    {!entry.allDay && <em>{timeOf(entry.start)}</em>} {entry.repeat ? "↻ " : ""}
                    {entry.title}
                  </button>
                ))}
                {items.length > SHOWN && (
                  <button type="button" className="cal-more" onClick={() => onOpenDay(date)}>
                    {t("+{count} más", { count: items.length - SHOWN })}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
