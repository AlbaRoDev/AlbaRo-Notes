import { useState } from "react";
import { ArrowUpRight, Trash2, X } from "lucide-react";
import {
  DAY_MINUTES,
  SLOT,
  absOf,
  clock,
  endFromAbs,
  parseClock,
  stamp,
  timeFromAbs,
  unstamp,
} from "../../lib/calendar";
import { dayNumber } from "../../lib/date-utils";
import type { CalendarEntry, EntryInput, Scope, TagColor } from "../../types";
import { TaskChecklist } from "../boards/TaskChecklist";
import { RepeatField } from "./RepeatField";
import { TAG_COLORS } from "../database/property-types";
import { leaveOnEnter, toInput } from "./entry-input";

/** The longest the duration slider reaches (a block can be longer, by dragging or by its end day). */
const MAX_SLIDER = DAY_MINUTES;

/**
 * The panel of one entry: title, day, hours (time boxes and two sliders to fine-tune), colour, place and a
 * short note; an appointment can become a task and a scheduled task can let go of its task. Text fields save when
 * they lose focus (never per keystroke), the sliders when released; a change Rust refuses puts the field back.
 */
export function EntryEditor({
  entry,
  onChange,
  onDelete,
  onClose,
  onOpenTask,
  onToTask,
  onUnlink,
  scope,
  onScope,
  revealRepeat,
  onRepeatRevealed,
}: {
  entry: CalendarEntry;
  /** For a repeating entry: how far the changes made here reach (a change of the rule always reaches the whole series). */
  scope: Scope;
  onScope: (scope: Scope) => void;
  /** A rule was just created: the panel scrolls to it once. */
  revealRepeat: boolean;
  onRepeatRevealed: () => void;
  /** Resolves true when the change was saved. */
  onChange: (input: EntryInput) => Promise<boolean>;
  onDelete: () => void;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  onToTask: () => void;
  onUnlink: () => void;
}) {
  // fields are remounted when a change is refused, so they show what is really saved again
  const [revision, setRevision] = useState(0);
  const base = toInput(entry);
  const save = async (patch: Partial<EntryInput>) => {
    if (!(await onChange({ ...base, ...patch }))) setRevision((r) => r + 1);
  };

  const from = unstamp(entry.allDay ? `${entry.start}T00:00` : entry.start);
  const to = unstamp(entry.allDay ? `${entry.end}T00:00` : entry.end);
  // the sliders show their own value while dragged and save on release
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragLength, setDragLength] = useState<number | null>(null);
  // a timed block can cross midnight: its length is the difference of absolute minutes
  const startAbs = entry.allDay ? 0 : absOf(entry.start);
  const endAbs = entry.allDay ? 0 : absOf(entry.end);
  const startMin = dragStart ?? from.minutes;
  const length = dragLength ?? Math.max(endAbs - startAbs, SLOT);
  const midnightOf = (date: string) => dayNumber(date) * DAY_MINUTES;

  const setAbs = (start: number, end: number) =>
    save({ start: timeFromAbs(start), end: endFromAbs(end) });
  /** Starts at `minutes` of the same day keeping the length. */
  const startAt = (minutes: number) => {
    const start = midnightOf(from.date) + minutes;
    return setAbs(start, start + length);
  };

  const timeField = (label: string, minutes: number, apply: (m: number) => void) => (
    <label>
      {label}
      <input
        key={`${label}-${revision}-${entry.start}-${entry.end}`}
        type="time"
        step={SLOT * 60}
        defaultValue={clock(minutes % DAY_MINUTES)}
        onBlur={(e) => {
          const m = parseClock(e.currentTarget.value);
          if (m !== null && m !== minutes % DAY_MINUTES) apply(m);
        }}
        onKeyDown={leaveOnEnter}
      />
    </label>
  );

  return (
    <section className="cal-editor" aria-label="Entrada del calendario">
      <header>
        <h3>{entry.taskId ? "Tarea programada" : "Cita"}</h3>
        <button type="button" onClick={onClose} aria-label="Cerrar" title="Cerrar">
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      {entry.taskId ? (
        <>
          <div className="cal-editor-task">
            <strong>{entry.title}</strong>
            <button type="button" onClick={() => onOpenTask(entry.taskId!)}>
              <ArrowUpRight size={13} aria-hidden="true" /> Abrir la tarea
            </button>
            <button
              type="button"
              onClick={onUnlink}
              title="Deja una cita suelta con el mismo título; la tarea no se toca"
            >
              Desligar de la tarea
            </button>
          </div>
          {/* the task's own checklist: ticked here, it is ticked in its page and on its board cards */}
          <TaskChecklist key={entry.taskId} taskId={entry.taskId} />
        </>
      ) : (
        <label>
          Título
          <input
            key={`title-${revision}-${entry.id}`}
            type="text"
            data-cal-title
            maxLength={200}
            defaultValue={entry.title}
            autoFocus={entry.title === "Nueva cita"}
            onFocus={(e) => entry.title === "Nueva cita" && e.currentTarget.select()}
            onKeyDown={leaveOnEnter}
            onBlur={(e) => {
              const title = e.currentTarget.value.trim();
              if (title && title !== entry.title) void save({ title });
              else e.currentTarget.value = entry.title;
            }}
          />
        </label>
      )}

      <label className="cal-editor-check">
        <input
          type="checkbox"
          checked={entry.allDay}
          onChange={(e) =>
            void save(
              e.target.checked
                ? { allDay: true, start: from.date, end: from.date }
                : {
                    allDay: false,
                    start: stamp(from.date, 9 * 60),
                    end: stamp(from.date, 10 * 60),
                  },
            )
          }
        />
        Todo el día
      </label>

      <label>
        {entry.allDay ? "Desde" : "Día"}
        <input
          key={`date-${revision}-${entry.start}`}
          type="date"
          defaultValue={from.date}
          onBlur={(e) => {
            const date = e.currentTarget.value;
            if (!date || date === from.date) return;
            if (entry.allDay) void save({ start: date, end: date > to.date ? date : to.date });
            else {
              const start = midnightOf(date) + from.minutes;
              void setAbs(start, start + length); // the whole block moves
            }
          }}
        />
      </label>

      {entry.allDay ? (
        <label>
          Hasta
          <input
            key={`until-${revision}-${entry.end}`}
            type="date"
            defaultValue={to.date}
            onBlur={(e) => {
              const date = e.currentTarget.value;
              if (date && date !== to.date) void save({ end: date });
            }}
          />
        </label>
      ) : (
        <>
          <div className="cal-editor-times">
            {timeField("Inicio", from.minutes, (m) => void startAt(m))}
            {timeField("Fin", to.minutes, (m) => void setAbs(startAbs, midnightOf(to.date) + m))}
          </div>
          <label>
            Termina el día
            <input
              key={`end-date-${revision}-${entry.end}`}
              type="date"
              defaultValue={to.date}
              onBlur={(e) => {
                const date = e.currentTarget.value;
                if (date && date !== to.date) void setAbs(startAbs, midnightOf(date) + to.minutes);
              }}
            />
          </label>
          <label>
            Empieza a las {clock(startMin)}
            <input
              type="range"
              min={0}
              max={DAY_MINUTES - SLOT}
              step={SLOT}
              value={startMin}
              onChange={(e) => setDragStart(Number(e.target.value))}
              onPointerUp={() => {
                if (dragStart !== null) void startAt(dragStart);
                setDragStart(null);
              }}
              onKeyUp={() => {
                if (dragStart !== null) void startAt(dragStart);
                setDragStart(null);
              }}
            />
          </label>
          <label>
            Dura {Math.floor(length / 60) > 0 ? `${Math.floor(length / 60)} h ` : ""}
            {length % 60 > 0 ? `${length % 60} min` : ""}
            <input
              type="range"
              min={SLOT}
              max={Math.max(MAX_SLIDER, length)}
              step={SLOT}
              value={length}
              onChange={(e) => setDragLength(Number(e.target.value))}
              onPointerUp={() => {
                if (dragLength !== null) void setAbs(startAbs, startAbs + dragLength);
                setDragLength(null);
              }}
              onKeyUp={() => {
                if (dragLength !== null) void setAbs(startAbs, startAbs + dragLength);
                setDragLength(null);
              }}
            />
          </label>
        </>
      )}

      <RepeatField
        repeat={entry.repeat}
        startDate={from.date}
        revision={revision}
        reveal={revealRepeat}
        onRevealed={onRepeatRevealed}
        onChange={(repeat) => void save({ repeat })}
      />
      {entry.repeat && (
        <fieldset className="cal-scope">
          <legend>Los cambios afectan a</legend>
          {(
            [
              ["this", "Solo este evento"],
              ["following", "Este y los siguientes"],
              ["all", "Todos los eventos"],
            ] as const
          ).map(([id, label]) => (
            <label key={id}>
              <input
                type="radio"
                name="cal-scope"
                checked={scope === id}
                onChange={() => onScope(id)}
              />
              {label}
            </label>
          ))}
        </fieldset>
      )}

      <div className="cal-editor-colors" role="radiogroup" aria-label="Color">
        <button
          type="button"
          role="radio"
          aria-checked={entry.color === null}
          aria-label="Sin color"
          data-color="none"
          onClick={() => void save({ color: null })}
        />
        {TAG_COLORS.filter((c) => c.color !== "default").map(({ color, label }) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={entry.color === color}
            aria-label={label}
            title={label}
            data-color={color satisfies TagColor}
            onClick={() => void save({ color })}
          />
        ))}
      </div>

      <label>
        Lugar
        <input
          key={`place-${revision}-${entry.location ?? ""}`}
          type="text"
          maxLength={200}
          defaultValue={entry.location ?? ""}
          onKeyDown={leaveOnEnter}
          onBlur={(e) => {
            const location = e.currentTarget.value.trim() || null;
            if (location !== entry.location) void save({ location });
          }}
        />
      </label>
      <label>
        Nota
        <textarea
          key={`note-${revision}-${entry.note ?? ""}`}
          rows={3}
          maxLength={2000}
          defaultValue={entry.note ?? ""}
          onBlur={(e) => {
            const note = e.currentTarget.value.trim() || null;
            if (note !== entry.note) void save({ note });
          }}
        />
      </label>

      <footer>
        {!entry.taskId && (
          <button
            type="button"
            onClick={onToTask}
            title="Crea la tarea con este título para enlazarla a notas o agruparla"
          >
            Convertir en tarea
          </button>
        )}
        <button type="button" className="cal-danger" onClick={onDelete}>
          <Trash2 size={13} aria-hidden="true" /> Borrar
        </button>
      </footer>
    </section>
  );
}
