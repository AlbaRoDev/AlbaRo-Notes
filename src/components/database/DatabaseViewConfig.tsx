import { useEffect, useRef, useState } from "react";
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
  Trash2,
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
  TagColor,
  ViewConfig,
  ViewInfo,
  ViewKind,
} from "../../types";
import { Cell } from "./DatabaseCells";
import { TYPE_ICONS, optionColor } from "./property-types";
import {
  GRANULARITY_LABELS,
  OPERATORS,
  operatorLabel,
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
  // On a narrow screen the tabs scroll: the active one is brought into view (the page itself is left alone).
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = list.current;
    const tab = box?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!box || !tab) return;
    const [from, to] = [
      tab.offsetLeft - box.offsetLeft,
      tab.offsetLeft - box.offsetLeft + tab.offsetWidth,
    ];
    if (from < box.scrollLeft) box.scrollLeft = from;
    else if (to > box.scrollLeft + box.clientWidth) box.scrollLeft = to - box.clientWidth;
  }, [activeId]);
  return (
    <div className="db-tabs">
      {/* its own scroller, so the «+» menu below is not clipped when a narrow screen scrolls the tabs */}
      <div className="db-tabs-list" role="tablist" aria-label={t("Vistas")} ref={list}>
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
      </div>
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

type RuleValueType = FilterRule["value"];

/** What a select, tags or relation rule lists: one value or several. */
const pickedOf = (value: RuleValueType): string[] =>
  Array.isArray(value) ? value : typeof value === "string" ? [value] : [];

/**
 * Notion's way to say which values go in: every choice of the property is listed and ticking one includes it.
 * Rust matches a row against any of the ticked values (tags and relations also have «contiene todas»).
 */
function ChoiceList({
  choices,
  picked,
  onChange,
}: {
  choices: { value: string; label: string; color?: TagColor }[];
  picked: string[];
  onChange: (next: string[] | undefined) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = choices.filter((c) => fold(c.label).includes(fold(query.trim())));
  const toggle = (value: string) => {
    const next = picked.includes(value) ? picked.filter((v) => v !== value) : [...picked, value];
    onChange(next.length > 0 ? next : undefined);
  };
  return (
    <div className="fl-choices">
      {choices.length > 6 && (
        <input
          type="text"
          value={query}
          placeholder={t("Buscar…")}
          aria-label={t("Buscar…")}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <ul>
        {shown.map((c) => (
          <li key={c.value}>
            <label className="db-check fl-choice">
              <input
                type="checkbox"
                checked={picked.includes(c.value)}
                onChange={() => toggle(c.value)}
              />
              <span className="db-chip db-tag" data-color={c.color}>
                {c.label}
              </span>
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="fl-empty">{t("Sin resultados")}</li>}
      </ul>
    </div>
  );
}

function RuleValue({
  rule,
  prop,
  targetRows,
  onValue,
}: {
  rule: FilterRule;
  prop: Property;
  targetRows: DatabaseRow[];
  onValue: (value: RuleValueType) => void;
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
  if (prop.type === "select" || prop.type === "tags" || prop.type === "relation") {
    const choices =
      prop.type === "relation"
        ? targetRows.map((r) => ({ value: r.pageId, label: r.title || t("Sin título") }))
        : (prop.config.options ?? []).map((o) => ({
            value: o,
            label: o,
            color: optionColor(prop, o),
          }));
    return <ChoiceList choices={choices} picked={pickedOf(rule.value)} onChange={onValue} />;
  }
  // The same typed cells as the table: native date/number inputs commit on blur, never per keystroke.
  return (
    <Cell
      key={String(rule.value ?? "")}
      prop={prop}
      value={typeof rule.value === "object" ? undefined : rule.value}
      targetRows={[]}
      single
      commit={(v) => {
        onValue(typeof v === "string" || typeof v === "number" ? v : undefined);
        return Promise.resolve(true);
      }}
    />
  );
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Notion's first step: a searchable list of the properties, instead of a rule to edit field by field. */
function PropertyPicker({
  properties,
  onPick,
  onCancel,
}: {
  properties: Property[];
  onPick: (p: Property) => void;
  onCancel?: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = properties.filter((p) => fold(p.name).includes(fold(query.trim())));
  return (
    <div className="fl-picker">
      <input
        // a finger gets the list of properties; the keyboard comes only if the search box is tapped
        autoFocus={!matchMedia("(pointer: coarse)").matches}
        type="text"
        value={query}
        placeholder={t("Filtrar por…")}
        aria-label={t("Filtrar por…")}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && shown[0]) onPick(shown[0]);
          // Esc closes the list but not the panel around it
          if (e.key === "Escape" && onCancel) {
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <ul>
        {shown.map((p) => {
          const Icon = TYPE_ICONS[p.type];
          return (
            <li key={p.id}>
              <button type="button" onClick={() => onPick(p)}>
                <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
                {p.name}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="fl-empty">{t("Sin resultados")}</li>}
      </ul>
    </div>
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
  const [adding, setAdding] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const added = useRef(false);

  // a new rule starts with its type's first operator (the select shows «Marcada»: the rule must hold it, or it
  // would look active and not be) and the cursor goes to its value, so a filter is two clicks and a word
  const ruleFor = (p: Property): FilterRule => ({
    property: p.id,
    operator: OPERATORS[p.type][0],
    ...(p.type === "checkbox" ? { value: true } : {}),
  });
  useEffect(() => {
    if (!added.current) return;
    added.current = false;
    const last = [...(root.current?.querySelectorAll(".fl-rule") ?? [])].pop();
    last?.querySelector<HTMLElement>(".fl-value :is(input, select, [role=combobox])")?.focus();
  }, [rules.length]);

  return (
    <div ref={root} className="db-panel filter-panel" role="group" aria-label={t("Filtrar")}>
      {rules.map((rule, i) => {
        const prop = byId.get(rule.property) ?? TITLE_PROPERTY;
        return (
          <div key={i} className="fl-rule">
            {i === 0 ? (
              <span className="fl-join">{t("Donde")}</span>
            ) : i === 1 ? (
              <select
                className="fl-join"
                value={config.filter.op}
                aria-label={t("Combinar filtros")}
                onChange={(e) => set(rules, e.target.value as "and" | "or")}
              >
                <option value="and">Y</option>
                <option value="or">O</option>
              </select>
            ) : (
              <span className="fl-join">{config.filter.op === "and" ? "Y" : "O"}</span>
            )}
            <PropertySelect
              value={rule.property}
              properties={all}
              label={t("Filtrar por (regla {n1})", { n1: i + 1 })}
              onChange={(property) =>
                set(
                  rules.map((r, j) =>
                    j === i ? ruleFor(byId.get(property) ?? TITLE_PROPERTY) : r,
                  ),
                )
              }
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
                  {operatorLabel(prop.type, op)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="fl-ghost"
              aria-label={t("Quitar filtro {n1}", { n1: i + 1 })}
              title={t("Quitar filtro")}
              onClick={() => set(rules.filter((_, j) => j !== i))}
            >
              <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {needsValue(rule.operator) && (
              <div className="fl-value">
                <RuleValue
                  rule={rule}
                  prop={prop}
                  targetRows={rowsOf(prop)}
                  onValue={(value) => patch(i, { value })}
                />
              </div>
            )}
          </div>
        );
      })}
      {adding || rules.length === 0 ? (
        <PropertyPicker
          properties={all}
          onCancel={rules.length > 0 ? () => setAdding(false) : undefined}
          onPick={(p) => {
            added.current = true;
            setAdding(false);
            set([...rules, ruleFor(p)]);
          }}
        />
      ) : (
        <div className="fl-footer">
          <button type="button" className="fl-ghost" onClick={() => setAdding(true)}>
            <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
            {t("Añadir filtro")}
          </button>
          <button type="button" className="fl-ghost fl-danger" onClick={() => set([])}>
            <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
            {t("Borrar filtros")}
          </button>
        </div>
      )}
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
