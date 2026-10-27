import { useEffect, useState } from "react";
import { ListChecks } from "lucide-react";
import { tasksOfPage } from "../../lib/db-client";
import { subscribeLinkChanges } from "../../lib/links-bus";
import type { PageRef, PageSummary } from "../../types";

/** «Tareas relacionadas»: the tasks that link to this page, under it. Nothing is shown when there are none. */
export function RelatedTasks({
  pageId,
  pages,
  onOpen,
}: {
  pageId: string;
  pages: PageSummary[];
  onOpen: (taskId: string) => void;
}) {
  const [tasks, setTasks] = useState<PageRef[]>([]);

  // `pages` changes when a title does, so the chips never show an old one
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void tasksOfPage(pageId)
        .then((found) => !cancelled && setTasks(found))
        .catch(() => !cancelled && setTasks([]));
    load();
    const unsubscribe = subscribeLinkChanges(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [pageId, pages]);

  if (tasks.length === 0) return null;
  return (
    <section className="related-tasks" aria-label="Tareas relacionadas">
      <h3>Tareas relacionadas</h3>
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            <button type="button" onClick={() => onOpen(task.id)} title="Abrir la tarea">
              <ListChecks size={14} aria-hidden="true" /> {task.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
