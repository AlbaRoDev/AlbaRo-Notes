import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Download, Plus } from "lucide-react";
import {
  calendarDeadlines,
  calendarEntryToTask,
  calendarEntryUnlinkTask,
  calendarScheduledTasks,
  exportCalendar,
  createCalendarEntry,
  deleteCalendarEntry,
  listCalendarEntries,
  updateCalendarEntry,
} from "../../lib/db-client";
import {
  MONTH_NAMES,
  addDays,
  formatMonthYear,
  monthGrid,
  todayIso,
  weekDays,
} from "../../lib/date-utils";
import { DAY_MINUTES, stamp } from "../../lib/calendar";
import { readPref, writePref } from "../../lib/prefs";
import type { CalendarEntry, Deadline, EntryInput, Scope } from "../../types";
import type { TaskHost } from "../workspace/Tasks";
import { keyOf } from "./entry-input";
import { EntryEditor } from "./EntryEditor";
import { MonthGrid } from "./MonthGrid";
import { ScopeDialog } from "./ScopeDialog";
import { TaskTray } from "./TaskTray";
import { TimeGrid } from "./TimeGrid";
import "./calendar.css";

type View = "day" | "week" | "month";
const VIEWS: { id: View; label: string }[] = [
  { id: "day", label: "Día" },
  { id: "week", label: "Semana" },
  { id: "month", label: "Mes" },
];

/** The same day of another month (or the last one when it is shorter). */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  const [year, month] = [Math.floor(index / 12), (index % 12) + 1];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

function titleOf(view: View, anchor: string): string {
  const [y, m, d] = anchor.split("-").map(Number);
  if (view === "month") return formatMonthYear(y, m);
  if (view === "day")
    return new Date(y, m - 1, d).toLocaleDateString("es", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  const week = weekDays(anchor);
  const [a, b] = [week[0].split("-").map(Number), week[6].split("-").map(Number)];
  return a[1] === b[1]
    ? `${a[2]} – ${b[2]} de ${MONTH_NAMES[b[1] - 1].toLowerCase()} de ${b[0]}`
    : `${a[2]} ${MONTH_NAMES[a[1] - 1].slice(0, 3).toLowerCase()} – ${b[2]} ${MONTH_NAMES[b[1] - 1].slice(0, 3).toLowerCase()} ${b[0]}`;
}

/**
 * The Calendario section of the Gestor, as in Notion Calendar: day, week and month views with an hour
 * axis, appointments of your own and tasks dragged in from the tray (the same task as often as wanted), due dates as
 * optional flags, and a panel to edit the selected entry.
 */
export function CalendarSection({ host }: { host: TaskHost }) {
  const { pages, onPagesChanged, onOpenPage } = host;
  const [view, setView] = useState<View>(() => {
    const stored = readPref("calendar.view");
    return VIEWS.find((v) => v.id === stored)?.id ?? "week";
  });
  const [anchor, setAnchor] = useState(todayIso);
  const [showDeadlines, setShowDeadlines] = useState(() => readPref("calendar.deadlines") !== "0");
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [scheduled, setScheduled] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => writePref("calendar.view", view), [view]);
  useEffect(() => writePref("calendar.deadlines", showDeadlines ? "1" : "0"), [showDeadlines]);

  const [year, month] = [Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7))];
  const days = useMemo(() => (view === "day" ? [anchor] : weekDays(anchor)), [view, anchor]);
  const [from, to] = useMemo(() => {
    if (view === "month") {
      const weeks = monthGrid(year, month);
      return [weeks[0][0], weeks[weeks.length - 1][6]];
    }
    return [days[0], days[days.length - 1]];
  }, [view, year, month, days]);

  // `pages` changes when a task's title does, so a scheduled task never shows an old one; `reload` bumps after a write
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listCalendarEntries(from, to),
      showDeadlines ? calendarDeadlines(from, to) : Promise.resolve([]),
      calendarScheduledTasks(),
    ])
      .then(([found, due, ids]) => {
        if (cancelled) return;
        setEntries(found);
        setDeadlines(due);
        setScheduled(new Set(ids));
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [from, to, showDeadlines, pages, reloadKey]);

  /** Runs a write, reloads and reports a refusal; resolves the result (or null when it failed). */
  const write = async <T,>(action: () => Promise<T>): Promise<T | null> => {
    try {
      const result = await action();
      setError(null);
      reload();
      return result;
    } catch (e) {
      setError(String(e));
      return null;
    }
  };

  const create = async (input: EntryInput) => {
    const made = await write(() => createCalendarEntry(input));
    if (made) setSelectedId(keyOf(made));
  };

  // A change to a repeating entry asks how far it reaches: the dialog for a drag, the panel's own choice for its fields.
  const [pending, setPending] = useState<
    | { kind: "update"; entry: CalendarEntry; input: EntryInput }
    | { kind: "delete"; entry: CalendarEntry }
    | null
  >(null);
  const [panelScope, setPanelScope] = useState<{ key: string | null; scope: Scope }>({
    key: null,
    scope: "this",
  });
  const scopeOfPanel: Scope = panelScope.key === selectedId ? panelScope.scope : "this";
  // a rule was just created: the panel scrolls to it (the panel is long and the rule is at its end)
  const [revealRepeat, setRevealRepeat] = useState(false);

  const apply = async (entry: CalendarEntry, input: EntryInput, scope: Scope) => {
    const done = await write(() =>
      updateCalendarEntry(entry.id, input, scope, entry.occurrence ?? undefined),
    );
    if (done) setSelectedId(keyOf(done));
    return done !== null;
  };
  /** From the grid (a drag): a repeating entry asks first. */
  const change = (entry: CalendarEntry, input: EntryInput) => {
    if (entry.repeat) setPending({ kind: "update", entry, input });
    else void apply(entry, input, "all");
  };
  /** From the panel's fields. */
  const changeFromPanel = (entry: CalendarEntry, input: EntryInput) => {
    const ruleChanged = JSON.stringify(input.repeat) !== JSON.stringify(entry.repeat);
    if (!entry.repeat && input.repeat) setRevealRepeat(true);
    return apply(entry, input, ruleChanged ? "all" : entry.repeat ? scopeOfPanel : "all");
  };
  const remove = async (entry: CalendarEntry, scope: Scope) => {
    const done = await write(() =>
      deleteCalendarEntry(entry.id, scope, entry.occurrence ?? undefined),
    );
    if (done !== null) setSelectedId(null);
  };
  const askToRemove = (entry: CalendarEntry) => {
    if (entry.repeat) setPending({ kind: "delete", entry });
    else void remove(entry, "all");
  };

  const dropTask = (taskId: string, date: string, start: number | null) => {
    const end = start === null ? 0 : Math.min(start + 60, DAY_MINUTES);
    void create({
      taskId,
      title: null,
      start: start === null ? date : stamp(date, start),
      end: start === null ? date : stamp(date, end),
      allDay: start === null,
      color: null,
      location: null,
      note: null,
      repeat: null,
    });
  };

  const newAppointment = (date: string, allDay: boolean) =>
    void create({
      taskId: null,
      title: "Nueva cita",
      start: allDay ? date : stamp(date, 9 * 60),
      end: allDay ? date : stamp(date, 10 * 60),
      allDay,
      color: null,
      location: null,
      note: null,
      repeat: null,
    });

  const step = (dir: -1 | 1) =>
    setAnchor((a) =>
      view === "month" ? addMonths(a, dir) : addDays(a, dir * (view === "week" ? 7 : 1)),
    );
  const openDay = (date: string) => {
    setAnchor(date);
    setView("day");
  };

  const selected = entries.find((e) => keyOf(e) === selectedId) ?? null;

  /**
   * Supr (or Retroceso) deletes the selected entry, like the «Borrar» button (a repeating one asks how far first).
   * Not while typing: inside a field the key edits the text. The one exception is the entry that was just created,
   * whose title is still the untouched «Nueva cita», all selected: deleting that is deleting the entry (nobody keeps it).
   */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
    if (!selected || pending) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']")) {
      const field = target instanceof HTMLInputElement ? target : null;
      const untouched =
        field?.hasAttribute("data-cal-title") &&
        selected.title === "Nueva cita" &&
        field.value === "Nueva cita" &&
        field.selectionStart === 0 &&
        field.selectionEnd === field.value.length;
      if (!untouched) return;
    }
    e.preventDefault();
    askToRemove(selected);
  };

  return (
    // tabIndex -1: a click anywhere in the calendar gives it the focus, so the key reaches `onKeyDown`
    <div className="cal" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="cal-main">
        <div className="cal-bar">
          <button type="button" className="cal-today" onClick={() => setAnchor(todayIso())}>
            Hoy
          </button>
          <button type="button" onClick={() => step(-1)} aria-label="Anterior" title="Anterior">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => step(1)} aria-label="Siguiente" title="Siguiente">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <h2>{titleOf(view, anchor)}</h2>
          <input
            type="date"
            className="cal-date"
            value={anchor}
            aria-label="Ir a una fecha"
            onChange={(e) => e.target.value && setAnchor(e.target.value)}
          />
          <span className="cal-bar-gap" />
          <label
            className="cal-toggle"
            title="Muestra la «Fecha límite» de las tareas como banderas"
          >
            <input
              type="checkbox"
              checked={showDeadlines}
              onChange={(e) => setShowDeadlines(e.target.checked)}
            />
            Fechas límite
          </label>
          <div className="cal-views" role="group" aria-label="Vista">
            {VIEWS.map(({ id, label }) => (
              <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            title="Guarda todo el calendario como un archivo .ics para abrirlo en otra aplicación"
            onClick={() => {
              setSaved(null);
              exportCalendar(showDeadlines)
                .then((path) => {
                  if (path) setSaved(path);
                  setError(null);
                })
                .catch((e) => setError(String(e)));
            }}
          >
            <Download size={14} aria-hidden="true" /> .ics
          </button>
          <button
            type="button"
            className="cal-new"
            onClick={() => newAppointment(view === "month" ? todayIso() : anchor, false)}
          >
            <Plus size={14} aria-hidden="true" /> Cita
          </button>
        </div>
        {error && (
          <p className="cal-error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="cal-saved" role="status">
            Calendario guardado en {saved}
          </p>
        )}
        {view === "month" ? (
          <MonthGrid
            year={year}
            month={month}
            entries={entries}
            deadlines={deadlines}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpenDay={openDay}
            onCreateOnDay={(date) => newAppointment(date, true)}
            onDropTask={(taskId, date) => dropTask(taskId, date, null)}
          />
        ) : (
          <TimeGrid
            days={days}
            entries={entries}
            deadlines={deadlines}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpenDay={openDay}
            onCreate={(input) => void create(input)}
            onCreateAllDay={(date) => newAppointment(date, true)}
            onChange={change}
            onDropTask={dropTask}
          />
        )}
      </div>
      <aside className="cal-side">
        {selected ? (
          <EntryEditor
            key={keyOf(selected)}
            entry={selected}
            scope={scopeOfPanel}
            onScope={(scope) => setPanelScope({ key: selectedId, scope })}
            revealRepeat={revealRepeat}
            onRepeatRevealed={() => setRevealRepeat(false)}
            onChange={(input) => changeFromPanel(selected, input)}
            onDelete={() => askToRemove(selected)}
            onClose={() => setSelectedId(null)}
            onOpenTask={onOpenPage}
            onToTask={() =>
              void write(() => calendarEntryToTask(selected.id)).then((r) => r && onPagesChanged())
            }
            onUnlink={() => void write(() => calendarEntryUnlinkTask(selected.id))}
          />
        ) : (
          <TaskTray pages={pages} scheduled={scheduled} onOpen={onOpenPage} />
        )}
      </aside>
      {pending && (
        <ScopeDialog
          verb={pending.kind}
          onCancel={() => setPending(null)}
          onPick={(scope) => {
            const asked = pending;
            setPending(null);
            if (asked.kind === "update") void apply(asked.entry, asked.input, scope);
            else void remove(asked.entry, scope);
          }}
        />
      )}
    </div>
  );
}
