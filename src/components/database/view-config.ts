import type {
  Aggregate,
  ChartConfig,
  ChartSort,
  ChartType,
  Operator,
  Property,
  PropertyKind,
  ViewConfig,
  ViewKind,
} from "../../types";

/** Sorting and filtering can also target the row's own title. */
export const TITLE_ID = "title";
export const TITLE_PROPERTY: Property = { id: TITLE_ID, name: "Título", type: "text", config: {} };

/** Mirrors `operators_for` in views.rs — Rust is the authority and re-validates every rule. */
export const OPERATORS: Record<PropertyKind, Operator[]> = {
  text: ["contains", "not_contains", "is", "is_not", "is_empty", "is_not_empty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
  date: ["is", "before", "after", "on_or_before", "on_or_after", "is_empty", "is_not_empty"],
  select: ["is", "is_not", "is_empty", "is_not_empty"],
  relation: ["contains", "not_contains", "is_empty", "is_not_empty"],
  place: ["contains", "not_contains", "is_empty", "is_not_empty"],
  tags: ["contains", "not_contains", "is_empty", "is_not_empty"],
  // «es» marcada / sin marcar (the value is a boolean)
  checkbox: ["is"],
};

export const OPERATOR_LABELS: Record<Operator, string> = {
  contains: "contiene",
  not_contains: "no contiene",
  is: "es",
  is_not: "no es",
  is_empty: "está vacío",
  is_not_empty: "no está vacío",
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  before: "es anterior a",
  after: "es posterior a",
  on_or_before: "es anterior o igual a",
  on_or_after: "es posterior o igual a",
};

export const needsValue = (op: Operator) => op !== "is_empty" && op !== "is_not_empty";

export const GRANULARITY_LABELS = {
  day: "Día",
  week: "Semana",
  month: "Mes",
  year: "Año",
} as const;

/** A stored config only holds what was set; this fills the rest in so panels can read it blindly. */
export function normalizeConfig(raw: Partial<ViewConfig> | undefined): ViewConfig {
  return {
    sorts: raw?.sorts ?? [],
    filter: { op: raw?.filter?.op ?? "and", rules: raw?.filter?.rules ?? [] },
    ...(raw?.group ? { group: raw.group } : {}),
    ...(raw?.hiddenProperties ? { hiddenProperties: raw.hiddenProperties } : {}),
    ...(raw?.showPreview !== undefined ? { showPreview: raw.showPreview } : {}),
    ...(raw?.dateProperty ? { dateProperty: raw.dateProperty } : {}),
    ...(raw?.placeProperty ? { placeProperty: raw.placeProperty } : {}),
    ...(raw?.form ? { form: raw.form } : {}),
    ...(raw?.chart ? { chart: raw.chart } : {}),
    ...(raw?.dashboard ? { dashboard: raw.dashboard } : {}),
    ...(raw?.columnWidths ? { columnWidths: raw.columnWidths } : {}),
    ...(raw?.calculations ? { calculations: raw.calculations } : {}),
    ...(raw?.frozenUpTo ? { frozenUpTo: raw.frozenUpTo } : {}),
    ...(raw?.wrapped ? { wrapped: raw.wrapped } : {}),
  };
}

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  bar: "Barras verticales",
  hbar: "Barras horizontales",
  line: "Líneas",
  donut: "Anillos",
  number: "Número",
};

export const AGGREGATE_LABELS: Record<Aggregate, string> = {
  count: "Recuento",
  sum: "Suma",
  avg: "Promedio",
  min: "Mínimo",
  max: "Máximo",
};

/** A chart config with its defaults filled in (what Rust assumes for anything missing). */
export type NormalizedChart = Required<Omit<ChartConfig, "value">> & { value?: string };

export function normalizeChart(raw: ChartConfig | undefined): NormalizedChart {
  const sort: ChartSort = raw?.sort ?? "x";
  return {
    type: raw?.type ?? "bar",
    aggregate: raw?.aggregate ?? "count",
    sort,
    ...(raw?.value ? { value: raw.value } : {}),
  };
}

export const VIEW_KIND_LABELS: Record<ViewKind, string> = {
  table: "Tabla",
  list: "Lista",
  gallery: "Galería",
  feed: "Feed",
  board: "Tablero",
  calendar: "Calendario",
  timeline: "Cronograma",
  map: "Mapa",
  form: "Formulario",
  chart: "Gráfico",
  dashboard: "Panel de control",
};

/** What a chart's Y axis says: «Recuento», or «Suma de Esfuerzo». */
export function measureLabel(chart: NormalizedChart, properties: Property[]): string {
  const name = properties.find((p) => p.id === chart.value)?.name;
  return chart.aggregate === "count" || !name
    ? "Recuento"
    : `${AGGREGATE_LABELS[chart.aggregate]} de ${name}`;
}
