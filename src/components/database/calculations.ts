import type { Calc, PropertyKind } from "../../types";
import { locale, t } from "../../lib/i18n.ts";

/** Menu label and the short label shown before the result in the table footer, like Notion's. */
const CALC_LABELS: Record<Calc, { menu: string; short: string }> = {
  count_all: { menu: t("Contar todo"), short: t("Total") },
  count_values: { menu: t("Contar valores"), short: t("Valores") },
  count_empty: { menu: t("Contar vacíos"), short: t("Vacíos") },
  count_unique: { menu: t("Contar valores únicos"), short: t("Únicos") },
  percent_empty: { menu: t("Porcentaje de vacíos"), short: t("Vacíos") },
  percent_not_empty: { menu: t("Porcentaje de no vacíos"), short: t("No vacíos") },
  sum: { menu: t("Suma"), short: t("Suma") },
  avg: { menu: t("Promedio"), short: t("Promedio") },
  median: { menu: t("Mediana"), short: t("Mediana") },
  min: { menu: t("Mínimo"), short: t("Mín.") },
  max: { menu: t("Máximo"), short: t("Máx.") },
  range: { menu: t("Rango"), short: t("Rango") },
  earliest: { menu: t("Fecha más antigua"), short: t("Más antigua") },
  latest: { menu: t("Fecha más reciente"), short: t("Más reciente") },
};

const COUNTS: Calc[] = [
  "count_all",
  "count_values",
  "count_empty",
  "count_unique",
  "percent_empty",
  "percent_not_empty",
];

/** A checkbox column says «marcadas» where the others say «valores»: an unchecked box holds no value. */
const CHECKBOX_LABELS: Partial<Record<Calc, { menu: string; short: string }>> = {
  count_values: { menu: t("Contar marcadas"), short: t("Marcadas") },
  count_empty: { menu: t("Contar sin marcar"), short: t("Sin marcar") },
  percent_not_empty: { menu: t("Porcentaje de marcadas"), short: t("Marcadas") },
};

/** The label of a calculation for a column of this type. */
export function calcLabel(calc: Calc, kind: PropertyKind): { menu: string; short: string } {
  return (kind === "checkbox" && CHECKBOX_LABELS[calc]) || CALC_LABELS[calc];
}

/** The calculations a column of this type offers (Rust enforces the same pairing). */
export function calcsFor(kind: PropertyKind): Calc[] {
  if (kind === "checkbox") return ["count_all", "count_values", "count_empty", "percent_not_empty"];
  if (kind === "number") return [...COUNTS, "sum", "avg", "median", "min", "max", "range"];
  if (kind === "date") return [...COUNTS, "earliest", "latest"];
  return COUNTS;
}

const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat(locale, {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** One column's result over the rows the view shows, ready to print. */
export function computeCalc(calc: Calc, values: unknown[]): string {
  const filled = values.filter((v) => !isEmpty(v));
  const percent = (n: number) =>
    `${numberFormat.format(values.length ? (n / values.length) * 100 : 0)} %`;
  switch (calc) {
    case "count_all":
      return String(values.length);
    case "count_values":
      return String(filled.length);
    case "count_empty":
      return String(values.length - filled.length);
    case "count_unique":
      return String(new Set(filled.map((v) => JSON.stringify(v))).size);
    case "percent_empty":
      return percent(values.length - filled.length);
    case "percent_not_empty":
      return percent(filled.length);
    case "earliest":
    case "latest": {
      // a range counts by its start, as everywhere else
      const days = filled.map((v) => String(v).split("/")[0]).sort();
      const day = calc === "earliest" ? days[0] : days[days.length - 1];
      return day ? dateFormat.format(new Date(`${day}T00:00:00Z`)) : "—";
    }
  }
  const numbers = filled.filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
  if (numbers.length === 0) return "—";
  const sum = numbers.reduce((a, b) => a + b, 0);
  const mid = Math.floor(numbers.length / 2);
  const result = {
    sum,
    avg: sum / numbers.length,
    median: numbers.length % 2 ? numbers[mid] : (numbers[mid - 1] + numbers[mid]) / 2,
    min: numbers[0],
    max: numbers[numbers.length - 1],
    range: numbers[numbers.length - 1] - numbers[0],
  }[calc];
  return numberFormat.format(result);
}
