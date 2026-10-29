import { useEffect, useRef, useState } from "react";
import { GripVertical, ListChecks, Plus, Trash2, X } from "lucide-react";
import {
  addBoardCard,
  addBoardList,
  createBoardCard,
  deleteBoardList,
  moveBoardCard,
  moveBoardList,
  removeBoardCard,
  renameBoardList,
} from "../../lib/db-client";
import {
  hasCardDrag,
  hasDragItem,
  hasListDrag,
  readCardDrag,
  readDragItem,
  readListDrag,
  startCardDrag,
  startListDrag,
} from "../../lib/drag-item";
import type { BoardData, BoardList, CellValue, Property } from "../../types";
import { CardFields } from "./CardFields";
import { TaskChecklist } from "./TaskChecklist";

/** A name that reads as text and saves when it loses the focus (Enter too; Esc or a refusal put the old one back). */
export function EditableName({
  value,
  label,
  className,
  onCommit,
}: {
  value: string;
  label: string;
  className?: string;
  onCommit: (name: string) => void;
}) {
  return (
    <input
      key={value}
      className={className}
      type="text"
      defaultValue={value}
      maxLength={100}
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = value;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const name = e.currentTarget.value.trim();
        if (name && name !== value) onCommit(name);
        else e.currentTarget.value = value;
      }}
    />
  );
}

/** Index to drop at among `selector` children of `container`, by the pointer's position along one axis. */
function indexAt(
  container: HTMLElement,
  selector: string,
  pointer: number,
  axis: "x" | "y",
): number {
  let index = 0;
  for (const el of container.querySelectorAll<HTMLElement>(selector)) {
    const box = el.getBoundingClientRect();
    const middle = axis === "y" ? box.top + box.height / 2 : box.left + box.width / 2;
    if (pointer > middle) index += 1;
  }
  return index;
}

interface BoardViewProps {
  board: BoardData;
  /** Runs a write (reloading after it) and reports a refusal. */
  write: <T>(action: () => Promise<T>) => Promise<T | null>;
  onOpenTask: (taskId: string) => void;
  /** A task was created from a card: the page list must learn about it. */
  onTaskCreated: () => void;
  onNotice: (message: string) => void;
  /** The task properties this board shows on its cards (labels for options, plain text for the rest). */
  fields: Property[];
  valuesOf: (taskId: string) => Record<string, CellValue>;
  /** A field was written from a card: the task rows must be read again. */
  onFieldWritten: () => void;
}

/**
 * The lists and cards of one board, as in Trello. A card drags to another list or position of this board (it moves)
 * and a task dragged in from the tray, the task table or another board adds a card (the same task can be on many
 * boards, once on each). Lists drag by their grip.
 */
export function BoardView({
  board,
  write,
  onOpenTask,
  onTaskCreated,
  onNotice,
  fields,
  valuesOf,
  onFieldWritten,
}: BoardViewProps) {
  // the cards whose checklist is unfolded (a view state, not saved)
  const [checklistOpen, setChecklistOpen] = useState<Set<string>>(() => new Set());
  const toggleChecklist = (id: string) =>
    setChecklistOpen((open) => {
      const next = new Set(open);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  // where a dragged card or list would land: shown as a line (card) or a bar (list)
  const [cardDrop, setCardDrop] = useState<{ listId: string; index: number } | null>(null);
  const [listDrop, setListDrop] = useState<number | null>(null);
  const [confirmList, setConfirmList] = useState<string | null>(null);
  const listsRef = useRef<HTMLDivElement>(null);

  // after a keyboard move the card keeps the focus: it is found again once the board has reloaded
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    if (!focusAfter.current) return;
    document
      .querySelector<HTMLElement>(`[data-card-id="${focusAfter.current}"] .board-card-title`)
      ?.focus();
    focusAfter.current = null;
  }, [board]);

  /**
   * Keyboard: ↑/↓ walk the cards of a list, ←/→ jump to the neighbouring list; Alt + the same arrows move the
   * focused card (up or down its list, or to the end of the neighbour's position). Enter opens it (a button).
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const title = e.target as HTMLElement;
    if (!title.classList.contains("board-card-title") || e.ctrlKey || e.metaKey || e.shiftKey)
      return;
    const arrow = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(e.key);
    if (arrow < 0) return;
    const cardId = title.closest<HTMLElement>("[data-card-id]")?.dataset.cardId;
    const listIndex = board.lists.findIndex((l) => l.cards.some((c) => c.id === cardId));
    if (listIndex < 0) return;
    const list = board.lists[listIndex];
    const at = list.cards.findIndex((c) => c.id === cardId);
    const focusCard = (id: string) =>
      document.querySelector<HTMLElement>(`[data-card-id="${id}"] .board-card-title`)?.focus();
    e.preventDefault();
    if (arrow < 2) {
      const to = at + (arrow === 0 ? -1 : 1);
      if (to < 0 || to >= list.cards.length) return;
      if (e.altKey) {
        focusAfter.current = list.cards[at].id;
        void write(() => moveBoardCard(list.cards[at].id, list.id, to));
      } else focusCard(list.cards[to].id);
      return;
    }
    const step = arrow === 2 ? -1 : 1;
    const neighbour = board.lists[listIndex + step];
    if (!neighbour) return;
    if (e.altKey) {
      focusAfter.current = list.cards[at].id;
      void write(() => moveBoardCard(list.cards[at].id, neighbour.id, at));
    } else if (neighbour.cards.length > 0) {
      focusCard(neighbour.cards[Math.min(at, neighbour.cards.length - 1)].id);
    } else {
      document
        .querySelector<HTMLElement>(`[data-list-id="${neighbour.id}"] .board-add input`)
        ?.focus();
    }
  };

  const cardsOf = (id: string) => board.lists.find((l) => l.id === id)?.cards ?? [];

  const dropOnList = (e: React.DragEvent, list: BoardList, index: number) => {
    const cardId = readCardDrag(e);
    if (cardId) {
      // the index counted the card being moved too: once it is lifted out, a later slot is one earlier
      const at = cardsOf(list.id).findIndex((c) => c.id === cardId);
      void write(() => moveBoardCard(cardId, list.id, at >= 0 && at < index ? index - 1 : index));
      return;
    }
    const item = readDragItem(e);
    if (!item) return;
    if (item.kind !== "task") return onNotice("Solo las tareas pueden estar en un tablero");
    void write(() => addBoardCard(list.id, item.id, index));
  };

  return (
    <div
      className="board-lists"
      ref={listsRef}
      onKeyDown={onKeyDown}
      onDragOver={(e) => {
        if (!hasListDrag(e)) return;
        e.preventDefault();
        setListDrop(indexAt(e.currentTarget, "[data-list]", e.clientX, "x"));
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setListDrop(null);
      }}
      onDrop={(e) => {
        const id = readListDrag(e);
        const index = listDrop;
        setListDrop(null);
        if (!id || index === null) return;
        e.preventDefault();
        const at = board.lists.findIndex((l) => l.id === id);
        void write(() => moveBoardList(id, at >= 0 && at < index ? index - 1 : index));
      }}
    >
      {board.lists.map((list, position) => (
        <section
          key={list.id}
          className="board-list"
          data-list
          data-list-id={list.id}
          data-drop-before={listDrop === position || undefined}
          data-drop-after={
            (listDrop === board.lists.length && position === board.lists.length - 1) || undefined
          }
          aria-label={list.name}
          onDragOver={(e) => {
            if (!hasCardDrag(e) && !hasDragItem(e)) return;
            e.preventDefault(); // this list accepts a card or a task
            const cards = e.currentTarget.querySelector<HTMLElement>(".board-cards");
            if (cards)
              setCardDrop({
                listId: list.id,
                index: indexAt(cards, "[data-card]", e.clientY, "y"),
              });
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setCardDrop(null);
          }}
          onDrop={(e) => {
            if (hasListDrag(e)) return; // the row of lists handles it
            const index = cardDrop?.listId === list.id ? cardDrop.index : list.cards.length;
            setCardDrop(null);
            e.preventDefault();
            dropOnList(e, list, index);
          }}
        >
          <header className="board-list-head">
            <button
              type="button"
              className="board-grip"
              draggable
              aria-label={`Mover la lista ${list.name}`}
              title="Arrastra para reordenar las listas"
              onDragStart={(e) => {
                startListDrag(e, list.id);
                const el = e.currentTarget.closest<HTMLElement>("[data-list]");
                if (el) e.dataTransfer.setDragImage(el, 12, 12);
              }}
              onDragEnd={() => setListDrop(null)}
            >
              <GripVertical size={14} aria-hidden />
            </button>
            <EditableName
              className="board-list-name"
              value={list.name}
              label={`Nombre de la lista ${list.name}`}
              onCommit={(name) => void write(() => renameBoardList(list.id, name))}
            />
            <span className="board-count">{list.cards.length}</span>
            {confirmList === list.id ? (
              <span className="board-confirm">
                {list.cards.length > 0 ? `¿Con sus ${list.cards.length} tarjetas? ` : ""}
                <button
                  type="button"
                  onClick={() => {
                    setConfirmList(null);
                    void write(() => deleteBoardList(list.id));
                  }}
                >
                  Borrar
                </button>
                <button type="button" onClick={() => setConfirmList(null)}>
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="board-icon-btn"
                aria-label={`Borrar la lista ${list.name}`}
                title="Borrar la lista (las tareas no se borran)"
                onClick={() => setConfirmList(list.id)}
              >
                <Trash2 size={13} aria-hidden />
              </button>
            )}
          </header>
          <div className="board-cards">
            {list.cards.map((card, i) => (
              <div key={card.id} className="board-card-slot">
                {cardDrop?.listId === list.id && cardDrop.index === i && (
                  <div className="board-drop-line" />
                )}
                <div
                  className="board-card"
                  data-card
                  data-card-id={card.id}
                  draggable
                  onDragStart={(e) => startCardDrag(e, card)}
                  onDragEnd={() => setCardDrop(null)}
                >
                  <button
                    type="button"
                    className="board-card-title"
                    onClick={() => onOpenTask(card.taskId)}
                    title="Abrir la tarea"
                  >
                    {card.title || "Sin título"}
                  </button>
                  <button
                    type="button"
                    className="board-icon-btn board-card-remove"
                    aria-label={`Quitar ${card.title} del tablero`}
                    title="Quitar del tablero (la tarea se conserva)"
                    onClick={() => void write(() => removeBoardCard(card.id))}
                  >
                    <X size={13} aria-hidden />
                  </button>
                  <div className="board-card-extra">
                    <CardFields
                      props={fields}
                      values={valuesOf(card.taskId)}
                      taskId={card.taskId}
                      onWritten={onFieldWritten}
                      onError={onNotice}
                    />
                    <button
                      type="button"
                      className="board-checkbtn"
                      data-empty={card.checklist.total === 0 || undefined}
                      aria-expanded={checklistOpen.has(card.id)}
                      aria-label={`Lista de comprobación de ${card.title}`}
                      title="Lista de comprobación"
                      onClick={() => toggleChecklist(card.id)}
                    >
                      <ListChecks size={13} aria-hidden />
                      {card.checklist.total > 0 && `${card.checklist.done}/${card.checklist.total}`}
                    </button>
                    {checklistOpen.has(card.id) && (
                      <TaskChecklist
                        taskId={card.taskId}
                        onChanged={() => void write(async () => null)}
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}
            {cardDrop?.listId === list.id && cardDrop.index >= list.cards.length && (
              <div className="board-drop-line" />
            )}
          </div>
          <AddCard
            listId={list.id}
            onAdd={async (title) => {
              const made = await write(() => createBoardCard(list.id, title));
              if (made) onTaskCreated();
              return made !== null;
            }}
          />
        </section>
      ))}
      <AddList
        onAdd={(name) => write(() => addBoardList(board.id, name)).then((r) => r !== null)}
      />
    </div>
  );
}

/** «+ Añadir una tarjeta»: typing a title makes a task and its card (the box keeps the focus for the next one). */
function AddCard({
  listId,
  onAdd,
}: {
  listId: string;
  onAdd: (title: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="board-add"
      onSubmit={(e) => {
        e.preventDefault();
        const title = draft.trim();
        if (!title || busy) return;
        setBusy(true);
        void onAdd(title).then((ok) => {
          if (ok) setDraft("");
          setBusy(false);
        });
      }}
    >
      <Plus size={14} aria-hidden />
      <input
        type="text"
        value={draft}
        maxLength={200}
        readOnly={busy} // not disabled: a disabled input drops the focus
        placeholder="Añadir una tarjeta…"
        aria-label="Añadir una tarjeta"
        data-list-id={listId}
        onChange={(e) => setDraft(e.target.value)}
      />
    </form>
  );
}

function AddList({ onAdd }: { onAdd: (name: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="board-add board-add-list"
      onSubmit={(e) => {
        e.preventDefault();
        const name = draft.trim();
        if (!name || busy) return;
        setBusy(true);
        void onAdd(name).then((ok) => {
          if (ok) setDraft("");
          setBusy(false);
        });
      }}
    >
      <Plus size={14} aria-hidden />
      <input
        type="text"
        value={draft}
        maxLength={100}
        readOnly={busy}
        placeholder="Añadir otra lista…"
        aria-label="Añadir una lista"
        onChange={(e) => setDraft(e.target.value)}
      />
    </form>
  );
}
