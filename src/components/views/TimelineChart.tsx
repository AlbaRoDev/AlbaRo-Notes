import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { dayNumber, formatDayMonth, fromDayNumber, todayIso } from "../../lib/date-utils";
import type { DatedItem, UndatedItem } from "./view-items";
import "./views.css";
import { t } from "../../lib/i18n.ts";
import { useSizeClass } from "../../lib/viewport.ts";

interface TimelineChartProps {
  items: DatedItem[];
  undated?: UndatedItem[];
  selectedId?: string | null;
  onOpen: (id: string) => void;
}

type Scale = "day" | "week" | "month";
/** Pixels per day at each zoom level. */
const PX_PER_DAY: Record<Scale, number> = { day: 40, week: 14, month: 4 };
const SCALE_LABELS: Record<Scale, string> = {
  day: t("Días"),
  week: t("Semanas"),
  month: t("Meses"),
};
/** Days a «previous / next» click moves the window. */
const SHIFT_DAYS: Record<Scale, number> = { day: 14, week: 42, month: 180 };
/** The column of titles; a narrow screen gives the bars more of the width. */
const LABEL_WIDTH = 176;
const LABEL_WIDTH_COMPACT = 112;
const MIN_SPAN_DAYS = 60;

/**
 * Entries as bars on a horizontal time axis (a single day is a narrow marker),
 * with a line for today. Like CalendarGrid it only draws; the caller decides
 * what the entries are.
 */
export function TimelineChart({ items, undated = [], selectedId, onOpen }: TimelineChartProps) {
  const labelWidth = useSizeClass() === "compact" ? LABEL_WIDTH_COMPACT : LABEL_WIDTH;
  const [scale, setScale] = useState<Scale>("week");
  const [shift, setShift] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  const today = dayNumber(todayIso());
  const spans = items.map((item) => ({
    item,
    start: dayNumber(item.start),
    end: dayNumber(item.end),
  }));

  const px = PX_PER_DAY[scale];
  const first = Math.min(today, ...spans.map((s) => s.start)) - 7 + shift;
  const last = Math.max(today, ...spans.map((s) => s.end)) + 21;
  const days = Math.max(last - first + 1, MIN_SPAN_DAYS);
  const trackWidth = days * px;

  // Bring today into view when the zoom or window changes.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max((today - first) * px - 120, 0);
  }, [today, first, px]);

  // Axis ticks: every day, every Monday, or every 1st of the month, depending on the zoom.
  const ticks: { left: number; label: string }[] = [];
  for (let n = first; n < first + days; n++) {
    const iso = fromDayNumber(n);
    const isMonday = (((n + 3) % 7) + 7) % 7 === 0;
    const label =
      scale === "day"
        ? String(Number(iso.slice(8)))
        : scale === "week"
          ? isMonday
            ? formatDayMonth(iso)
            : ""
          : iso.endsWith("-01")
            ? formatDayMonth(iso)
            : "";
    if (label) ticks.push({ left: (n - first) * px, label });
  }

  return (
    <div className="timeline" style={{ "--timeline-label": `${labelWidth}px` } as CSSProperties}>
      <div className="calendar-bar">
        <button
          type="button"
          className="db-icon-btn"
          aria-label={t("Antes")}
          onClick={() => setShift((s) => s - SHIFT_DAYS[scale])}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="db-icon-btn"
          aria-label={t("Después")}
          onClick={() => setShift((s) => s + SHIFT_DAYS[scale])}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <button type="button" className="calendar-today" onClick={() => setShift(0)}>
          {t("Hoy")}
        </button>
        <span className="calendar-modes" role="group" aria-label={t("Escala")}>
          {(Object.keys(SCALE_LABELS) as Scale[]).map((s) => (
            <button key={s} type="button" aria-pressed={scale === s} onClick={() => setScale(s)}>
              {SCALE_LABELS[s]}
            </button>
          ))}
        </span>
      </div>

      <div className="timeline-scroll" ref={scroller}>
        <div className="timeline-inner" style={{ width: labelWidth + trackWidth }}>
          <div className="timeline-row timeline-axis">
            <div className="timeline-label" />
            <div className="timeline-track" style={{ width: trackWidth }}>
              {ticks.map((t) => (
                <span key={t.left} className="timeline-tick" style={{ left: t.left }}>
                  {t.label}
                </span>
              ))}
            </div>
          </div>
          {spans.map(({ item, start, end }) => (
            <div key={item.id} className="timeline-row">
              <button
                type="button"
                className="timeline-label"
                title={item.title}
                onClick={() => onOpen(item.id)}
              >
                {item.title}
              </button>
              <div className="timeline-track" style={{ width: trackWidth }}>
                <button
                  type="button"
                  className="timeline-bar"
                  data-selected={item.id === selectedId}
                  style={{ left: (start - first) * px, width: Math.max((end - start + 1) * px, 8) }}
                  title={`${item.title}: ${fromDayNumber(start)}${end > start ? ` → ${fromDayNumber(end)}` : ""}`}
                  onClick={() => onOpen(item.id)}
                >
                  {item.title}
                </button>
              </div>
            </div>
          ))}
          <div
            className="timeline-today"
            aria-hidden="true"
            style={{ left: labelWidth + (today - first) * px + px / 2 }}
          />
        </div>
      </div>

      {undated.length > 0 && (
        <div className="calendar-undated">
          <span className="db-panel-meta">{t("Sin fecha")}</span>
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
