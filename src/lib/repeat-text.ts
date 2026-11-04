import type { Repeat } from "../types";
import { MONTH_NAMES, WEEKDAYS_LONG, addDays, dayNumber } from "./date-utils.ts";
import { locale, t } from "./i18n.ts";

// The words of a repeat rule: the facts of the day an entry starts on and the rule read back in Spanish.
// Pure on purpose, so tests/repeat-text.test.mjs can check them without a screen.

export const FREQ_UNITS: { id: Repeat["freq"]; one: string; many: string }[] = [
  { id: "daily", one: t("día"), many: t("días") },
  { id: "weekly", one: t("semana"), many: t("semanas") },
  { id: "monthly", one: t("mes"), many: t("meses") },
  { id: "yearly", one: t("año"), many: t("años") },
];

export const WEEKDAY_NAMES = WEEKDAYS_LONG;
/** «los lunes», «los sábados»: the plural of the weekdays (in Spanish only Saturday and Sunday change). */
const WEEKDAY_PLURAL = WEEKDAY_NAMES.map((n, i) =>
  locale.startsWith("es") && i < 5 ? n : n + "s",
);
export const ORDINALS = ["", t("primer"), t("segundo"), t("tercer"), t("cuarto")];

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
  let text =
    r.interval === 1
      ? t("Cada {unit}", { unit: unit.one })
      : t("Cada {n} {unit}", { n: r.interval, unit: unit.many });
  const days = [...r.weekdays].sort();
  if (r.freq === "weekly") {
    const names = (days.length ? days : [f.wd]).map((d) => WEEKDAY_PLURAL[d]);
    if (days.length === 5 && days.join() === "0,1,2,3,4") text += t(", de lunes a viernes");
    else if (names.length === 1)
      text += t(", el {day}", { day: WEEKDAY_NAMES[(days.length ? days : [f.wd])[0]] });
    else
      text += t(", los {days} y {last}", {
        days: names.slice(0, -1).join(", "),
        last: names[names.length - 1],
      });
  } else if (r.freq === "monthly" || r.freq === "yearly") {
    const of = r.freq === "yearly" ? t(" de {month}", { month: f.month }) : "";
    const wd = WEEKDAY_NAMES[days[0] ?? f.wd];
    if (r.lastDay) text += t(", el último día del mes");
    else if (r.nth === -1) text += t(", el último {wd}{of}", { wd, of });
    else if (r.nth) text += t(", el {ordinal} {wd}{of}", { ordinal: ORDINALS[r.nth], wd, of });
    else if (r.freq === "yearly") text += t(", el {d} de {month}", { d: f.d, month: f.month });
    else text += t(", el día {d}", { d: f.d });
  }
  if (r.until) {
    const [y, m, d] = r.until.split("-").map(Number);
    text += t(", hasta el {d} de {month} de {y}", {
      d,
      month: MONTH_NAMES[m - 1].toLowerCase(),
      y,
    });
  } else if (r.count)
    text += t(r.count === 1 ? ", {count} vez" : ", {count} veces", { count: r.count });
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
