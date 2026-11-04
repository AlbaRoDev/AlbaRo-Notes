import { useState } from "react";
import {
  CalendarDays,
  ChartColumn,
  ChartNoAxesGantt,
  ClipboardList,
  Columns3,
  LayoutDashboard,
  LayoutGrid,
  List,
  Map as MapIcon,
  Newspaper,
  Plus,
  Table as TableIcon,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  DatabaseRow,
  Direction,
  FilterRule,
  Granularity,
  Property,
  SortRule,
  ViewConfig,
  ViewInfo,
  ViewKind,
} from "../../types";
import { Cell } from "./DatabaseCells";
import {
  GRANULARITY_LABELS,
  OPERATORS,
  OPERATOR_LABELS,
  TITLE_ID,
  TITLE_PROPERTY,
  VIEW_KIND_LABELS,
  needsValue,
} from "./view-config";
import { t } from "../../lib/i18n.ts";

type OnChange = (next: ViewConfig) => void;

/** The properties a rule can target: the title plus every real property. */
const withTitle = (properties: Property[]) => [TITLE_PROPERTY, ...properties];

function PropertySelect({
  value,
  properties,
  label,
  onChange,
}: {
  value: string;
  properties: Property[];
  label: string;
  onChange: (id: string) => void;
}) {
  return (
    <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      {properties.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

// ------------------------------------------------------------------ tabs

const KIND_ICONS: Record<ViewKind, LucideIcon> = {
  table: TableIcon,
  list: List,
  gallery: LayoutGrid,
  feed: Newspaper,
  board: Columns3,
  calendar: CalendarDays,
  timeline: ChartNoAxesGantt,
  map: MapIcon,
  form: ClipboardList,
  chart: ChartColumn,
  dashboard: LayoutDashboard,
};

/** One tab per saved view; clicking the active one opens its settings. */
export function ViewTabs({
  views,
  activeId,
  settingsOpen,
  onSelect,
  onToggleSettings,
  onAdd,
  onDelete,
}: {
  views: ViewInfo[];
  activeId: string;
  settingsOpen: boolean;
  onSelect: (id: string) => void;
  onToggleSettings: () => void;
  onAdd: (kind: ViewKind) => void;
  /** Removes a view (the last one can't go: Rust refuses and the × isn't offered). */
  onDelete: (view: ViewInfo) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="db-tabs" role="tablist" aria-label={t("Vistas")}>
      {views.map((v) => (
        <span key={v.id} className="db-tab-wrap">
          <button
            type="button"
            role="tab"
            className="db-tab"
            aria-selected={v.id === activeId}
            aria-expanded={v.id === activeId ? settingsOpen : undefined}
            title={v.id === activeId ? t("Ajustes de la vista") : undefined}
            onClick={() => (v.id === activeId ? onToggleSettings() : onSelect(v.id))}
          >
            {(() => {
              const Icon = KIND_ICONS[v.type];
              return (
                <Icon
                  size={13}
                  strokeWidth={1.75}
                  aria-label={VIEW_KIND_LABELS[v.type]}
                  className="db-tab-icon"
                />
              );
            })()}
            {v.name}
          </button>
          {views.length > 1 && (
            <button
              type="button"
              className="db-tab-close"
              aria-label={t("Borrar la vista {name}", { name: v.name })}
              title={t("Borrar la vista")}
              onClick={() => onDelete(v)}
            >
              <X size={12} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      <button
        type="button"
        className="db-icon-btn"
        aria-label={t("Añadir vista")}
        title={t("Añadir vista")}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {menuOpen && (
        <div
          className="db-menu"
          role="menu"
          onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}
        >
          {(Object.keys(VIEW_KIND_LABELS) as ViewKind[]).map((kind) => {
            const Icon = KIND_ICONS[kind];
            return (
              <button
                key={kind}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onAdd(kind);
                }}
              >
                <Icon size={13} strokeWidth={1.75} aria-hidden="true" /> {VIEW_KIND_LABELS[kind]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ViewSettingsPanel({
  view,
  canDelete,
  onRename,
  onDelete,
  onClose,
}: {
  view: ViewInfo;
  canDelete: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div
      className="db-panel"
      role="group"
      aria-label={t("Vista {name}", { name: view.name })}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <label>
        {t("Nombre de la vista")}
        <input
          autoFocus
          type="text"
          maxLength={60}
          defaultValue={view.name}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={(e) => {
            const name = e.currentTarget.value.trim();
            if (name && name !== view.name) onRename(name);
            else e.currentTarget.value = view.name;
          }}
        />
      </label>
      <div className="db-panel-actions">
        {confirming ? (
          <>
            <span>{t("¿Borrar la vista? Los datos no se borran.")}</span>
            <button type="button" onClick={onDelete}>
              {t("Sí, borrar")}
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              {t("No")}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={!canDelete}
            title={canDelete ? undefined : t("Una base de datos necesita al menos una vista")}
            onClick={() => setConfirming(true)}
          >
            {t("Borrar vista")}
          </button>
        )}
        <button type="button" onClick={onClose}>
          {t("Cerrar")}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ sort

export function SortPanel({
  config,
  properties,
  onChange,
}: {
  config: ViewConfig;
  properties: Property[];
  onChange: OnChange;
}) {
  const all = withTitle(properties);
  const set = (sorts: SortRule[]) => onChange({ ...config, sorts });
  return (
    <div className="db-panel" role="group" aria-label={t("Ordenar")}>
      {config.sorts.length === 0 && (
        <p className="db-panel-meta">{t("Sin orden: las filas salen por fecha de creación.")}</p>
      )}
      {config.sorts.map((rule, i) => (
        <div key={i} className="db-rule">
          <PropertySelect
            value={rule.property}
            properties={all}
            label={t("Ordenar por (regla {n1})", { n1: i + 1 })}
            onChange={(property) =>
              set(config.sorts.map((r, j) => (j === i ? { ...r, property } : r)))
            }
          />
          <select
            value={rule.direction}
            aria-label={t("Dirección (regla {n1})", { n1: i + 1 })}
            onChange={(e) =>
              set(
                config.sorts.map((r, j) =>
                  j === i ? { ...r, direction: e.target.value as Direction } : r,
                ),
              )
            }
          >
            <option value="asc">{t("Ascendente")}</option>
            <option value="desc">{t("Descendente")}</option>
          </select>
          <button
            type="button"
            className="db-icon-btn"
            aria-label={t("Quitar orden {n1}", { n1: i + 1 })}
            onClick={() => set(config.sorts.filter((_, j) => j !== i))}
          >
            <X size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      ))}
      <div className="db-panel-actions">
        <button
          type="button"
          onClick={() => set([...config.sorts, { property: TITLE_ID, direction: "asc" }])}
        >
          {t("+ Añadir orden")}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ filter

function RuleValue({
  rule,
  prop,
  targetRows,
  onValue,
}: {
  rule: FilterRule;
  prop: Property;
  targetRows: DatabaseRow[];
  onValue: (value: string | number | boolean | undefined) => void;
}) {
  if (prop.type === "checkbox") {
    return (
      <select
        value={rule.value === false ? "false" : "true"}
        aria-label={t("Valor del filtro")}
        onChange={(e) => onValue(e.target.value === "true")}
      >
        <option value="true">{t("Marcada")}</option>
        <option value="false">{t("Sin marcar")}</option>
      </select>
    );
  }
  if (prop.type === "tags") {
    return (
      <select
        value={typeof rule.value === "string" ? rule.value : ""}
        aria-label={t("Valor del filtro")}
        onChange={(e) => onValue(e.target.value || undefined)}
      >
        <option value="">{t("Elegir etiqueta…")}</option>
        {(prop.config.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (prop.type === "relation") {
    return (
      <select
        value={typeof rule.value === "string" ? rule.value : ""}
        aria-label={t("Valor del filtro")}
        onChange={(e) => onValue(e.target.value || undefined)}
      >
        <option value="">{t("Elegir fila…")}</option>
        {targetRows.map((r) => (
          <option key={r.pageId} value={r.pageId}>
            {r.title}
          </option>
        ))}
      </select>
    );
  }
  // The same typed cells as the table: native date/number inputs commit on blur, never per keystroke.
  return (
    <Cell
      key={String(rule.value ?? "")}
      prop={prop}
      value={rule.value}
      targetRows={[]}
      single
      commit={(v) => {
        onValue(typeof v === "string" || typeof v === "number" ? v : undefined);
        return Promise.resolve(true);
      }}
    />
  );
}

export function FilterPanel({
  config,
  properties,
  rowsOf,
  onChange,
}: {
  config: ViewConfig;
  properties: Property[];
  rowsOf: (p: Property) => DatabaseRow[];
  onChange: OnChange;
}) {
  const all = withTitle(properties);
  const byId = new Map(all.map((p) => [p.id, p]));
  const rules = config.filter.rules;
  const set = (next: FilterRule[], op = config.filter.op) =>
    onChange({ ...config, filter: { op, rules: next } });
  const patch = (i: number, change: Partial<FilterRule>) =>
    set(rules.map((r, j) => (j === i ? { ...r, ...change } : r)));

  return (
    <div className="db-panel" role="group" aria-label={t("Filtrar")}>
      {rules.length === 0 && (
        <p className="db-panel-meta">{t("Sin filtros: se ven todas las filas.")}</p>
      )}
      {rules.map((rule, i) => {
        const prop = byId.get(rule.property) ?? TITLE_PROPERTY;
        return (
          <div key={i} className="db-rule">
            {i === 0 ? (
              <span className="db-rule-join">{t("Donde")}</span>
            ) : i === 1 ? (
              <select
                className="db-rule-join"
                value={config.filter.op}
                aria-label={t("Combinar filtros")}
                onChange={(e) => set(rules, e.target.value as "and" | "or")}
              >
                <option value="and">Y</option>
                <option value="or">O</option>
              </select>
            ) : (
              <span className="db-rule-join">{config.filter.op === "and" ? "Y" : "O"}</span>
            )}
            <PropertySelect
              value={rule.property}
              properties={all}
              label={t("Filtrar por (regla {n1})", { n1: i + 1 })}
              onChange={(property) => {
                // a different property means different operators and a value of another type
                const next = byId.get(property) ?? TITLE_PROPERTY;
                set(
                  rules.map((r, j) =>
                    j === i
                      ? {
                          property,
                          operator: OPERATORS[next.type][0],
                          // the select shows «Marcada»: the rule must hold it, or it would look active and not be
                          ...(next.type === "checkbox" ? { value: true } : {}),
                        }
                      : r,
                  ),
                );
              }}
            />
            <select
              value={rule.operator}
              aria-label={t("Operador (regla {n1})", { n1: i + 1 })}
              onChange={(e) => {
                const operator = e.target.value as FilterRule["operator"];
                patch(i, needsValue(operator) ? { operator } : { operator, value: undefined });
              }}
            >
              {OPERATORS[prop.type].map((op) => (
                <option key={op} value={op}>
                  {OPERATOR_LABELS[op]}
                </option>
              ))}
            </select>
            {needsValue(rule.operator) && (
              <RuleValue
                rule={rule}
                prop={prop}
                targetRows={rowsOf(prop)}
                onValue={(value) => patch(i, { value })}
              />
            )}
            <button
              type="button"
              className="db-icon-btn"
              aria-label={t("Quitar filtro {n1}", { n1: i + 1 })}
              onClick={() => set(rules.filter((_, j) => j !== i))}
            >
              <X size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <div className="db-panel-actions">
        <button
          type="button"
          onClick={() => set([...rules, { property: TITLE_ID, operator: "contains" }])}
        >
          {t("+ Añadir filtro")}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ group

export function GroupPanel({
  config,
  properties,
  kind,
  onChange,
}: {
  config: ViewConfig;
  properties: Property[];
  kind: ViewKind;
  onChange: OnChange;
}) {
  const group = config.group;
  const prop = properties.find((p) => p.id === group?.property);
  // A board's columns are the options of a select (Rust enforces it too).
  const candidates = kind === "board" ? properties.filter((p) => p.type === "select") : properties;
  return (
    <div className="db-panel" role="group" aria-label={t("Agrupar")}>
      <label>
        {kind === "board"
          ? t("Columnas (propiedad de selección)")
          : kind === "chart"
            ? t("Eje X (agrupar por)")
            : t("Agrupar por")}
        <select
          value={group?.property ?? ""}
          onChange={(e) => {
            // keep everything else the view has (hidden properties, chart, form…): only the group changes
            const base: ViewConfig = { ...config };
            delete base.group;
            onChange(
              e.target.value
                ? { ...base, group: { property: e.target.value, hideEmpty: false } }
                : base,
            );
          }}
        >
          <option value="">{t("Ninguno")}</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {group && prop?.type === "date" && (
        <label>
          {t("Agrupar fechas por")}
          <select
            value={group.granularity ?? "month"}
            onChange={(e) =>
              onChange({
                ...config,
                group: { ...group, granularity: e.target.value as Granularity },
              })
            }
          >
            {Object.entries(GRANULARITY_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      {group && (prop?.type === "select" || prop?.type === "tags") && (
        <label className="db-check">
          <input
            type="checkbox"
            checked={group.hideEmpty}
            onChange={(e) =>
              onChange({ ...config, group: { ...group, hideEmpty: e.target.checked } })
            }
          />
          {t("Ocultar grupos vacíos")}
        </label>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ properties

/** Which properties this view shows, plus a way into each one's settings — card views have no column headers to click. */
export function PropertiesPanel({
  config,
  properties,
  kind,
  onChange,
  onEdit,
  onAdd,
}: {
  config: ViewConfig;
  properties: Property[];
  kind: ViewKind;
  onChange: OnChange;
  onEdit: (propertyId: string) => void;
  onAdd: () => void;
}) {
  const hidden = new Set(config.hiddenProperties ?? []);
  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (!next.delete(id)) next.add(id);
    const updated: ViewConfig = { ...config };
    if (next.size > 0) updated.hiddenProperties = [...next];
    else delete updated.hiddenProperties;
    onChange(updated);
  };
  return (
    <div className="db-panel" role="group" aria-label={t("Propiedades")}>
      <p className="db-panel-meta">{t("Propiedades visibles en esta vista")}</p>
      {properties.length === 0 && <p className="db-panel-meta">{t("Aún no hay propiedades.")}</p>}
      {properties.map((p) => (
        <div key={p.id} className="db-rule">
          <label className="db-check">
            <input type="checkbox" checked={!hidden.has(p.id)} onChange={() => toggle(p.id)} />
            {p.name}
          </label>
          <button type="button" onClick={() => onEdit(p.id)}>
            {t("Editar")}
          </button>
        </div>
      ))}
      {(kind === "gallery" || kind === "feed") && (
        <label className="db-check">
          <input
            type="checkbox"
            checked={config.showPreview !== false}
            onChange={(e) => onChange({ ...config, showPreview: e.target.checked })}
          />
          {t("Mostrar imagen y texto de la página")}
        </label>
      )}
      <div className="db-panel-actions">
        <button type="button" onClick={onAdd}>
          {t("+ Añadir propiedad")}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ date property

/** Which date property lays out a calendar or timeline (the first one unless chosen). */
export function DatePropertyPanel({
  config,
  properties,
  onChange,
  onAdd,
}: {
  config: ViewConfig;
  properties: Property[];
  onChange: OnChange;
  onAdd: () => void;
}) {
  const dates = properties.filter((p) => p.type === "date");
  const chosen = dates.find((p) => p.id === config.dateProperty) ?? dates[0];
  return (
    <div className="db-panel" role="group" aria-label={t("Fecha")}>
      {dates.length === 0 ? (
        <>
          <p className="db-panel-meta">
            {t("Esta base de datos aún no tiene ninguna propiedad de fecha.")}
          </p>
          <div className="db-panel-actions">
            <button type="button" onClick={onAdd}>
              {t("+ Añadir propiedad")}
            </button>
          </div>
        </>
      ) : (
        <label>
          {t("Mostrar por la fecha")}
          <select
            value={chosen?.id ?? ""}
            onChange={(e) => onChange({ ...config, dateProperty: e.target.value })}
          >
            {dates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="db-panel-meta">
        {t("Una fecha puede tener inicio y fin: en el cronograma forma una barra.")}
      </p>
    </div>
  );
}

/** Which place property supplies the map's pins (the first one unless chosen). */
export function PlacePropertyPanel({
  config,
  properties,
  onChange,
  onAdd,
}: {
  config: ViewConfig;
  properties: Property[];
  onChange: OnChange;
  onAdd: () => void;
}) {
  const places = properties.filter((p) => p.type === "place");
  const chosen = places.find((p) => p.id === config.placeProperty) ?? places[0];
  return (
    <div className="db-panel" role="group" aria-label={t("Lugar")}>
      {places.length === 0 ? (
        <>
          <p className="db-panel-meta">
            {t("Esta base de datos aún no tiene ninguna propiedad de tipo lugar.")}
          </p>
          <div className="db-panel-actions">
            <button type="button" onClick={onAdd}>
              {t("+ Añadir propiedad")}
            </button>
          </div>
        </>
      ) : (
        <label>
          {t("Mostrar los pins de")}
          <select
            value={chosen?.id ?? ""}
            onChange={(e) => onChange({ ...config, placeProperty: e.target.value })}
          >
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
