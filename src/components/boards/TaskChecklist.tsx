import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import {
  addChecklistItem,
  getTaskChecklist,
  removeChecklistItem,
  setChecklistItem,
} from "../../lib/db-client";
import type { ChecklistItem } from "../../types";
import "./task-checklist.css";
import { t } from "../../lib/i18n.ts";

const CHANGED = "task-checklist-changed";

/** «2/5», or null when there is nothing to count. */
function progressLabel(items: { checked: boolean }[]): string | null {
  return items.length ? `${items.filter((i) => i.checked).length}/${items.length}` : null;
}

/**
 * A task's checklist (the «[ ]» items of its page) to tick, remove and add to without opening the task, as a Trello
 * card does. Rust owns the document: each change returns the list as stored, and `onChanged` lets a parent that
 * shows the progress (a board card) refresh it.
 */
export function TaskChecklist({
  taskId,
  onChanged,
  compact,
  collapsed,
  onToggle,
}: {
  taskId: string;
  onChanged?: () => void;
  /** For a calendar block: nothing at all when the task has no list, and no field to add to it. */
  compact?: boolean;
  /** With `onToggle`, the progress line is a button that folds the list (a calendar block is small). */
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const [items, setItems] = useState<ChecklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // the same task's list can be open in several places at once (a calendar block and its panel): a change in one
  // reaches the others
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getTaskChecklist(taskId).then(
        (found) => !cancelled && setItems(found),
        (e) => !cancelled && setError(String(e)),
      );
    const onOther = (e: Event) => (e as CustomEvent<string>).detail === taskId && void load();
    void load();
    window.addEventListener(CHANGED, onOther);
    return () => {
      cancelled = true;
      window.removeEventListener(CHANGED, onOther);
    };
  }, [taskId]);

  const run = async (change: () => Promise<ChecklistItem[]>): Promise<boolean> => {
    try {
      setItems(await change());
      setError(null);
      onChanged?.();
      window.dispatchEvent(new CustomEvent(CHANGED, { detail: taskId }));
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  };

  const label = items ? progressLabel(items) : null;
  const done = items ? items.filter((i) => i.checked).length : 0;
  if (compact && !items?.length) return null;

  return (
    <div className="task-checklist" draggable={false}>
      {label && items && (
        <div className="task-checklist-progress" aria-hidden={!onToggle || undefined}>
          {onToggle && (
            <button
              type="button"
              aria-expanded={!collapsed}
              aria-label={t("Lista de comprobación")}
              title={collapsed ? t("Mostrar la lista") : t("Ocultar la lista")}
              onClick={onToggle}
            >
              {collapsed ? (
                <ChevronRight size={12} aria-hidden="true" />
              ) : (
                <ChevronDown size={12} aria-hidden="true" />
              )}
            </button>
          )}
          <span>{label}</span>
          <div>
            <i style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
        </div>
      )}
      {!collapsed && (
        <ul>
          {items?.map((item, index) => (
            <li key={index} data-checked={item.checked || undefined}>
              <label>
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={(e) =>
                    void run(() => setChecklistItem(taskId, index, e.target.checked))
                  }
                />
                <span>{item.text || t("(vacío)")}</span>
              </label>
              <button
                type="button"
                aria-label={t("Quitar «{text}» de la lista", { text: item.text })}
                title={t("Quitar de la lista")}
                onClick={() => void run(() => removeChecklistItem(taskId, index))}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!compact && (
        <input
          type="text"
          className="task-checklist-add"
          value={draft}
          maxLength={200}
          placeholder={t("Añadir un elemento…")}
          aria-label={t("Añadir un elemento a la lista")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !draft.trim()) return;
            e.preventDefault();
            void run(() => addChecklistItem(taskId, draft)).then((ok) => ok && setDraft(""));
          }}
        />
      )}
      {error && (
        <p className="task-checklist-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
