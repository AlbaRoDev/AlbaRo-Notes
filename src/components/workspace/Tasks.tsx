import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PageEditor } from "../editor/PageEditor";
import { TaskPeek } from "./TaskPeek";
import { EditorAppProvider } from "../editor/EditorAppProvider";
import { DatabaseTable } from "../database/DatabaseTable";
import { addTask, ensureTaskBase, linkPage, type TaskBase } from "../../lib/db-client";
import { emitLinkChange } from "../../lib/links-bus";
import type { DragItem } from "../../lib/drag-item";
import { emitDatabaseChange } from "../../lib/database-bus";
import type { PageSummary } from "../../types";

/** What the Gestor needs from the app to show a task (an ordinary row page) with its editor. */
export interface TaskHost {
  pages: PageSummary[];
  onTitleChange: (pageId: string, title: string) => void;
  onChildPageCreated: (page: PageSummary) => void;
  onPagesChanged: () => void;
  /** Opens any page in Notes. */
  onOpenPage: (pageId: string) => void;
  /** Deletes a page (a task) and refreshes the page list. */
  onDelete: (pageId: string) => void;
  /** Opens the AI assistant. */
  onOpenAi: () => void;
}

// Writes to the task database made here tell the other views of it (a table open elsewhere) to reload.
const TASKS_SOURCE = Symbol("tasks");

/**
 * The Tareas section: the task database as the table you already know — views, filters,
 * columns, categories — with a box to add a task by typing its title, and a side peek to open one
 * over the table, as Notion does: a task is a page, so its properties sit on top and its free-form
 * notes below.
 */
export function TasksSection({ host }: { host: TaskHost }) {
  const { pages, onPagesChanged, onOpenPage } = host;
  const [base, setBase] = useState<TaskBase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  // First time in the Gestor: Rust creates the task database (idempotent, so StrictMode's second run is harmless).
  useEffect(() => {
    let cancelled = false;
    ensureTaskBase()
      .then((made) => {
        if (cancelled) return;
        setBase(made);
        onPagesChanged(); // the sidebar and the page list learn about it
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [onPagesChanged]);

  const submit = async () => {
    const title = draft.trim();
    if (!title || !base || adding) return;
    setAdding(true);
    try {
      await addTask(title);
      setDraft("");
      setError(null);
      onPagesChanged();
      emitDatabaseChange(base.databaseId, TASKS_SOURCE);
    } catch (e) {
      setError(String(e));
    } finally {
      setAdding(false);
    }
  };

  // A page dropped on a task (a row of the table, or its open peek) links them.
  const dropOnTask = useCallback((taskId: string, item: DragItem) => {
    if (item.kind !== "page")
      return setError("Arrastra una página sobre una tarea para enlazarlas");
    linkPage(taskId, item.id)
      .then(() => {
        setError(null);
        emitLinkChange();
      })
      .catch((e) => setError(String(e)));
  }, []);

  // In the table «abrir» opens the task here; any other page opens in Notes.
  const navigate = useCallback(
    (pageId: string) => {
      const isTask = base && pages.find((p) => p.id === pageId)?.databaseId === base.databaseId;
      if (isTask) setOpenTask(pageId);
      else {
        setOpenTask(null); // «← Tareas» in a task's panel, or a link that leaves for Notes
        if (!(base && pageId === base.pageId)) onOpenPage(pageId);
      }
    },
    [base, pages, onOpenPage],
  );

  if (error && !base) {
    return (
      <p className="tasks-error" role="alert">
        {error}
      </p>
    );
  }
  if (!base) return <p className="tasks-loading">Preparando las tareas…</p>;

  // A task deleted from the table while its peek was open leaves nothing to show.
  const open = openTask && pages.some((p) => p.id === openTask) ? openTask : null;

  return (
    <div className="tasks">
      <form
        className="tasks-add"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Plus size={16} aria-hidden />
        <input
          type="text"
          value={draft}
          maxLength={200}
          readOnly={adding} // not disabled: a disabled input drops the focus
          placeholder="Añadir una tarea…"
          aria-label="Añadir una tarea"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // ↓ goes into the table, to the first task's title
            if (e.key !== "ArrowDown") return;
            const first = document.querySelector<HTMLElement>(".db-table tr[data-grid-row] input");
            if (first) {
              e.preventDefault();
              first.focus();
            }
          }}
        />
      </form>
      {error && (
        <p className="tasks-error" role="alert">
          {error}
        </p>
      )}
      <EditorAppProvider
        value={{ pages, currentPageId: base.pageId, onNavigate: navigate, onPagesChanged }}
      >
        {/* Same wrapper classes as a database page, so the table keeps its styling (see DatabaseView.css). */}
        <div className="page-editor">
          <div className="ProseMirror db-page">
            <DatabaseTable databaseId={base.databaseId} onDropItem={dropOnTask} />
          </div>
        </div>
      </EditorAppProvider>
      {open && (
        <TaskPeek
          page={pages.find((p) => p.id === open)!}
          host={host}
          onClose={() => setOpenTask(null)}
        >
          <PageEditor
            key={open}
            pageId={open}
            rowDatabaseId={base.databaseId}
            pages={pages}
            onTitleChange={host.onTitleChange}
            onNavigate={navigate}
            onChildPageCreated={host.onChildPageCreated}
            onPagesChanged={onPagesChanged}
          />
        </TaskPeek>
      )}
    </div>
  );
}
