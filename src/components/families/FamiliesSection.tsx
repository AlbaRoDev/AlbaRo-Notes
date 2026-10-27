import { useCallback, useEffect, useMemo, useState } from "react";
import { Circle, ListOrdered } from "lucide-react";
import {
  addCardsToBoard,
  ensureTaskBase,
  listBoards,
  listFamilies,
  type TaskBase,
} from "../../lib/db-client";
import { bounds, packCircles, radiusOf } from "../../lib/families";
import { readPref, writePref } from "../../lib/prefs";
import type { BoardInfo, Families, Family } from "../../types";
import { PageEditor } from "../editor/PageEditor";
import { TaskPeek } from "../workspace/TaskPeek";
import type { TaskHost } from "../workspace/Tasks";
import "./families.css";

type Mode = "bubbles" | "list";
const MODE_KEY = "families.mode";
const BIGGEST_RADIUS = 110;

/** The colour a family wears: its option's, or the neutral one (relations and «no value» have none). */
const fill = (f: Family) => `var(--tag-${f.color ?? "default"})`;

/** A size as a whole number when it is one, else with up to two decimals (a sum can be 7,25). */
function formatSize(size: number): string {
  return Number.isInteger(size) ? String(size) : String(Math.round(size * 100) / 100);
}

/**
 * The Familias section of the Gestor: the tasks grouped by what they have in common — a category, a
 * state, a relation — as bubbles (area = size, packed together) or as a ranked list. Rust does the grouping; a
 * click on a family shows its tasks, which open in the usual side peek, and a whole family can go onto a board.
 */
export function FamiliesSection({ host }: { host: TaskHost }) {
  const { pages, onPagesChanged, onOpenPage } = host;
  const [base, setBase] = useState<TaskBase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(() =>
    readPref(MODE_KEY) === "list" ? "list" : "bubbles",
  );
  const [property, setProperty] = useState<string | undefined>(undefined);
  const [measure, setMeasure] = useState<string | undefined>(undefined);
  const [data, setData] = useState<Families | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [boards, setBoards] = useState<BoardInfo[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => writePref(MODE_KEY, mode), [mode]);

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

  // `pages` changes with a task's title or its deletion, so the families are asked for again
  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    Promise.all([listFamilies(property, measure), listBoards()])
      .then(([found, all]) => {
        if (cancelled) return;
        setData(found);
        setBoards(all);
        setError(null);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [base, property, measure, pages]);

  const families = useMemo(() => data?.families ?? [], [data]);
  const current = families.find((f) => f.key === selected) ?? null;
  const biggest = families[0]?.size ?? 0;

  // bubbles are packed once per data set, in the order Rust gives (biggest first)
  const packed = useMemo(() => {
    const circles = packCircles(families.map((f) => radiusOf(f.size, biggest, BIGGEST_RADIUS)));
    return { circles, box: bounds(circles) };
  }, [families, biggest]);

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

  const toBoard = (boardId: string, family: Family) => {
    addCardsToBoard(
      boardId,
      family.tasks.map((t) => t.id),
    )
      .then(({ added, skipped }) => {
        setError(null);
        setNotice(
          `${added} tarjeta${added === 1 ? "" : "s"} añadida${added === 1 ? "" : "s"} a «${boards.find((b) => b.id === boardId)?.name}»` +
            (skipped ? ` (${skipped} ya estaba${skipped === 1 ? "" : "n"})` : ""),
        );
      })
      .catch((e) => {
        setNotice(null);
        setError(String(e));
      });
  };

  if (error && !base) {
    return (
      <p className="tasks-error" role="alert">
        {error}
      </p>
    );
  }
  if (!base || !data) return <p className="tasks-loading">Preparando las familias…</p>;
  const open = openTask && pages.some((p) => p.id === openTask) ? openTask : null;
  const { box } = packed;
  const pad = 8;
  const toggle = (key: string) => {
    setSelected(key === selected ? null : key);
    setNotice(null);
  };

  return (
    <div className="families">
      <div className="families-bar">
        <label>
          Agrupar por
          <select
            value={data.property ?? ""}
            onChange={(e) => {
              setProperty(e.target.value || undefined);
              setSelected(null);
            }}
          >
            {data.groupable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tamaño
          <select value={measure ?? ""} onChange={(e) => setMeasure(e.target.value || undefined)}>
            <option value="">Nº de tareas</option>
            {data.measurable.map((p) => (
              <option key={p.id} value={p.id}>
                Suma de {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="families-modes" role="group" aria-label="Cómo verlas">
          <button
            type="button"
            aria-pressed={mode === "bubbles"}
            onClick={() => setMode("bubbles")}
          >
            <Circle size={14} aria-hidden /> Burbujas
          </button>
          <button type="button" aria-pressed={mode === "list"} onClick={() => setMode("list")}>
            <ListOrdered size={14} aria-hidden /> Ordenado
          </button>
        </div>
      </div>
      {error && (
        <p className="tasks-error" role="alert">
          {error}
        </p>
      )}
      {data.groupable.length === 0 ? (
        <p className="families-empty">
          Las familias necesitan una columna de selección, etiquetas o relación en la base de
          tareas.
        </p>
      ) : families.length === 0 ? (
        <p className="families-empty">Aún no hay tareas que agrupar: añádelas en Tareas.</p>
      ) : mode === "bubbles" ? (
        <svg
          className="families-bubbles"
          viewBox={`${box.minX - pad} ${box.minY - pad} ${box.width + pad * 2} ${box.height + pad * 2}`}
          role="group"
          aria-label="Familias"
        >
          {families.map((family, i) => {
            const { x, y, r } = packed.circles[i];
            const font = Math.max(10, Math.min(16, r / 3.2));
            const room = Math.max(3, Math.floor(r / 4.5));
            const shown =
              family.label.length > room ? `${family.label.slice(0, room)}…` : family.label;
            return (
              <g
                key={family.key}
                className="family-bubble"
                data-selected={family.key === selected || undefined}
                role="button"
                tabIndex={0}
                aria-label={`${family.label}: ${family.tasks.length} tarea${family.tasks.length === 1 ? "" : "s"}`}
                onClick={() => toggle(family.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle(family.key);
                  }
                }}
              >
                <title>{`${family.label} — ${family.tasks.length} tarea${family.tasks.length === 1 ? "" : "s"}`}</title>
                <circle cx={x} cy={y} r={r} fill={fill(family)} />
                {r >= 34 ? (
                  <text x={x} y={y} fontSize={font} textAnchor="middle">
                    <tspan x={x} dy="-0.1em">
                      {shown}
                    </tspan>
                    <tspan x={x} dy="1.3em" className="family-count">
                      {formatSize(family.size)}
                    </tspan>
                  </text>
                ) : (
                  <text x={x} y={y} fontSize={font} textAnchor="middle" dy="0.35em">
                    {formatSize(family.size)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      ) : (
        <ol className="families-list">
          {families.map((family) => (
            <li key={family.key}>
              <button
                type="button"
                aria-pressed={family.key === selected}
                onClick={() => toggle(family.key)}
              >
                <span className="family-label">{family.label}</span>
                <span className="family-bar">
                  <span
                    style={{
                      width: `${biggest > 0 ? (family.size / biggest) * 100 : 0}%`,
                      background: fill(family),
                    }}
                  />
                </span>
                <span className="family-size">{formatSize(family.size)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {data.total > families.length && (
        <p className="families-note">
          Mostrando {families.length} de {data.total} familias.
        </p>
      )}
      {current && (
        <section className="family-panel" aria-label={`Tareas de ${current.label}`}>
          <header>
            <h3>
              <span className="family-dot" style={{ background: fill(current) }} /> {current.label}
            </h3>
            <span className="families-note">
              {current.tasks.length} tarea{current.tasks.length === 1 ? "" : "s"}
            </span>
            {boards.length > 0 && (
              <select
                aria-label="Llevar la familia a un tablero"
                value=""
                onChange={(e) => e.target.value && toBoard(e.target.value, current)}
              >
                <option value="">Llevar a un tablero…</option>
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </header>
          {notice && (
            <p className="families-note" role="status">
              {notice}
            </p>
          )}
          <ul>
            {current.tasks.map((task) => (
              <li key={task.id}>
                <button type="button" onClick={() => setOpenTask(task.id)} title="Abrir la tarea">
                  {task.title || "Sin título"}
                </button>
              </li>
            ))}
          </ul>
        </section>
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
