import type { Repeat } from "../types";
import { MONTH_NAMES, addDays, dayNumber } from "./date-utils.ts";

// The words of a repeat rule: the facts of the day an entry starts on and the rule read back in Spanish.
// Pure on purpose, so tests/repeat-text.test.mjs can check them without a screen.

export const FREQ_UNITS: { id: Repeat["freq"]; one: string; many: string }[] = [
  { id: "daily", one: "día", many: "días" },
  { id: "weekly", one: "semana", many: "semanas" },
  { id: "monthly", one: "mes", many: "meses" },
  { id: "yearly", one: "año", many: "años" },
];

export const WEEKDAY_NAMES = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
  "domingo",
];
/** «los lunes», «los sábados»: the plural of the weekdays that change. */
const WEEKDAY_PLURAL = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábados", "domingos"];
export const ORDINALS = ["", "primer", "segundo", "tercer", "cuarto"];

/** 0 = Monday … 6 = Sunday. */
const weekdayOf = (date: string) => (((dayNumber(date) + 3) % 7) + 7) % 7;
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Where a rule that is told to end on a date starts from: far enough to see it repeat, whatever it repeats. */
export const defaultRepeatEnd = (freq: Repeat["freq"], startDate: string) =>
  addDays(
    startDate,
    freq === "daily" || freq === "weekly" ? 30 : freq === "monthly" ? 365 : 5 * 365,
  );

/** The rule in words, to read back what was set: «Cada 2 semanas, los lunes y miércoles, hasta el 20 de diciembre de 2026». */
export function describeRepeat(r: Repeat, startDate: string): string {
  const f = dayFacts(startDate);
  const unit = FREQ_UNITS.find((u) => u.id === r.freq)!;
  let text = r.interval === 1 ? `Cada ${unit.one}` : `Cada ${r.interval} ${unit.many}`;
  const days = [...r.weekdays].sort();
  if (r.freq === "weekly") {
    const names = (days.length ? days : [f.wd]).map((d) => WEEKDAY_PLURAL[d]);
    if (days.length === 5 && days.join() === "0,1,2,3,4") text += ", de lunes a viernes";
    else if (names.length === 1) text += `, el ${WEEKDAY_NAMES[(days.length ? days : [f.wd])[0]]}`;
    else text += `, los ${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
  } else if (r.freq === "monthly" || r.freq === "yearly") {
    const of = r.freq === "yearly" ? ` de ${f.month}` : "";
    const wd = WEEKDAY_NAMES[days[0] ?? f.wd];
    if (r.lastDay) text += ", el último día del mes";
    else if (r.nth === -1) text += `, el último ${wd}${of}`;
    else if (r.nth) text += `, el ${ORDINALS[r.nth]} ${wd}${of}`;
    else text += r.freq === "yearly" ? `, el ${f.d} de ${f.month}` : `, el día ${f.d}`;
  }
  if (r.until) {
    const [y, m, d] = r.until.split("-").map(Number);
    text += `, hasta el ${d} de ${MONTH_NAMES[m - 1].toLowerCase()} de ${y}`;
  } else if (r.count) text += `, ${r.count} ${r.count === 1 ? "vez" : "veces"}`;
  return text;
}

/** What the day an entry starts on lets it say: «el 20», «el tercer martes», «el último martes»… */
export function dayFacts(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const wd = weekdayOf(date);
  const nth = Math.ceil(d / 7);
  return {
    d,
    wd,
    month: MONTH_NAMES[m - 1].toLowerCase(),
    name: WEEKDAY_NAMES[wd],
    nth: nth <= 4 ? nth : null,
    isLastOfKind: d + 7 > daysIn(y, m),
    isLastDay: d === daysIn(y, m),
  };
}
