import { useState } from "react";
import { ListChecks } from "lucide-react";
import { startItemDrag } from "../../lib/drag-item";
import type { PageSummary } from "../../types";

/** What the tray says: the calendar's by default; a board words its own. */
interface TrayLabels {
  pending: string;
  hint: string;
  pendingEmpty: string;
  dragTitle: string;
}

const CALENDAR_LABELS: TrayLabels = {
  pending: "Por programar",
  hint: "Arrastra una tarea al calendario; se puede programar varias veces.",
  pendingEmpty: "Todas las tareas tienen algún hueco.",
  dragTitle: "arrástrala al calendario",
};

/**
 * The tasks to drag somewhere (the tray of Notion Calendar): the ones not placed yet, or all of them. «Placed» is
 * scheduled in the calendar, or on the open board.
 */
export function TaskTray({
  pages,
  scheduled,
  onOpen,
  labels = CALENDAR_LABELS,
}: {
  pages: PageSummary[];
  /** Ids of the tasks that already have an entry. */
  scheduled: Set<string>;
  onOpen: (taskId: string) => void;
  labels?: TrayLabels;
}) {
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState("");
  const baseId = pages.find((p) => p.role === "tasks")?.ownDatabaseId;
  const needle = query.trim().toLowerCase();
  const tasks = baseId
    ? pages.filter(
        (p) =>
          p.databaseId === baseId &&
          (all || !scheduled.has(p.id)) &&
          (!needle || p.title.toLowerCase().includes(needle)),
      )
    : [];

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
        <div role="group" aria-label="Qué tareas mostrar">
          <button type="button" aria-pressed={!all} onClick={() => setAll(false)}>
            {labels.pending}
          </button>
          <button type="button" aria-pressed={all} onClick={() => setAll(true)}>
            Todas
          </button>
        </div>
      </div>
      <p className="cal-tray-hint">{labels.hint}</p>
      {tasks.length === 0 ? (
        <p className="cal-tray-empty">{all ? "No hay tareas." : labels.pendingEmpty}</p>
      ) : (
        <ul>
          {tasks.map((task) => (
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
      )}
    </section>
  );
}
