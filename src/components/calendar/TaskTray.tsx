import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Layers, ListChecks, ListFilter, type LucideIcon } from "lucide-react";
import { subscribeDatabaseChanges } from "../../lib/database-bus";
import { getDatabase, queryConfig } from "../../lib/db-client";
import { startItemDrag } from "../../lib/drag-item";
import { readPref, writePref } from "../../lib/prefs";
import type {
  DatabaseData,
  DatabaseRow,
  PageSummary,
  Property,
  ViewConfig,
  ViewResult,
} from "../../types";
import { FilterPanel, GroupPanel, SortPanel } from "../database/DatabaseViewConfig";
import { TITLE_ID, normalizeConfig } from "../database/view-config";

/** What the tray says: the calendar's by default; a board words its own. */
interface TrayLabels {
  pending: string;
  hint: string;
  pendingEmpty: string;
  dragTitle: string;
  /** A task can be dropped again after it is placed (the calendar): none ever leaves the tray. */
  repeatable?: boolean;
}

const CALENDAR_LABELS: TrayLabels = {
  pending: "Por programar",
  hint: "Arrastra una tarea al calendario; se puede programar varias veces.",
  pendingEmpty: "No hay tareas.",
  dragTitle: "arrástrala al calendario",
  repeatable: true,
};

type PanelKind = "filter" | "sort" | "group";
const PANELS: [PanelKind, string, LucideIcon][] = [
  ["filter", "Filtrar", ListFilter],
  ["sort", "Ordenar", ArrowUpDown],
  ["group", "Agrupar", Layers],
];

/** A stored config can name a property that was deleted since: Rust would refuse it, so those rules are dropped. */
function pruned(config: ViewConfig, properties: Property[]): ViewConfig {
  const known = new Set([TITLE_ID, ...properties.map((p) => p.id)]);
  const { group, ...rest } = config;
  return {
    ...rest,
    sorts: config.sorts.filter((s) => known.has(s.property)),
    filter: { ...config.filter, rules: config.filter.rules.filter((r) => known.has(r.property)) },
    ...(group && group.property !== TITLE_ID && known.has(group.property) ? { group } : {}),
  };
}

function readConfig(key: string | undefined): ViewConfig {
  try {
    return normalizeConfig(JSON.parse(readPref(key ?? "") ?? "{}") as Partial<ViewConfig>);
  } catch {
    return normalizeConfig(undefined);
  }
}

/**
 * The tasks to drag somewhere (the tray of Notion Calendar): the ones not placed yet, or all of them. «Placed» is
 * scheduled in the calendar, or on the open board.
 *
 * With `prefKey` the tray also filters, sorts and groups the task table like a database view does: the same
 * panels, evaluated by Rust, remembered under that key. The tasks' saved views are not touched.
 */
export function TaskTray({
  pages,
  scheduled,
  onOpen,
  labels = CALENDAR_LABELS,
  prefKey,
}: {
  pages: PageSummary[];
  /** Ids of the tasks that already have an entry. */
  scheduled: Set<string>;
  onOpen: (taskId: string) => void;
  labels?: TrayLabels;
  prefKey?: string;
}) {
  const [showPlaced, setAll] = useState(false);
  const all = showPlaced || !!labels.repeatable;
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<PanelKind | null>(null);
  const [config, setConfig] = useState(() => readConfig(prefKey));
  const [result, setResult] = useState<ViewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const baseId = pages.find((p) => p.role === "tasks")?.ownDatabaseId;
  const needle = query.trim().toLowerCase();

  // the task table's properties and values (read again after a task changes, here or in another view)
  const [database, setDatabase] = useState<DatabaseData | null>(null);
  const load = useCallback(() => {
    if (baseId && prefKey) getDatabase(baseId).then(setDatabase, () => {});
  }, [baseId, prefKey]);
  useEffect(load, [load, pages]);
  useEffect(() => subscribeDatabaseChanges(load), [load]);

  const properties = useMemo(() => database?.properties ?? [], [database]);
  const clean = useMemo(() => pruned(config, properties), [config, properties]);
  const active =
    !!database && (clean.sorts.length > 0 || clean.filter.rules.length > 0 || !!clean.group);
  useEffect(() => {
    if (!database || !active) return;
    let cancelled = false;
    queryConfig(database.id, clean).then(
      (r) => {
        if (cancelled) return;
        setResult(r);
        setError(null);
      },
      (e) => !cancelled && setError(String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [database, active, clean]);
  const shown = active && !error ? result : null;

  const change = (next: ViewConfig) => {
    setConfig(next);
    if (prefKey) writePref(prefKey, JSON.stringify(next));
  };
  // only the task table's own rows can be a filter's relation target
  const rowsOf = (p: Property): DatabaseRow[] =>
    p.config.target === database?.id ? (database?.rows ?? []) : [];

  const byId = new Map(pages.map((p) => [p.id, p]));
  const pick = (ids?: string[]) =>
    (ids ? ids.map((id) => byId.get(id)) : pages).filter(
      (p): p is PageSummary =>
        !!p &&
        !!baseId &&
        p.databaseId === baseId &&
        (all || !scheduled.has(p.id)) &&
        (!needle || p.title.toLowerCase().includes(needle)),
    );
  const sections = shown?.groups
    ? shown.groups.map((g) => ({ key: g.key, label: g.label, tasks: pick(g.rowIds) }))
    : [{ key: "", label: null, tasks: pick(shown?.rowIds) }];
  const empty = sections.every((s) => s.tasks.length === 0);
  const count: Record<PanelKind, number> = {
    filter: clean.filter.rules.length,
    sort: clean.sorts.length,
    group: clean.group ? 1 : 0,
  };

  return (
    <section className="cal-tray" aria-label="Tareas">
      <h3>Tareas</h3>
      <div className="cal-tray-tools">
        <input
          type="search"
          value={query}
          placeholder="Buscar…"
          aria-label="Buscar tareas"
          onChange={(e) => setQuery(e.target.value)}
        />
        {!labels.repeatable && (
          <div className="cal-tray-seg" role="group" aria-label="Qué tareas mostrar">
            <button type="button" aria-pressed={!all} onClick={() => setAll(false)}>
              {labels.pending}
            </button>
            <button type="button" aria-pressed={all} onClick={() => setAll(true)}>
              Todas
            </button>
          </div>
        )}
        {database && (
          <div className="cal-tray-config" role="group" aria-label="Filtrar, ordenar y agrupar">
            {PANELS.map(([kind, label, Icon]) => (
              <button
                key={kind}
                type="button"
                data-kind={kind}
                data-used={count[kind] > 0}
                aria-pressed={panel === kind}
                onClick={() => setPanel(panel === kind ? null : kind)}
              >
                <Icon size={13} aria-hidden="true" />
                {label}
                {count[kind] > 0 && <b>{count[kind]}</b>}
              </button>
            ))}
          </div>
        )}
      </div>
      {database && panel && (
        // The panels are the database view's own, styled by the same wrapper classes as a database page.
        <div className="page-editor">
          <div className="ProseMirror cal-tray-panel">
            {panel === "filter" && (
              <FilterPanel
                config={clean}
                properties={properties}
                rowsOf={rowsOf}
                onChange={change}
              />
            )}
            {panel === "sort" && (
              <SortPanel config={clean} properties={properties} onChange={change} />
            )}
            {panel === "group" && (
              <GroupPanel config={clean} properties={properties} kind="list" onChange={change} />
            )}
          </div>
        </div>
      )}
      {error && (
        <p className="cal-tray-empty" role="alert">
          {error}
        </p>
      )}
      <p className="cal-tray-hint">{labels.hint}</p>
      {empty ? (
        <p className="cal-tray-empty">{all || active ? "No hay tareas." : labels.pendingEmpty}</p>
      ) : (
        sections.map(
          (s) =>
            s.tasks.length > 0 && (
              <div key={s.key} className="cal-tray-section">
                {s.label !== null && <h4 className="cal-tray-group">{s.label}</h4>}
                <ul>
                  {s.tasks.map((task) => (
                    <li key={task.id}>
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => startItemDrag(e, { kind: "task", id: task.id })}
                        onClick={() => onOpen(task.id)}
                        title={`${task.title} — ${labels.dragTitle}`}
                      >
                        <ListChecks size={14} aria-hidden="true" />
                        <span>{task.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ),
        )
      )}
    </section>
  );
}
