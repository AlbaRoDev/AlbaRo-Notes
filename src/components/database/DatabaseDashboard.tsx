import { useState } from "react";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import type { DashboardWidget, DatabaseRow, Property, ViewConfig, ViewResult } from "../../types";
import { ChartCanvas } from "../views/ChartCanvas";
import { ChartPanel } from "./DatabaseChart";
import { FilterPanel, GroupPanel } from "./DatabaseViewConfig";
import { measureLabel, normalizeChart } from "./view-config";
import "./DatabaseView.css";

const MAX_WIDGETS = 12; // mirrors views.rs

/** What a widget is called when it has no title of its own: «Recuento por Estado». */
function autoTitle(widget: DashboardWidget, properties: Property[]): string {
  const chart = normalizeChart(widget.chart);
  const measure = measureLabel(chart, properties);
  const axis = properties.find((p) => p.id === widget.group?.property)?.name;
  return chart.type === "number" || !axis ? measure : `${measure} por ${axis}`;
}

/** Edits one widget by lending it to the same panels a chart view uses (type, X axis, filter). */
function WidgetEditor({
  widget,
  properties,
  rowsOf,
  onChange,
  onClose,
}: {
  widget: DashboardWidget;
  properties: Property[];
  rowsOf: (p: Property) => DatabaseRow[];
  onChange: (patch: Partial<DashboardWidget>) => void;
  onClose: () => void;
}) {
  // The panels edit a ViewConfig; a widget is the same three parts, so it is wrapped and unwrapped here.
  const asConfig: ViewConfig = {
    sorts: [],
    filter: widget.filter,
    chart: widget.chart,
    ...(widget.group ? { group: widget.group } : {}),
  };
  const fromConfig = (next: ViewConfig) =>
    onChange({ filter: next.filter, chart: next.chart ?? widget.chart, group: next.group });
  return (
    <div
      className="dash-editor"
      role="group"
      aria-label="Editar widget"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="db-panel">
        <label>
          Título
          <input
            type="text"
            maxLength={100}
            defaultValue={widget.title ?? ""}
            placeholder={autoTitle(widget, properties)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onBlur={(e) => {
              const title = e.currentTarget.value.trim();
              if (title !== (widget.title ?? "")) onChange({ title: title || undefined });
            }}
          />
        </label>
        <label className="db-check">
          <input
            type="checkbox"
            checked={widget.wide}
            onChange={(e) => onChange({ wide: e.target.checked })}
          />
          Ocupar todo el ancho
        </label>
      </div>
      <ChartPanel config={asConfig} properties={properties} onChange={fromConfig} />
      {widget.chart.type !== "number" && (
        <GroupPanel config={asConfig} properties={properties} kind="chart" onChange={fromConfig} />
      )}
      <FilterPanel
        config={asConfig}
        properties={properties}
        rowsOf={rowsOf}
        onChange={fromConfig}
      />
      <div className="db-panel-actions">
        <button type="button" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}

/** The dashboard view: a grid of widgets, each a chart or a number with its own calculation. Rust computes them; this lays them out. */
export function DatabaseDashboard({
  config,
  result,
  properties,
  rowsOf,
  onChange,
}: {
  config: ViewConfig;
  result: ViewResult | null | undefined;
  properties: Property[];
  rowsOf: (p: Property) => DatabaseRow[];
  onChange: (next: ViewConfig) => void;
}) {
  const widgets = config.dashboard?.widgets ?? [];
  const computed = result?.widgets ?? [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const save = (next: DashboardWidget[]) => onChange({ ...config, dashboard: { widgets: next } });
  const patch = (id: string, change: Partial<DashboardWidget>) =>
    save(widgets.map((w) => (w.id === id ? { ...w, ...change } : w)));
  const add = () => {
    const created: DashboardWidget = {
      id: crypto.randomUUID(),
      chart: { type: "number" },
      filter: { op: "and", rules: [] },
      wide: false,
    };
    save([...widgets, created]);
    setEditingId(created.id);
  };
  const move = (id: string, by: -1 | 1) => {
    const from = widgets.findIndex((w) => w.id === id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= widgets.length) return;
    const next = [...widgets];
    [next[from], next[to]] = [next[to], next[from]];
    save(next);
  };

  return (
    <div className="dash">
      {widgets.length === 0 && (
        <p className="db-loading">
          Este panel está vacío: añade un widget para ver un número o un gráfico.
        </p>
      )}
      <div className="dash-grid">
        {widgets.map((w, i) => {
          const points = computed[i]?.points ?? [];
          const chart = normalizeChart(w.chart);
          const editing = editingId === w.id;
          return (
            <section
              key={w.id}
              className="dash-widget"
              data-wide={w.wide}
              aria-label={w.title || autoTitle(w, properties)}
            >
              <header className="dash-widget-head">
                <h4>{w.title || autoTitle(w, properties)}</h4>
                <span className="dash-widget-actions">
                  <button
                    type="button"
                    className="db-icon-btn"
                    aria-label="Subir widget"
                    disabled={i === 0}
                    onClick={() => move(w.id, -1)}
                  >
                    <ArrowUp size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="db-icon-btn"
                    aria-label="Bajar widget"
                    disabled={i === widgets.length - 1}
                    onClick={() => move(w.id, 1)}
                  >
                    <ArrowDown size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-expanded={editing}
                    onClick={() => setEditingId(editing ? null : w.id)}
                  >
                    Editar
                  </button>
                  {confirmId === w.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          save(widgets.filter((x) => x.id !== w.id));
                          setConfirmId(null);
                          if (editing) setEditingId(null);
                        }}
                      >
                        Borrar
                      </button>
                      <button type="button" onClick={() => setConfirmId(null)}>
                        No
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmId(w.id)}>
                      Quitar
                    </button>
                  )}
                </span>
              </header>
              {editing && (
                <WidgetEditor
                  widget={w}
                  properties={properties}
                  rowsOf={rowsOf}
                  onChange={(change) => patch(w.id, change)}
                  onClose={() => setEditingId(null)}
                />
              )}
              {chart.type !== "number" && !w.group ? (
                <p className="db-loading">Elige el eje X en «Editar».</p>
              ) : chart.type !== "number" && points.length === 0 ? (
                <p className="db-loading">No hay datos que mostrar.</p>
              ) : (
                <ChartCanvas
                  type={chart.type}
                  points={points}
                  measure={measureLabel(chart, properties)}
                  additive={chart.aggregate === "count" || chart.aggregate === "sum"}
                />
              )}
            </section>
          );
        })}
      </div>
      <button
        type="button"
        className="db-add-row"
        disabled={widgets.length >= MAX_WIDGETS}
        onClick={add}
      >
        <Plus size={14} strokeWidth={1.75} aria-hidden="true" /> Añadir widget
      </button>
    </div>
  );
}
