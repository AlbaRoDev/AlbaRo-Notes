import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { sizeClassFor } from "../../lib/size-class.ts";
import { useSizeClass } from "../../lib/viewport.ts";
import { useBackLayer } from "../../hooks/useBackLayer.ts";
import { ChevronLeft, ChevronRight, ChevronUp, Download, MoreHorizontal, Plus } from "lucide-react";
import {
  calendarDeadlines,
  calendarEntryToTask,
  calendarEntryUnlinkTask,
  calendarScheduledTasks,
  exportCalendar,
  createCalendarEntries,
  createCalendarEntry,
  deleteCalendarEntries,
  deleteCalendarEntry,
  listCalendarEntries,
  updateCalendarEntries,
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
import { DAY_MINUTES, placeCopy, placeGroup, planBatch, stamp } from "../../lib/calendar";
import { readPref, writePref } from "../../lib/prefs";
import type { CalendarEntry, Deadline, EntryInput, Scope } from "../../types";
import type { TaskHost } from "../workspace/Tasks";
import { keyOf, toInput, withInput } from "./entry-input";
import { EntryEditor } from "./EntryEditor";
import { MonthGrid } from "./MonthGrid";
import { NotificationSettings } from "./NotificationSettings";
import { ScopeDialog } from "./ScopeDialog";
import { TaskTray } from "./TaskTray";
import { TimeGrid } from "./TimeGrid";
import "./calendar.css";
import { locale, t } from "../../lib/i18n.ts";

type View = "day" | "week" | "month";
const VIEWS: { id: View; label: string }[] = [
  { id: "day", label: t("Día") },
  { id: "week", label: t("Semana") },
  { id: "month", label: t("Mes") },
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
    return new Date(y, m - 1, d).toLocaleDateString(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  const week = weekDays(anchor);
  const [a, b] = [week[0].split("-").map(Number), week[6].split("-").map(Number)];
  return a[1] === b[1]
    ? t("{d1} – {d2} de {month} de {year}", {
        d1: a[2],
        d2: b[2],
        month: MONTH_NAMES[b[1] - 1].toLowerCase(),
        year: b[0],
      })
    : t("{d1} {m1} – {d2} {m2} {year}", {
        d1: a[2],
        m1: MONTH_NAMES[a[1] - 1].slice(0, 3).toLowerCase(),
        d2: b[2],
        m2: MONTH_NAMES[b[1] - 1].slice(0, 3).toLowerCase(),
        year: b[0],
      });
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
    // with nothing chosen yet, a narrow screen starts on one day (seven columns don't fit a phone)
    const first: View = sizeClassFor(window.innerWidth) === "compact" ? "day" : "week";
    return VIEWS.find((v) => v.id === stored)?.id ?? first;
  });
  const [anchor, setAnchor] = useState(todayIso);
  const [showDeadlines, setShowDeadlines] = useState(() => readPref("calendar.deadlines") !== "0");
  const [showLists, setShowLists] = useState(() => readPref("calendar.checklists") !== "0");
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [scheduled, setScheduled] = useState<Set<string>>(new Set());
  // Ctrl/⌘/Shift + click adds entries to the selection; the panel edits an entry only while exactly one is selected
  const [selection, setSelection] = useState<string[]>([]);
  const selectedId = selection.length === 1 ? selection[0] : null;
  const selectedIds = useMemo(() => new Set(selection), [selection]);
  const setSelectedId = (id: string | null) => setSelection(id ? [id] : []);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // A narrow screen: the side (task tray or the entry's editor) is a sheet at the foot, and the bar keeps its extras folded.
  const compact = useSizeClass() !== "expanded";
  const [sideOpen, setSideOpen] = useState(false);
  const [extrasOpen, setExtrasOpen] = useState(false);
  useEffect(() => writePref("calendar.view", view), [view]);
  useEffect(() => writePref("calendar.deadlines", showDeadlines ? "1" : "0"), [showDeadlines]);
  useEffect(() => writePref("calendar.checklists", showLists ? "1" : "0"), [showLists]);

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
    if (made) select(keyOf(made));
  };

  /** Several new entries at once (copies of a selection): one step of the history, and the copies end up selected. */
  const createMany = async (inputs: EntryInput[]) => {
    if (inputs.length === 1) return create(inputs[0]);
    const made = await write(() => createCalendarEntries(inputs));
    if (made) {
      leaveDraft(null);
      setSelection(made.map(keyOf));
    }
  };

  // A change to a repeating entry asks how far it reaches. A drag asks at once; the fields of the panel do not: they
  // pile up in `draft` (shown in the panel) and the question comes when the entry is left (another one is picked, the panel closed).
  const [pending, setPending] = useState<
    | { kind: "update"; entry: CalendarEntry; input: EntryInput; reselect: boolean }
    | { kind: "delete"; entry: CalendarEntry }
    | { kind: "moveMany"; moves: { entry: CalendarEntry; input: EntryInput }[] }
    | { kind: "deleteMany"; entries: CalendarEntry[] }
    | null
  >(null);
  const [draft, setDraft] = useState<{
    key: string;
    entry: CalendarEntry;
    input: EntryInput;
  } | null>(null);
  // bumped when a draft is thrown away, so the panel's fields show what is saved again
  const [draftRev, setDraftRev] = useState(0);
  const raw = entries.find((e) => keyOf(e) === selectedId) ?? null;
  const selected = raw && draft?.key === selectedId ? withInput(raw, draft.input) : raw;
  // a rule was just created: the panel scrolls to it (the panel is long and the rule is at its end)
  const [revealRepeat, setRevealRepeat] = useState(false);

  const apply = async (entry: CalendarEntry, input: EntryInput, scope: Scope, reselect = true) => {
    const done = await write(() =>
      updateCalendarEntry(entry.id, input, scope, entry.occurrence ?? undefined),
    );
    if (done && reselect) setSelectedId(keyOf(done));
    return done !== null;
  };
  /** From the grid (a drag): a repeating entry asks first (with what was already changed in the panel). */
  const change = (entry: CalendarEntry, input: EntryInput) => {
    if (!entry.repeat) return void apply(entry, input, "all");
    const merged =
      draft?.key === keyOf(entry)
        ? { ...draft.input, start: input.start, end: input.end, allDay: input.allDay }
        : input;
    setDraft(null);
    setPending({ kind: "update", entry, input: merged, reselect: true });
  };
  /** From the panel's fields: a repeating entry keeps the change as a draft until it is left. */
  const changeFromPanel = (entry: CalendarEntry, input: EntryInput) => {
    const ruleChanged = JSON.stringify(input.repeat) !== JSON.stringify(entry.repeat);
    if (!entry.repeat && input.repeat) setRevealRepeat(true);
    if (ruleChanged || !entry.repeat) {
      setDraft(null);
      return apply(entry, input, "all");
    }
    setDraft({ key: keyOf(entry), entry, input });
    return Promise.resolve(true);
  };
  /** Leaving an entry that has a draft asks how far the draft reaches. */
  const leaveDraft = (keep: string | null) => {
    if (draft && draft.key !== keep) {
      setPending({ kind: "update", entry: draft.entry, input: draft.input, reselect: false });
      setDraft(null);
    }
  };
  /** Picks another entry (or none). */
  const select = (id: string | null) => {
    leaveDraft(id);
    setSelectedId(id);
  };
  /** Adds the entry to the selection, or takes it out when it is already there. */
  const toggle = (id: string) => {
    leaveDraft(null);
    setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  const pick = (id: string | null, additive?: boolean) =>
    additive && id ? toggle(id) : select(id);
  // the selected entries that are on screen (a selection can outlive a change of week)
  const chosen = entries.filter((e) => selectedIds.has(keyOf(e)));
  // On a narrow screen the side is a sheet: Back closes it (and lets go of the entry it was editing).
  const sheetOpen = sideOpen || selected !== null || chosen.length > 1;
  useBackLayer(compact && sheetOpen, () => {
    setSideOpen(false);
    select(null);
  });

  /** A selection dragged in the grid: one request, one step of the history; a series in it asks for the scope once. */
  const changeMany = (moves: { entry: CalendarEntry; input: EntryInput }[]) => {
    if (moves.some((m) => m.entry.repeat)) setPending({ kind: "moveMany", moves });
    else void applyMany(planBatch(moves, "all"));
  };
  const applyMany = async (plan: { entry: CalendarEntry; input: EntryInput; scope: Scope }[]) => {
    const done = await write(() =>
      updateCalendarEntries(
        plan.map(({ entry, input, scope }) => ({
          id: entry.id,
          entry: input,
          scope,
          occurrence: entry.occurrence ?? undefined,
        })),
      ),
    );
    // an occurrence that moved has a new identity (its day): the old selection no longer points at anything
    if (done !== null && plan.some((p) => p.entry.repeat)) setSelection([]);
  };
  const removeMany = async (plan: { entry: CalendarEntry; scope: Scope }[]) => {
    const done = await write(() =>
      deleteCalendarEntries(
        plan.map(({ entry, scope }) => ({
          id: entry.id,
          scope,
          occurrence: entry.occurrence ?? undefined,
        })),
      ),
    );
    if (done !== null) {
      setDraft(null);
      setSelection([]);
    }
  };
  const askToRemoveMany = (list: CalendarEntry[]) => {
    if (list.some((e) => e.repeat)) setPending({ kind: "deleteMany", entries: list });
    else
      void removeMany(
        planBatch(
          list.map((entry) => ({ entry })),
          "all",
        ),
      );
  };
  const remove = async (entry: CalendarEntry, scope: Scope) => {
    const done = await write(() =>
      deleteCalendarEntry(entry.id, scope, entry.occurrence ?? undefined),
    );
    if (done !== null) {
      setDraft(null);
      setSelectedId(null);
    }
  };
  const askToRemove = (entry: CalendarEntry) => {
    if (entry.repeat) setPending({ kind: "delete", entry });
    else void remove(entry, "all");
  };

  /**
   * Ctrl+Z while the panel holds a change that was not confirmed yet throws that change away. (Any other Ctrl+Z is
   * the app's own history, handled in App: the calendar's changes are in it like everything else.)
   */
  const onUndoKey = useEffectEvent((e: globalThis.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "z") return;
    if (!draft || pending || e.defaultPrevented) return;
    const target = e.target instanceof HTMLElement ? e.target : document.body;
    if (target !== document.body && !target.closest(".cal")) return;
    const field = target.closest("input, textarea");
    const typed =
      (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) &&
      field.value !== field.defaultValue;
    if (typed) return;
    e.preventDefault();
    setDraft(null);
    setDraftRev((r) => r + 1);
  });
  // Copy, paste and duplicate: an in-memory copy of the entry, pasted where the grid was last pressed (or in place).
  const clip = useRef<EntryInput[]>([]);
  const point = useRef<{ date: string; minutes: number | null } | null>(null);
  // what copy and duplicate act on: the selection, or the one entry open in the panel
  const targets = chosen.length > 1 ? chosen : selected ? [selected] : [];
  const copy = () => {
    if (targets.length) clip.current = targets.map(toInput);
  };
  const duplicate = () => {
    if (targets.length) void createMany(targets.map((e) => ({ ...toInput(e), repeat: null })));
  };
  const paste = () => {
    const [src, at] = [clip.current, point.current];
    if (!src.length) return;
    if (at && at.date >= from && at.date <= to)
      void createMany(
        src.length === 1
          ? [placeCopy(src[0], at.date, at.minutes)]
          : placeGroup(src, at.date, at.minutes),
      );
    else void createMany(src.map((s) => ({ ...s, repeat: null })));
  };
  const onClipKey = useEffectEvent((e: globalThis.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.defaultPrevented || pending)
      return;
    const key = e.key.toLowerCase();
    if (key !== "c" && key !== "v" && key !== "d") return;
    const target = e.target instanceof HTMLElement ? e.target : document.body;
    if (target !== document.body && !target.closest(".cal")) return;
    // inside a field (or with text selected) the keys keep their normal meaning, except in the title while it is
    // still as saved: a new or just-clicked entry has the focus there, and the keys are meant for the entry
    const field = target.closest("input, textarea, select, [contenteditable='true']");
    const untouchedTitle =
      field instanceof HTMLInputElement &&
      field.hasAttribute("data-cal-title") &&
      field.value === field.defaultValue;
    if (field && !untouchedTitle) return;
    if (!field && key !== "v" && window.getSelection()?.toString()) return;
    if (key === "c" && targets.length) copy();
    else if (key === "d" && targets.length) duplicate();
    else if (key === "v" && clip.current.length) paste();
    else return;
    e.preventDefault();
  });
  useEffect(() => {
    const listener = (e: globalThis.KeyboardEvent) => {
      onUndoKey(e);
      onClipKey(e);
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

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
      title: t("Nueva cita"),
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

  /**
   * Supr (or Retroceso) deletes the selected entry, like the «Borrar» button (a repeating one asks how far first).
   * Not while typing: inside a field the key edits the text. The one exception is the entry that was just created,
   * whose title is still the untouched «Nueva cita», all selected: deleting that is deleting the entry (nobody keeps it).
   */
  const onDeleteKey = useEffectEvent((e: globalThis.KeyboardEvent) => {
    const target = e.target instanceof HTMLElement ? e.target : document.body;
    // the focus is on the page (body) when the field that had it went away (a closed panel): the key still reaches the calendar
    if (target !== document.body && !target.closest(".cal")) return;
    const typing = target.closest("input, textarea, select, [contenteditable='true']");
    if (e.key === "Escape" && chosen.length > 1 && !typing && !pending) {
      setSelection([]);
      return;
    }
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
    if (pending) return;
    if (chosen.length > 1) {
      if (typing) return;
      e.preventDefault();
      askToRemoveMany(chosen);
      return;
    }
    if (!selected) return;
    if (target.closest("input, textarea, select, [contenteditable='true']")) {
      const field = target instanceof HTMLInputElement ? target : null;
      const untouched =
        field?.hasAttribute("data-cal-title") &&
        selected.title === t("Nueva cita") &&
        field.value === t("Nueva cita") &&
        field.selectionStart === 0 &&
        field.selectionEnd === field.value.length;
      if (!untouched) return;
    }
    e.preventDefault();
    askToRemove(selected);
  });
  useEffect(() => {
    document.addEventListener("keydown", onDeleteKey);
    return () => document.removeEventListener("keydown", onDeleteKey);
  }, []);

  return (
    <div className="cal">
      <div className="cal-main">
        <div className="cal-bar">
          <button type="button" className="cal-today" onClick={() => setAnchor(todayIso())}>
            {t("Hoy")}
          </button>
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={t("Anterior")}
            title={t("Anterior")}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={t("Siguiente")}
            title={t("Siguiente")}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <h2>{titleOf(view, anchor)}</h2>
          <div className="cal-extras" data-open={extrasOpen}>
            <input
              type="date"
              className="cal-date"
              value={anchor}
              aria-label={t("Ir a una fecha")}
              onChange={(e) => e.target.value && setAnchor(e.target.value)}
            />
            <span className="cal-bar-gap" />
            <label
              className="cal-toggle"
              title={t("Muestra la «Fecha límite» de las tareas como banderas")}
            >
              <input
                type="checkbox"
                checked={showDeadlines}
                onChange={(e) => setShowDeadlines(e.target.checked)}
              />
              {t("Fechas límite")}
            </label>
            <label
              className="cal-toggle"
              title={t(
                "Muestra la lista de comprobación de las tareas dentro de sus bloques, si caben",
              )}
            >
              <input
                type="checkbox"
                checked={showLists}
                onChange={(e) => setShowLists(e.target.checked)}
              />
              {t("Checks")}
            </label>
            <button
              type="button"
              title={t(
                "Guarda todo el calendario como un archivo .ics para abrirlo en otra aplicación",
              )}
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
              <Download size={14} aria-hidden="true" /> {t(".ics")}
            </button>
          </div>
          <div className="cal-views" role="group" aria-label={t("Vista")}>
            {VIEWS.map(({ id, label }) => (
              <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>
                {label}
              </button>
            ))}
          </div>
          <NotificationSettings onError={setError} />
          <button
            type="button"
            className="cal-extras-toggle"
            aria-expanded={extrasOpen}
            aria-label={t("Más acciones")}
            title={t("Más acciones")}
            onClick={() => setExtrasOpen((open) => !open)}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="cal-new"
            onClick={() => newAppointment(view === "month" ? todayIso() : anchor, false)}
          >
            <Plus size={14} aria-hidden="true" /> {t("Cita")}
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
            selectedIds={selectedIds}
            onSelect={pick}
            onPoint={(date) => (point.current = { date, minutes: null })}
            onOpenDay={openDay}
            onCreateOnDay={(date) => newAppointment(date, true)}
            onDropTask={(taskId, date) => dropTask(taskId, date, null)}
          />
        ) : (
          <TimeGrid
            days={days}
            entries={entries}
            deadlines={deadlines}
            selectedIds={selectedIds}
            showLists={showLists}
            onSelect={pick}
            onPoint={(date, minutes) => (point.current = { date, minutes })}
            onOpenDay={openDay}
            onCreate={(input) => void create(input)}
            onCreateAllDay={(date) => newAppointment(date, true)}
            onChange={change}
            onChangeMany={changeMany}
            onDropTask={dropTask}
          />
        )}
      </div>
      <aside
        className="cal-side"
        data-open={sheetOpen}
        // a task dragged out of the tray leaves room for the calendar it is dropped on
        onDragStart={() => setSideOpen(false)}
      >
        <button
          type="button"
          className="cal-side-handle"
          aria-expanded={sheetOpen}
          onClick={() => {
            if (!sheetOpen) return setSideOpen(true);
            setSideOpen(false);
            select(null);
          }}
        >
          <ChevronUp size={16} aria-hidden="true" /> {t("Tareas")}
        </button>
        {chosen.length > 1 ? (
          <div className="cal-multi">
            <h3>{t("{count} citas seleccionadas", { count: chosen.length })}</h3>
            <p>{t("Arrastra una para mover todas; Supr las borra.")}</p>
            <button
              type="button"
              onClick={duplicate}
              title={t("Duplicar (Ctrl+D). Copiar: Ctrl+C; pegar: Ctrl+V")}
            >
              {t("Duplicar")}
            </button>
            <button type="button" onClick={() => askToRemoveMany(chosen)}>
              {t("Borrar")}
            </button>
            <button type="button" onClick={() => setSelection([])}>
              {t("Deseleccionar")}
            </button>
          </div>
        ) : selected ? (
          <EntryEditor
            key={`${keyOf(selected)}-${draftRev}`}
            entry={selected}
            revealRepeat={revealRepeat}
            onRepeatRevealed={() => setRevealRepeat(false)}
            onChange={(input) => changeFromPanel(selected, input)}
            onDelete={() => askToRemove(selected)}
            onDuplicate={duplicate}
            onClose={() => select(null)}
            onOpenTask={onOpenPage}
            onToTask={() =>
              void write(() => calendarEntryToTask(selected.id)).then((r) => r && onPagesChanged())
            }
            onUnlink={() => void write(() => calendarEntryUnlinkTask(selected.id))}
          />
        ) : (
          <TaskTray
            pages={pages}
            scheduled={scheduled}
            onOpen={onOpenPage}
            prefKey="calendar.tray"
          />
        )}
      </aside>
      {pending && (
        <ScopeDialog
          verb={pending.kind === "update" || pending.kind === "moveMany" ? "update" : "delete"}
          onCancel={() => setPending(null)}
          onPick={(scope) => {
            const asked = pending;
            setPending(null);
            if (asked.kind === "update")
              void apply(asked.entry, asked.input, scope, asked.reselect);
            else if (asked.kind === "delete") void remove(asked.entry, scope);
            else if (asked.kind === "moveMany") void applyMany(planBatch(asked.moves, scope));
            else
              void removeMany(
                planBatch(
                  asked.entries.map((entry) => ({ entry })),
                  scope,
                ),
              );
          }}
        />
      )}
    </div>
  );
}
