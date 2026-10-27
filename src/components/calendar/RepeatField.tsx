import { useEffect, useRef } from "react";
import {
  FREQ_UNITS,
  ORDINALS,
  WEEKDAY_NAMES,
  dayFacts,
  defaultRepeatEnd,
  describeRepeat,
} from "../../lib/repeat-text";
import type { Repeat } from "../../types";
import { leaveOnEnter } from "./entry-input";

const WEEKDAY_LETTERS = ["L", "M", "X", "J", "V", "S", "D"];
const rule = (freq: Repeat["freq"], extra: Partial<Repeat> = {}): Repeat => ({
  freq,
  interval: 1,
  weekdays: [],
  until: null,
  count: null,
  nth: null,
  lastDay: false,
  ...extra,
});

/** Two rules are the same shape when they repeat alike, however they end. */
const sameShape = (a: Repeat, b: Repeat) =>
  a.freq === b.freq &&
  a.interval === b.interval &&
  [...a.weekdays].sort().join() === [...b.weekdays].sort().join() &&
  a.nth === b.nth &&
  a.lastDay === b.lastDay;

/** The quick choices, as in Notion Calendar, worded for the day the entry starts on. */
function presets(date: string): { id: string; label: string; rule: Repeat }[] {
  const f = dayFacts(date);
  const out = [
    { id: "daily", label: "Todos los días", rule: rule("daily") },
    {
      id: "workdays",
      label: "Todos los días laborables (lunes a viernes)",
      rule: rule("weekly", { weekdays: [0, 1, 2, 3, 4] }),
    },
    {
      id: "weekly",
      label: `Todas las semanas (el ${f.name})`,
      rule: rule("weekly", { weekdays: [f.wd] }),
    },
    { id: "monthly", label: `Todos los meses (el día ${f.d})`, rule: rule("monthly") },
  ];
  if (f.nth)
    out.push({
      id: "monthly-nth",
      label: `Todos los meses (el ${ORDINALS[f.nth]} ${f.name})`,
      rule: rule("monthly", { weekdays: [f.wd], nth: f.nth }),
    });
  if (f.isLastOfKind)
    out.push({
      id: "monthly-last",
      label: `Todos los meses (el último ${f.name})`,
      rule: rule("monthly", { weekdays: [f.wd], nth: -1 }),
    });
  out.push({
    id: "yearly",
    label: `Todos los años (el ${f.d} de ${f.month})`,
    rule: rule("yearly"),
  });
  return out;
}

/**
 * The «Repetir» part of an entry's panel, after Notion Calendar's: quick choices (every day, workdays, every week on
 * the day, every month on the day or the n-th weekday, every year) and, once it repeats, the whole rule to change —
 * every N days/weeks/months/years, the exact weekdays, how a month is counted and when it stops. Any change gives
 * the whole new rule (`null` = «No se repite»); the numbers and the date save when they lose focus.
 */
export function RepeatField({
  repeat,
  startDate,
  onChange,
  revision,
  reveal,
  onRevealed,
}: {
  repeat: Repeat | null;
  startDate: string;
  onChange: (next: Repeat | null) => void;
  /** Bumped when a change was refused, to put the fields back. */
  revision: number;
  /** A rule was just created: scroll to it, then say so (the panel is long and this block is at its end). */
  reveal: boolean;
  onRevealed: () => void;
}) {
  const choices = presets(startDate);
  const matching = repeat ? choices.find((c) => sameShape(c.rule, repeat)) : undefined;
  const ends = repeat?.until ? "until" : repeat?.count ? "count" : "never";
  const facts = dayFacts(startDate);
  const unit = FREQ_UNITS.find((f) => f.id === repeat?.freq);

  // Scrolls to the block when a rule was just set, so «Cada» and «Termina» are in view. The parent keeps the flag: the
  // entry gets another key (`id@day`) when it starts repeating, so this panel is mounted again and could not remember.
  const customRef = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (!reveal || !repeat) return;
    customRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    onRevealed();
  }, [reveal, repeat, onRevealed]);

  /** Gives the same ending to a rule of another shape. */
  const keepEnding = (next: Repeat): Repeat => ({
    ...next,
    until: repeat?.until ?? null,
    count: repeat?.count ?? null,
  });

  // how a month (or a year) is counted
  const monthlyBy = !repeat
    ? "day"
    : repeat.lastDay
      ? "lastday"
      : repeat.nth === -1
        ? "last"
        : repeat.nth
          ? "nth"
          : "day";
  const weekdayOfRule = repeat?.weekdays[0] ?? facts.wd;

  return (
    <div className="cal-repeat">
      <label>
        Repetir
        <select
          value={!repeat ? "none" : (matching?.id ?? "custom")}
          onChange={(e) => {
            const id = e.target.value;
            if (id === "none") return onChange(null);
            // «Personalizado…» from «No se repite»: starts as every week on the day, with the whole rule open to change
            if (id === "custom")
              return repeat ? undefined : onChange(rule("weekly", { weekdays: [facts.wd] }));
            const picked = choices.find((c) => c.id === id);
            if (picked) onChange(repeat ? keepEnding(picked.rule) : picked.rule);
          }}
        >
          <option value="none">No se repite</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
          <option value="custom">Personalizado…</option>
        </select>
      </label>
      {repeat && <p className="cal-repeat-summary">{describeRepeat(repeat, startDate)}</p>}

      {repeat && unit && (
        <fieldset className="cal-repeat-custom" ref={customRef}>
          <legend>Personalizar</legend>
          <div className="cal-repeat-every">
            <span>Cada</span>
            <input
              key={`interval-${revision}-${repeat.interval}`}
              type="number"
              min={1}
              max={99}
              defaultValue={repeat.interval}
              aria-label="Cada cuántos"
              onBlur={(e) => {
                const interval = Math.round(Number(e.currentTarget.value));
                if (interval >= 1 && interval <= 99 && interval !== repeat.interval)
                  onChange({ ...repeat, interval });
                else e.currentTarget.value = String(repeat.interval);
              }}
              onKeyDown={leaveOnEnter}
            />
            <select
              value={repeat.freq}
              aria-label="Unidad"
              onChange={(e) => {
                const freq = e.target.value as Repeat["freq"];
                onChange({
                  ...repeat,
                  freq,
                  weekdays:
                    freq === "weekly"
                      ? repeat.weekdays.length
                        ? repeat.weekdays
                        : [facts.wd]
                      : [],
                  nth: null,
                  lastDay: false,
                });
              }}
            >
              {FREQ_UNITS.map((f) => (
                <option key={f.id} value={f.id}>
                  {repeat.interval === 1 ? f.one : f.many}
                </option>
              ))}
            </select>
          </div>

          {repeat.freq === "weekly" && (
            <div className="cal-repeat-days" role="group" aria-label="Días de la semana">
              {WEEKDAY_LETTERS.map((letter, day) => {
                const on = repeat.weekdays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    aria-label={WEEKDAY_NAMES[day]}
                    title={WEEKDAY_NAMES[day]}
                    onClick={() => {
                      const weekdays = on
                        ? repeat.weekdays.filter((d) => d !== day)
                        : [...repeat.weekdays, day].sort();
                      if (weekdays.length > 0) onChange({ ...repeat, weekdays }); // at least one day
                    }}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
          )}

          {(repeat.freq === "monthly" || repeat.freq === "yearly") && (
            <label>
              {repeat.freq === "monthly" ? "Cada mes, el" : `Cada año, en ${facts.month}, el`}
              <select
                value={monthlyBy}
                onChange={(e) => {
                  const by = e.target.value;
                  onChange({
                    ...repeat,
                    weekdays: by === "nth" || by === "last" ? [weekdayOfRule] : [],
                    nth: by === "nth" ? (facts.nth ?? 1) : by === "last" ? -1 : null,
                    lastDay: by === "lastday",
                  });
                }}
              >
                <option value="day">día {facts.d}</option>
                {(facts.nth || repeat.nth) && (
                  <option value="nth">
                    {ORDINALS[repeat.nth && repeat.nth > 0 ? repeat.nth : (facts.nth ?? 1)]}{" "}
                    {WEEKDAY_NAMES[weekdayOfRule]}
                  </option>
                )}
                <option value="last">último {WEEKDAY_NAMES[weekdayOfRule]}</option>
                {repeat.freq === "monthly" && <option value="lastday">último día del mes</option>}
              </select>
            </label>
          )}

          <label>
            Termina
            <select
              value={ends}
              onChange={(e) => {
                const next = e.target.value;
                onChange({
                  ...repeat,
                  until:
                    next === "until"
                      ? (repeat.until ?? defaultRepeatEnd(repeat.freq, startDate))
                      : null,
                  count: next === "count" ? (repeat.count ?? 10) : null,
                });
              }}
            >
              <option value="never">Nunca</option>
              <option value="until">El día</option>
              <option value="count">Después de</option>
            </select>
          </label>
          {ends === "until" && (
            <input
              key={`until-${revision}-${repeat.until}`}
              type="date"
              min={startDate}
              aria-label="Último día de la repetición"
              defaultValue={repeat.until ?? ""}
              onBlur={(e) => {
                const until = e.currentTarget.value;
                if (until && until !== repeat.until) onChange({ ...repeat, until });
              }}
            />
          )}
          {ends === "count" && (
            <div className="cal-repeat-every">
              <input
                key={`count-${revision}-${repeat.count}`}
                type="number"
                min={1}
                max={999}
                defaultValue={repeat.count ?? 10}
                aria-label="Número de veces"
                onBlur={(e) => {
                  const count = Math.round(Number(e.currentTarget.value));
                  if (count >= 1 && count <= 999 && count !== repeat.count)
                    onChange({ ...repeat, count });
                  else e.currentTarget.value = String(repeat.count ?? 10);
                }}
                onKeyDown={leaveOnEnter}
              />
              <span>veces</span>
            </div>
          )}
        </fieldset>
      )}
    </div>
  );
}
