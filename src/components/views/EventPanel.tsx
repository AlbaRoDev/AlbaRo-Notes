import { useState } from "react";
import { MAX_ITEM_TITLE, type StoredEvent } from "./view-items";
import "../database/DatabaseView.css"; // shared form controls (.db-panel, .db-input…)

interface EventPanelProps {
  event: StoredEvent;
  /** What the entry is called in the UI: «evento», «elemento». */
  noun: string;
  onChange: (next: StoredEvent) => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Edits one calendar event / timeline item. Every field saves when you leave
 * it (never per keystroke — a native date input being typed into must not be
 * written back mid-edit) and a half-typed date saves nothing.
 */
export function EventPanel({ event, noun, onChange, onDelete, onClose }: EventPanelProps) {
  const [note, setNote] = useState<string | null>(null);

  const saveDate = (key: "start" | "end", input: HTMLInputElement) => {
    if (input.validity.badInput) {
      input.value = event[key] ?? ""; // half typed: nothing to save
      return;
    }
    const value = input.value;
    const next = { ...event };
    if (key === "start") {
      if (!value) {
        input.value = event.start; // an entry always has a start
        return;
      }
      next.start = value;
      if (next.end && next.end < value) delete next.end; // moving the start past the end drops the end
    } else if (value) {
      if (value < event.start) {
        setNote("La fecha de fin no puede ser anterior a la de inicio");
        input.value = event.end ?? "";
        return;
      }
      next.end = value === event.start ? undefined : value;
      if (!next.end) delete next.end;
    } else {
      delete next.end;
    }
    setNote(null);
    if (JSON.stringify(next) !== JSON.stringify(event)) onChange(next);
  };

  return (
    <div
      className="db-panel"
      role="group"
      aria-label={`Editar ${noun}`}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <label>
        Título
        <input
          autoFocus
          type="text"
          maxLength={MAX_ITEM_TITLE}
          defaultValue={event.title}
          placeholder="Sin título"
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={(e) => {
            const title = e.currentTarget.value.trim();
            if (title !== event.title) onChange({ ...event, title });
          }}
        />
      </label>
      <div className="db-rule">
        <label>
          Inicio
          <input
            type="date"
            defaultValue={event.start}
            key={`start-${event.start}`}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onBlur={(e) => saveDate("start", e.currentTarget)}
          />
        </label>
        <label>
          Fin (opcional)
          <input
            type="date"
            defaultValue={event.end ?? ""}
            key={`end-${event.end ?? ""}`}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onBlur={(e) => saveDate("end", e.currentTarget)}
          />
        </label>
      </div>
      {note && <p className="db-error">{note}</p>}
      <div className="db-panel-actions">
        <button type="button" onClick={onDelete}>
          Borrar {noun}
        </button>
        <button type="button" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
