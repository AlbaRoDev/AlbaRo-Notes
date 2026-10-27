import type { ChartPoint, ChartType } from "../../types";
import "./views.css";

/** Readable on both the light and the dark theme. */
const PALETTE = [
  "#4a90e2",
  "#e2874a",
  "#4ab38a",
  "#c25ab0",
  "#d4b84a",
  "#7a6ae2",
  "#e24a5a",
  "#5ab0c2",
];
const color = (i: number) => PALETTE[i % PALETTE.length];

const fmt = (n: number) => new Intl.NumberFormat("es", { maximumFractionDigits: 2 }).format(n);
const short = (label: string, max: number) =>
  label.length > max ? `${label.slice(0, max - 1)}…` : label;

/** Round ticks covering [min, max]; the axis always includes zero. */
function niceTicks(min: number, max: number, count = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (lo === hi) return [0, 1];
  const raw = (hi - lo) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  const ticks: number[] = [];
  for (
    let t = Math.floor(lo / step) * step;
    t <= Math.ceil(hi / step) * step + step / 1000;
    t += step
  )
    ticks.push(Math.round(t / step) * step);
  return ticks;
}

interface Drawn {
  points: ChartPoint[];
  /** What the Y axis says, e.g. «Suma de Esfuerzo». */
  measure: string;
}

const values = (points: ChartPoint[]) => points.map((p) => p.value ?? 0);

/** One axis with bars or a line, vertical. */
function Cartesian({ points, line, measure }: Drawn & { line: boolean }) {
  const step = 56;
  const left = 46;
  const top = 18;
  const plotH = 190;
  const bottom = 58;
  const width = left + points.length * step + 10;
  const height = top + plotH + bottom;
  const vs = values(points);
  const ticks = niceTicks(Math.min(...vs), Math.max(...vs));
  const [lo, hi] = [ticks[0], ticks[ticks.length - 1]];
  const y = (v: number) => top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const x = (i: number) => left + i * step + step / 2;
  const every = Math.ceil(points.length / 14); // thin the x labels out when there are many

  return (
    <div className="chart-scroll">
      <svg
        className="chart-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={measure}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={left}
              x2={width - 6}
              y1={y(t)}
              y2={y(t)}
              className={t === 0 ? "chart-axis" : "chart-grid"}
            />
            <text x={left - 6} y={y(t) + 4} textAnchor="end" className="chart-tick">
              {fmt(t)}
            </text>
          </g>
        ))}
        {line ? (
          <>
            <polyline
              fill="none"
              stroke={color(0)}
              strokeWidth={2}
              strokeLinejoin="round"
              points={points.map((p, i) => `${x(i)},${y(p.value ?? 0)}`).join(" ")}
            />
            {points.map((p, i) => (
              <circle key={p.key + i} cx={x(i)} cy={y(p.value ?? 0)} r={4} fill={color(0)}>
                <title>{`${p.label}: ${p.value === null ? "—" : fmt(p.value)}`}</title>
              </circle>
            ))}
          </>
        ) : (
          points.map((p, i) => {
            const v = p.value ?? 0;
            return (
              <g key={p.key + i}>
                <rect
                  x={x(i) - step * 0.32}
                  width={step * 0.64}
                  y={Math.min(y(v), y(0))}
                  height={Math.abs(y(v) - y(0))}
                  rx={3}
                  fill={color(i)}
                >
                  <title>{`${p.label}: ${p.value === null ? "—" : fmt(p.value)}`}</title>
                </rect>
                <text
                  x={x(i)}
                  y={(v >= 0 ? y(v) : y(0)) - 5}
                  textAnchor="middle"
                  className="chart-value"
                >
                  {p.value === null ? "—" : fmt(v)}
                </text>
              </g>
            );
          })
        )}
        {points.map((p, i) =>
          i % every === 0 ? (
            <text
              key={`l${p.key}${i}`}
              x={x(i)}
              y={top + plotH + 16}
              textAnchor="end"
              className="chart-label"
              transform={`rotate(-30 ${x(i)} ${top + plotH + 16})`}
            >
              {short(p.label, 14)}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

function Horizontal({ points, measure }: Drawn) {
  const rowH = 30;
  const left = 130;
  const plotW = 340;
  const height = points.length * rowH + 8;
  const vs = values(points);
  const ticks = niceTicks(Math.min(...vs), Math.max(...vs));
  const [lo, hi] = [ticks[0], ticks[ticks.length - 1]];
  const x = (v: number) => left + ((v - lo) / (hi - lo)) * plotW;
  return (
    <div className="chart-scroll">
      <svg
        className="chart-svg"
        width={left + plotW + 70}
        height={height}
        viewBox={`0 0 ${left + plotW + 70} ${height}`}
        role="img"
        aria-label={measure}
      >
        <line x1={x(0)} x2={x(0)} y1={0} y2={height} className="chart-axis" />
        {points.map((p, i) => {
          const v = p.value ?? 0;
          return (
            <g key={p.key + i}>
              <text
                x={left - 8}
                y={i * rowH + rowH / 2 + 5}
                textAnchor="end"
                className="chart-label"
              >
                {short(p.label, 18)}
              </text>
              <rect
                x={Math.min(x(v), x(0))}
                width={Math.abs(x(v) - x(0))}
                y={i * rowH + 5}
                height={rowH - 10}
                rx={3}
                fill={color(i)}
              >
                <title>{`${p.label}: ${p.value === null ? "—" : fmt(p.value)}`}</title>
              </rect>
              <text
                x={Math.max(x(v), x(0)) + 6}
                y={i * rowH + rowH / 2 + 5}
                className="chart-value"
              >
                {p.value === null ? "—" : fmt(v)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** `additive`: the values add up to a meaningful whole (counts, sums), so shares and a total make sense. */
function Donut({ points, measure, additive }: Drawn & { additive: boolean }) {
  // A ring only shows positive shares; the rest still appear in the legend.
  const positive = points.map((p) => (p.value !== null && p.value > 0 ? p.value : 0));
  const total = positive.reduce((a, b) => a + b, 0);
  const r = 70;
  const circumference = 2 * Math.PI * r;
  // where each arc starts: the sum of the lengths before it
  const lengths = positive.map((v) => (total === 0 ? 0 : (v / total) * circumference));
  const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <div className="chart-donut">
      <svg width={190} height={190} viewBox="0 0 190 190" role="img" aria-label={measure}>
        {total === 0 && (
          <circle
            cx={95}
            cy={95}
            r={r}
            fill="none"
            stroke="rgba(127,127,127,0.25)"
            strokeWidth={28}
          />
        )}
        {positive.map((v, i) => {
          if (v === 0) return null;
          const length = lengths[i];
          return (
            <circle
              key={points[i].key + i}
              cx={95}
              cy={95}
              r={r}
              fill="none"
              stroke={color(i)}
              strokeWidth={28}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-starts[i]}
              transform="rotate(-90 95 95)"
            >
              <title>{`${points[i].label}: ${fmt(v)}`}</title>
            </circle>
          );
        })}
        {additive && (
          <text x={95} y={101} textAnchor="middle" className="chart-center">
            {fmt(total)}
          </text>
        )}
      </svg>
      <ul className="chart-legend">
        {points.map((p, i) => (
          <li key={p.key + i}>
            <span className="chart-swatch" style={{ background: color(i) }} aria-hidden="true" />
            <span className="chart-legend-label">{p.label}</span>
            <span className="chart-legend-value">
              {p.value === null ? "—" : fmt(p.value)}
              {additive &&
                total > 0 &&
                positive[i] > 0 &&
                ` (${Math.round((positive[i] / total) * 100)}%)`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Draws a chart from points it is handed: bars, a line, a ring or one big number.
 * It knows nothing about where the points come from (a database view, or a block's own entries).
 * `additive`: the values add up to a meaningful whole (counts, sums), so shares and a total make sense.
 */
export function ChartCanvas({
  type,
  points,
  measure,
  additive,
}: {
  type: ChartType;
  points: ChartPoint[];
  measure: string;
  additive: boolean;
}) {
  if (type === "number") {
    const value = points[0]?.value;
    return (
      <div className="chart-number">
        <strong>{value === null || value === undefined ? "—" : fmt(value)}</strong>
        <span>{measure}</span>
      </div>
    );
  }
  return (
    <div className="chart-view">
      <p className="chart-measure">{measure}</p>
      {type === "bar" && <Cartesian points={points} measure={measure} line={false} />}
      {type === "line" && <Cartesian points={points} measure={measure} line />}
      {type === "hbar" && <Horizontal points={points} measure={measure} />}
      {type === "donut" && <Donut points={points} measure={measure} additive={additive} />}
    </div>
  );
}
