import { useEffect, useState } from "react";
import { CalendarDays, Columns3, Inbox, ListChecks, Shapes, type LucideIcon } from "lucide-react";
import { readPref, writePref } from "../../lib/prefs";
import { startItemDrag } from "../../lib/drag-item";
import type { PageSummary } from "../../types";
import { BoardsSection } from "../boards/BoardsSection";
import { CalendarSection } from "../calendar/CalendarSection";
import { FamiliesSection } from "../families/FamiliesSection";
import { TasksSection, type TaskHost } from "./Tasks";

const SECTIONS = [
  {
    id: "calendar",
    label: "Calendario",
    Icon: CalendarDays,

    blurb: "Día, semana y mes con horas; arrastra tareas desde cualquier vista.",
  },
  {
    id: "tasks",
    label: "Tareas",
    Icon: ListChecks,

    blurb: "Tu base de tareas, con las categorías que quieras.",
  },
  {
    id: "boards",
    label: "Tableros",
    Icon: Columns3,

    blurb: "Listas y tarjetas como en Trello; una tarea puede estar en varios tableros.",
  },
  {
    id: "families",
    label: "Familias",
    Icon: Shapes,

    blurb: "Agrupa las tareas por lo que tienen en común, en burbujas o en orden.",
  },
] as const satisfies readonly {
  id: string;
  label: string;
  Icon: LucideIcon;

  blurb: string;
}[];

type SectionId = (typeof SECTIONS)[number]["id"];
const SECTION_KEY = "manager.section";

/** The Gestor's main zone: its four sections. */
export function ManagerMain({ host }: { host: TaskHost }) {
  const [section, setSection] = useState<SectionId>(() => {
    const stored = readPref(SECTION_KEY);
    return SECTIONS.find((s) => s.id === stored)?.id ?? "calendar";
  });
  useEffect(() => writePref(SECTION_KEY, section), [section]);
  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="manager">
      <nav className="manager-tabs" aria-label="Secciones del Gestor">
        {SECTIONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={id === section ? "page" : undefined}
            onClick={() => setSection(id)}
          >
            <Icon size={15} aria-hidden />
            {label}
          </button>
        ))}
      </nav>
      {section === "tasks" ? (
        <TasksSection host={host} />
      ) : section === "calendar" ? (
        <CalendarSection host={host} />
      ) : section === "boards" ? (
        <BoardsSection host={host} />
      ) : section === "families" ? (
        <FamiliesSection host={host} />
      ) : (
        <div className="manager-empty">
          <current.Icon size={40} strokeWidth={1.25} aria-hidden />
          <h2>{current.label}</h2>
          <p>{current.blurb}</p>
        </div>
      )}
    </div>
  );
}

/**
 * The Gestor as the companion panel of Notes: the tasks, to drag into a note (it lands as a mention) or to
 * open, and what the calendar will fill in (8.4).
 */
export function ManagerCompanion({
  pages,
  onOpenPage,
}: {
  pages: PageSummary[];
  onOpenPage: (pageId: string) => void;
}) {
  const baseId = pages.find((p) => p.role === "tasks")?.ownDatabaseId;
  const tasks = baseId ? pages.filter((p) => p.databaseId === baseId) : [];
  return (
    <div className="companion">
      <h2 className="companion-title">Gestor</h2>
      <section className="companion-section">
        <h3>
          <ListChecks size={14} aria-hidden />
          Tareas
        </h3>
        {tasks.length === 0 ? (
          <p className="companion-empty">Aún no hay tareas: se crean en el Gestor.</p>
        ) : (
          <ul>
            {tasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  className="companion-item"
                  draggable
                  onDragStart={(e) => startItemDrag(e, { kind: "task", id: task.id })}
                  onClick={() => onOpenPage(task.id)}
                  title={`${task.title} — arrástrala a una nota para mencionarla`}
                >
                  <ListChecks size={15} strokeWidth={1.75} aria-hidden />
                  <span>{task.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {["Hoy", "Próximos"].map((title) => (
        <section key={title} className="companion-section">
          <h3>
            <Inbox size={14} aria-hidden />
            {title}
          </h3>
          <p className="companion-empty">Llegan con el calendario.</p>
        </section>
      ))}
    </div>
  );
}
