import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Tag, Trash2 } from "lucide-react";
import { subscribeDatabaseChanges } from "../../lib/database-bus";
import {
  createBoard,
  deleteBoard,
  ensureTaskBase,
  getBoard,
  getDatabase,
  listBoards,
  renameBoard,
  type TaskBase,
} from "../../lib/db-client";
import { readPref, writePref } from "../../lib/prefs";
import type { BoardData, BoardInfo, DatabaseData } from "../../types";
import { TaskTray } from "../calendar/TaskTray";
import { PageEditor } from "../editor/PageEditor";
import { TaskPeek } from "../workspace/TaskPeek";
import type { TaskHost } from "../workspace/Tasks";
import { BoardView, EditableName } from "./BoardView";
import "./boards.css";

const CURRENT_KEY = "boards.current";
const FIELDS_KEY = "boards.fields.";

const TRAY_LABELS = {
  pending: "Fuera del tablero",
  hint: "Arrastra una tarea a una lista; una tarea puede estar en varios tableros.",
  pendingEmpty: "Todas las tareas están en este tablero.",
  dragTitle: "arrástrala a una lista",
};

/**
 * The Tableros section of the Gestor, as in Trello: several boards, each with free lists whose cards are
 * references to tasks. Tasks come in from the tray (or the task table) by dragging, or are made by typing a card.
 * A card opens the task in the same side peek the task table uses.
 */
export function BoardsSection({ host }: { host: TaskHost }) {
  const { pages, onPagesChanged, onOpenPage } = host;
  const [base, setBase] = useState<TaskBase | null>(null);
  const [boards, setBoards] = useState<BoardInfo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(() => readPref(CURRENT_KEY));
  const [board, setBoard] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // the tasks come from the task database; it is created here too if the Gestor opened on this section
  useEffect(() => {
    let cancelled = false;
    ensureTaskBase()
      .then((made) => {
        if (cancelled) return;
        setBase(made);
        onPagesChanged();
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [onPagesChanged]);

  // `pages` changes with a task's title (or its deletion), so a card never shows an old one; `reload` bumps after a write
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  useEffect(() => {
    let cancelled = false;
    listBoards()
      .then((found) => {
        if (cancelled) return;
        setBoards(found);
        // the remembered board may be gone: fall back to the first
        const id = found.some((b) => b.id === currentId) ? currentId : (found[0]?.id ?? null);
        if (id !== currentId) setCurrentId(id);
        return id ? getBoard(id).then((data) => !cancelled && setBoard(data)) : setBoard(null);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [currentId, pages, reloadKey]);
  useEffect(() => {
    if (currentId) writePref(CURRENT_KEY, currentId);
  }, [currentId]);

  /** Runs a write, reloads and reports a refusal; resolves the result (or null when it failed). */
  const write = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | null> => {
      try {
        const result = await action();
        setError(null);
        reload();
        return result;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [reload],
  );

  const onBoard = useMemo(
    () => new Set(board?.lists.flatMap((l) => l.cards.map((c) => c.taskId))),
    [board],
  );

  // The task table's properties and the tasks' values: what a card can show as labels (read again after any change).
  const [db, setDb] = useState<DatabaseData | null>(null);
  const loadDb = useCallback(() => {
    if (base) getDatabase(base.databaseId).then(setDb, () => {});
  }, [base]);
  useEffect(loadDb, [loadDb, pages, board]);
  useEffect(() => subscribeDatabaseChanges(loadDb), [loadDb]);
  const valuesByTask = useMemo(() => new Map(db?.rows.map((r) => [r.pageId, r.values])), [db]);

  // Which properties each board shows on its cards: a preference of this window, like the board that was open.
  const [fieldsRev, setFieldsRev] = useState(0);
  const chosenIds = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(readPref(FIELDS_KEY + currentId) ?? "null");
      return Array.isArray(parsed) ? (parsed as string[]) : null;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fieldsRev re-reads the preference after it is written
  }, [currentId, fieldsRev]);
  const pickable = db?.properties.filter((p) => p.type !== "relation") ?? [];
  const shown = pickable.filter((p) => (chosenIds ? chosenIds.includes(p.id) : p.type === "tags"));
  const toggleField = (id: string) => {
    const now = new Set(shown.map((p) => p.id));
    if (!now.delete(id)) now.add(id);
    writePref(FIELDS_KEY + currentId, JSON.stringify([...now]));
    setFieldsRev((r) => r + 1);
  };

  const makeBoard = async (name: string) => {
    const made = await write(() => createBoard(name));
    if (made) {
      setCurrentId(made.id);
      setNewName(null);
    }
  };

  // In the side peek «abrir» on a task stays here; any other page opens in Notes.
  const navigate = useCallback(
    (pageId: string) => {
      const isTask = base && pages.find((p) => p.id === pageId)?.databaseId === base.databaseId;
      if (isTask) setOpenTask(pageId);
      else {
        setOpenTask(null);
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
  if (!base) return <p className="tasks-loading">Preparando los tableros…</p>;
  const open = openTask && pages.some((p) => p.id === openTask) ? openTask : null;

  return (
    <div className="boards">
      <div className="boards-main">
        <div className="boards-bar" role="group" aria-label="Tableros">
          {boards.map((b) => (
            <button
              key={b.id}
              type="button"
              aria-pressed={b.id === currentId}
              onClick={() => {
                setCurrentId(b.id);
                setConfirmDelete(false);
              }}
            >
              {b.name}
            </button>
          ))}
          {newName === null ? (
            <button type="button" className="boards-new" onClick={() => setNewName("")}>
              <Plus size={14} aria-hidden /> Tablero
            </button>
          ) : (
            <form
              className="boards-new-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (newName.trim()) void makeBoard(newName);
              }}
            >
              <input
                type="text"
                value={newName}
                maxLength={100}
                autoFocus
                placeholder="Nombre del tablero"
                aria-label="Nombre del tablero nuevo"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setNewName(null)}
                onBlur={() => !newName.trim() && setNewName(null)}
              />
            </form>
          )}
        </div>
        {error && (
          <p className="tasks-error" role="alert">
            {error}
          </p>
        )}
        {board ? (
          <>
            <div className="board-head">
              <EditableName
                className="board-name"
                value={board.name}
                label="Nombre del tablero"
                onCommit={(name) => void write(() => renameBoard(board.id, name))}
              />
              <details className="board-fields">
                <summary title="Qué propiedades de la tarea se ven en las tarjetas">
                  <Tag size={14} aria-hidden /> Etiquetas y campos
                </summary>
                <div className="board-fields-menu" role="group" aria-label="Campos de las tarjetas">
                  {pickable.map((p) => (
                    <label key={p.id}>
                      <input
                        type="checkbox"
                        checked={shown.some((s) => s.id === p.id)}
                        onChange={() => toggleField(p.id)}
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              </details>
              {confirmDelete ? (
                <span className="board-confirm">
                  ¿Borrar el tablero con sus listas y tarjetas? Las tareas se conservan.
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDelete(false);
                      void write(() => deleteBoard(board.id));
                    }}
                  >
                    Borrar
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)}>
                    No
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="board-icon-btn"
                  aria-label="Borrar el tablero"
                  title="Borrar el tablero (las tareas no se borran)"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              )}
            </div>
            <BoardView
              board={board}
              write={write}
              onOpenTask={setOpenTask}
              onTaskCreated={onPagesChanged}
              onNotice={setError}
              fields={shown}
              valuesOf={(taskId) => valuesByTask.get(taskId) ?? {}}
              onFieldWritten={loadDb}
            />
          </>
        ) : (
          <div className="boards-empty">
            <p>Aún no hay tableros.</p>
            <button type="button" onClick={() => setNewName("")}>
              Crear el primero
            </button>
          </div>
        )}
      </div>
      {board && (
        <aside className="boards-side">
          <TaskTray pages={pages} scheduled={onBoard} onOpen={setOpenTask} labels={TRAY_LABELS} />
        </aside>
      )}
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
