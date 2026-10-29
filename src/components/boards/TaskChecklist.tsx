import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  addChecklistItem,
  getTaskChecklist,
  removeChecklistItem,
  setChecklistItem,
} from "../../lib/db-client";
import type { ChecklistItem } from "../../types";
import "./task-checklist.css";

/** «2/5», or null when there is nothing to count. */
function progressLabel(items: { checked: boolean }[]): string | null {
  return items.length ? `${items.filter((i) => i.checked).length}/${items.length}` : null;
}

/**
 * A task's checklist (the «[ ]» items of its page) to tick, remove and add to without opening the task, as a Trello
 * card does. Rust owns the document: each change returns the list as stored, and `onChanged` lets a parent that
 * shows the progress (a board card) refresh it.
 */
export function TaskChecklist({ taskId, onChanged }: { taskId: string; onChanged?: () => void }) {
  const [items, setItems] = useState<ChecklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    getTaskChecklist(taskId).then(
      (found) => !cancelled && setItems(found),
      (e) => !cancelled && setError(String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const run = async (change: () => Promise<ChecklistItem[]>): Promise<boolean> => {
    try {
      setItems(await change());
      setError(null);
      onChanged?.();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  };

  const label = items ? progressLabel(items) : null;
  const done = items ? items.filter((i) => i.checked).length : 0;

  return (
    <div className="task-checklist" draggable={false}>
      {label && items && (
        <div className="task-checklist-progress" aria-hidden="true">
          <span>{label}</span>
          <div>
            <i style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
        </div>
      )}
      <ul>
        {items?.map((item, index) => (
          <li key={index} data-checked={item.checked || undefined}>
            <label>
              <input
                type="checkbox"
                checked={item.checked}
                onChange={(e) => void run(() => setChecklistItem(taskId, index, e.target.checked))}
              />
              <span>{item.text || "(vacío)"}</span>
            </label>
            <button
              type="button"
              aria-label={`Quitar «${item.text}» de la lista`}
              title="Quitar de la lista"
              onClick={() => void run(() => removeChecklistItem(taskId, index))}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <input
        type="text"
        className="task-checklist-add"
        value={draft}
        maxLength={200}
        placeholder="Añadir un elemento…"
        aria-label="Añadir un elemento a la lista"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !draft.trim()) return;
          e.preventDefault();
          void run(() => addChecklistItem(taskId, draft)).then((ok) => ok && setDraft(""));
        }}
      />
      {error && (
        <p className="task-checklist-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
