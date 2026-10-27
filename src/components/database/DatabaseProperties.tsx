import { useEffect, useState, type KeyboardEvent } from "react";
import { listDatabases } from "../../lib/db-client";
import type { DatabaseSummary, Property, PropertyKind } from "../../types";
import { TYPE_CHOICES, typeChoiceOf } from "./property-types";

const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "Enter") e.currentTarget.blur();
};

/** Edit panel for one property: rename, select options, delete. Rendered under the table so the scroll container never clips it. */
export function PropertyPanel({
  prop,
  position,
  onRename,
  onOptions,
  onRenameOption,
  onMove,
  onDelete,
  onClose,
}: {
  prop: Property;
  /** Where the column sits, to disable the move buttons at either end. */
  position: { index: number; count: number };
  onRename: (name: string) => void;
  onOptions: (options: string[]) => void;
  /** Resolves false if rejected (e.g. the name already exists), so the input can revert. */
  onRenameOption: (from: string, to: string) => Promise<boolean>;
  onMove: (by: -1 | 1) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const options = prop.config.options ?? [];

  return (
    <div
      className="db-panel"
      role="group"
      aria-label={`Propiedad ${prop.name}`}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <label>
        Nombre
        <input
          autoFocus
          type="text"
          maxLength={60}
          defaultValue={prop.name}
          onKeyDown={blurOnEnter}
          onBlur={(e) => {
            const name = e.currentTarget.value.trim();
            if (name && name !== prop.name) onRename(name);
            else e.currentTarget.value = prop.name;
          }}
        />
      </label>
      <p className="db-panel-meta">Tipo: {typeChoiceOf(prop).label}</p>
      {(prop.type === "select" || prop.type === "tags") && (
        <div className="db-options">
          <span>Opciones</span>
          {options.map((o) => (
            <span key={o} className="db-chip">
              {/* Editable in place; Rust rewrites the values that used the old name. */}
              <input
                className="db-chip-input"
                type="text"
                maxLength={60}
                size={Math.max(o.length, 3)}
                defaultValue={o}
                aria-label={`Opción ${o}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  else if (e.key === "Escape") {
                    e.currentTarget.value = o;
                    e.currentTarget.blur();
                  }
                }}
                onBlur={async (e) => {
                  const input = e.currentTarget;
                  const name = input.value.trim();
                  if (!name || name === o) {
                    input.value = o;
                    return;
                  }
                  if (!(await onRenameOption(o, name))) input.value = o;
                }}
              />
              <button
                type="button"
                aria-label={`Quitar opción ${o}`}
                onClick={() => onOptions(options.filter((x) => x !== o))}
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            maxLength={60}
            placeholder="Nueva opción…"
            aria-label="Nueva opción"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const name = e.currentTarget.value.trim();
              if (!name) return;
              e.currentTarget.value = "";
              onOptions([...options, name]);
            }}
          />
        </div>
      )}
      <div className="db-panel-actions">
        <button
          type="button"
          disabled={position.index === 0}
          onClick={() => onMove(-1)}
          title="Mover la columna a la izquierda"
        >
          ← Mover
        </button>
        <button
          type="button"
          disabled={position.index === position.count - 1}
          onClick={() => onMove(1)}
          title="Mover la columna a la derecha"
        >
          Mover →
        </button>
        {confirming ? (
          <>
            <span>¿Borrar la propiedad y todos sus valores?</span>
            <button type="button" onClick={onDelete}>
              Sí, borrar
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              No
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirming(true)}>
            Borrar propiedad
          </button>
        )}
        <button type="button" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}

export function AddPropertyPanel({
  onAdd,
  onClose,
}: {
  onAdd: (name: string, kind: PropertyKind, config: Property["config"]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [choiceId, setChoiceId] = useState("text");
  const choice = TYPE_CHOICES.find((c) => c.id === choiceId) ?? TYPE_CHOICES[0];
  const kind = choice.kind;
  const [target, setTarget] = useState("");
  const [databases, setDatabases] = useState<DatabaseSummary[]>([]);

  useEffect(() => {
    if (kind !== "relation") return;
    void listDatabases().then((all) => {
      setDatabases(all);
      setTarget((t) => t || all[0]?.id || "");
    });
  }, [kind]);

  const canAdd = name.trim() !== "" && (kind !== "relation" || target !== "");
  const submit = () => {
    if (!canAdd) return;
    onAdd(
      name.trim(),
      kind,
      kind === "relation"
        ? { target }
        : {
            ...(choice.format && { format: choice.format }),
            ...(choice.status && { status: true }),
          },
    );
  };

  return (
    <div
      className="db-panel"
      role="group"
      aria-label="Nueva propiedad"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <label>
        Nombre
        <input
          autoFocus
          type="text"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </label>
      <label>
        Tipo
        <select value={choiceId} onChange={(e) => setChoiceId(e.target.value)}>
          {TYPE_CHOICES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      {kind === "relation" && (
        <label>
          Base de datos de destino
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {databases.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name || "Base de datos sin nombre"}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="db-panel-actions">
        <button type="button" disabled={!canAdd} onClick={submit}>
          Añadir
        </button>
        <button type="button" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
