import type {
  Aggregate,
  ChartConfig,
  ChartSort,
  ChartType,
  Property,
  ViewConfig,
  ViewResult,
} from "../../types";
import { ChartCanvas } from "../views/ChartCanvas";
import { AGGREGATE_LABELS, CHART_TYPE_LABELS, measureLabel, normalizeChart } from "./view-config";
import "./DatabaseView.css";

/** The chart view's body. Rust did the filtering, grouping and aggregating; this only draws. */
export function DatabaseChart({
  config,
  result,
  properties,
}: {
  config: ViewConfig;
  result: ViewResult | null | undefined;
  properties: Property[];
}) {
  const chart = normalizeChart(config.chart);
  const measure = measureLabel(chart, properties);
  const points = result?.chart?.points ?? [];
  const total = result?.chart?.total ?? 0;

  // a number needs no X axis; every other type is drawn per group
  if (chart.type !== "number") {
    if (!config.group)
      return (
        <p className="db-loading">
          Elige la propiedad del eje X en «Eje X» para dibujar el gráfico.
        </p>
      );
    if (points.length === 0) return <p className="db-loading">No hay datos que mostrar.</p>;
  }
  // with avg / min / max, adding the groups up (a ring's total and shares) would mean nothing
  const additive = chart.aggregate === "count" || chart.aggregate === "sum";

  return (
    <>
      <ChartCanvas type={chart.type} points={points} measure={measure} additive={additive} />
      {total > points.length && (
        <p className="db-panel-meta">
          Mostrando {points.length} de {total} grupos.
        </p>
      )}
    </>
  );
}

/** The «Gráfico» panel: type, what is calculated, and in which order. */
export function ChartPanel({
  config,
  properties,
  onChange,
}: {
  config: ViewConfig;
  properties: Property[];
  onChange: (next: ViewConfig) => void;
}) {
  const chart = normalizeChart(config.chart);
  const numbers = properties.filter((p) => p.type === "number");
  const save = (next: ChartConfig) => {
    const stored: ChartConfig = { ...next };
    if (stored.aggregate === "count") delete stored.value;
    onChange({ ...config, chart: stored });
  };
  return (
    <div className="db-panel" role="group" aria-label="Gráfico">
      <label>
        Tipo de gráfico
        <select
          value={chart.type}
          onChange={(e) => save({ ...chart, type: e.target.value as ChartType })}
        >
          {Object.entries(CHART_TYPE_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Cálculo
        <select
          value={chart.aggregate}
          onChange={(e) => {
            const aggregate = e.target.value as Aggregate;
            save({
              ...chart,
              aggregate,
              ...(aggregate !== "count" ? { value: chart.value ?? numbers[0]?.id } : {}),
            });
          }}
        >
          {Object.entries(AGGREGATE_LABELS).map(([k, label]) => (
            <option key={k} value={k} disabled={k !== "count" && numbers.length === 0}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {numbers.length === 0 && (
        <p className="db-panel-meta">Añade una propiedad de tipo número para sumar o promediar.</p>
      )}
      {chart.aggregate !== "count" && (
        <label>
          De la propiedad
          <select
            value={chart.value ?? ""}
            onChange={(e) => save({ ...chart, value: e.target.value })}
          >
            {numbers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {chart.type !== "number" && chart.type !== "line" && (
        <label>
          Orden
          <select
            value={chart.sort}
            onChange={(e) => save({ ...chart, sort: e.target.value as ChartSort })}
          >
            <option value="x">Como el eje X</option>
            <option value="desc">De mayor a menor</option>
            <option value="asc">De menor a mayor</option>
          </select>
        </label>
      )}
    </div>
  );
}
