import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  MONTH_NAMES,
  WEEKDAYS,
  addDays,
  dayNumber,
  formatMonthYear,
  monthGrid,
  todayIso,
  weekDays,
} from "../../lib/date-utils";
import type { DatedItem, UndatedItem } from "./view-items";
import "./views.css";

interface CalendarGridProps {
  items: DatedItem[];
  undated?: UndatedItem[];
  selectedId?: string | null;
  onOpen: (id: string) => void;
  /** Adds an entry on that day; without it the «+» of a day is hidden. */
  onAddOn?: (iso: string) => void;
}

type Mode = "month" | "week";

/**
 * A typical calendar: months you can step through or jump to, today marked,
 * a month or a week at a time. It only draws — what the entries are (rows of
 * a database, or a standalone block's own events) is the caller's business.
 */
export function CalendarGrid({
  items,
  undated = [],
  selectedId,
  onOpen,
  onAddOn,
}: CalendarGridProps) {
  const today = todayIso();
  const [anchor, setAnchor] = useState(today);
  const [mode, setMode] = useState<Mode>("month");

  const [year, month] = anchor.split("-").map(Number);
  const weeks = mode === "month" ? monthGrid(year, month) : [weekDays(anchor)];
  const spans = items.map((item) => ({
    item,
    startN: dayNumber(item.start),
    endN: dayNumber(item.end),
  }));

  // Functional updates: two quick clicks must both count, not read the same stale anchor.
  const step = (by: -1 | 1) =>
    setAnchor((current) => {
      if (mode === "week") return addDays(current, 7 * by);
      // month: the same day number, clamped (31 Jan → 28 Feb)
      const [y, m, d] = current.split("-").map(Number);
      const target = new Date(Date.UTC(y, m - 1 + by, 1));
      const last = new Date(
        Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
      ).getUTCDate();
      return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
    });

  const jumpTo = (y: number, m: number) => {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const day = Math.min(Number(anchor.slice(8)), last);
    setAnchor(
      `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    );
  };

  return (
    <div className="calendar">
      <div className="calendar-bar">
        <button
          type="button"
          className="db-icon-btn"
          aria-label="Anterior"
          onClick={() => step(-1)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="db-icon-btn"
          aria-label="Siguiente"
          onClick={() => step(1)}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <button type="button" className="calendar-today" onClick={() => setAnchor(today)}>
          Hoy
        </button>
        <select
          className="db-input calendar-select"
          aria-label="Mes"
          value={month}
          onChange={(e) => jumpTo(year, Number(e.target.value))}
        >
          {MONTH_NAMES.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
        <input
          className="db-input calendar-year"
          type="number"
          aria-label="Año"
          min={1}
          max={9999}
          value={year}
          onChange={(e) => {
            const y = Number(e.target.value);
            if (Number.isInteger(y) && y >= 1 && y <= 9999) jumpTo(y, month);
          }}
        />
        <span className="calendar-title" aria-live="polite">
          {formatMonthYear(year, month)}
        </span>
        <span className="calendar-modes" role="group" aria-label="Modo">
          {(["month", "week"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === "month" ? "Mes" : "Semana"}
            </button>
          ))}
        </span>
      </div>

      <div className="calendar-grid" role="grid" aria-label={formatMonthYear(year, month)}>
        <div className="calendar-weekdays" role="row">
          {WEEKDAYS.map((d) => (
            <span key={d} role="columnheader">
              {d}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} className="calendar-week" role="row">
            {week.map((day) => {
              const n = dayNumber(day);
              return (
                <div
                  key={day}
                  className="calendar-day"
                  role="gridcell"
                  data-today={day === today}
                  data-outside={mode === "month" && Number(day.slice(5, 7)) !== month}
                  data-week={mode === "week"}
                >
                  <div className="calendar-day-head">
                    <span className="calendar-day-number">{Number(day.slice(8))}</span>
                    {onAddOn && (
                      <button
                        type="button"
                        className="db-icon-btn calendar-add"
                        aria-label={`Añadir el ${day}`}
                        title="Añadir en este día"
                        onClick={() => onAddOn(day)}
                      >
                        <Plus size={12} strokeWidth={1.75} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {spans
                    .filter((s) => s.startN <= n && n <= s.endN)
                    .map(({ item, startN, endN }) => (
                      <button
                        key={item.id}
                        type="button"
                        className="calendar-chip"
                        data-first={n === startN}
                        data-last={n === endN}
                        data-selected={item.id === selectedId}
                        title={item.title}
                        onClick={() => onOpen(item.id)}
                      >
                        {item.title}
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {undated.length > 0 && (
        <div className="calendar-undated">
          <span className="db-panel-meta">Sin fecha</span>
          {undated.map((item) => (
            <button
              key={item.id}
              type="button"
              className="calendar-chip"
              onClick={() => onOpen(item.id)}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
