import { useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type {
  CellValue,
  DatabaseData,
  DatabaseRow,
  FormConfig,
  FormField,
  PageSummary,
  Property,
  ViewConfig,
} from "../../types";
import { Cell } from "./DatabaseCells";
import { resolveFields, type ResolvedField } from "./form-fields";
import { TITLE_ID, TITLE_PROPERTY } from "./view-config";
import "./DatabaseView.css";

const labelOf = (f: ResolvedField) => f.label || (f.prop.id === TITLE_ID ? "Título" : f.prop.name);

interface FormViewProps {
  database: DatabaseData;
  config: ViewConfig;
  rowsOf: (p: Property) => DatabaseRow[];
  /** Sends the answers; resolves the created row, or null if Rust refused them (the reason is shown by the table). */
  onSubmit: (values: Record<string, CellValue>) => Promise<PageSummary | null>;
  onOpenRow: (pageId: string) => void;
}

/** A form that creates rows in the database, like a Notion form view. */
export function DatabaseForm({ database, config, rowsOf, onSubmit, onOpenRow }: FormViewProps) {
  const form = config.form;
  const fields = resolveFields(form, database.properties);
  // `round` remounts the (uncontrolled) cells to clear them for the next response.
  const [round, setRound] = useState(0);
  const [values, setValues] = useState<Record<string, CellValue>>({});
  // The latest answers, readable synchronously: a cell saves on blur, and submitting must see that save.
  const latest = useRef(values);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<PageSummary | null>(null);

  const set = (id: string, value: CellValue | null) => {
    const next = { ...latest.current };
    if (value === null || value === "") delete next[id];
    else next[id] = value;
    latest.current = next;
    setValues(next);
  };

  const submit = async () => {
    // Leaving the focused field saves what is still being typed (a real click does this by itself).
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setBusy(true);
    const row = await onSubmit(latest.current);
    setBusy(false);
    if (row) setCreated(row);
  };

  const again = () => {
    latest.current = {};
    setValues({});
    setCreated(null);
    setRound((r) => r + 1);
  };

  if (created) {
    return (
      <div className="form-view form-done" role="status">
        <p>{form?.successMessage || "¡Gracias! Tu respuesta se ha guardado."}</p>
        <div className="db-panel-actions">
          <button type="button" onClick={again}>
            Enviar otra respuesta
          </button>
          <button type="button" onClick={() => onOpenRow(created.id)}>
            Abrir la fila
          </button>
        </div>
      </div>
    );
  }

  return (
    // A div, not a <form>: Enter in a field must not submit by itself — the cells save on blur,
    // and a submit fired in the same tick would read answers that haven't landed yet.
    <div className="form-view" role="group" aria-label={form?.title || database.name}>
      <h3 className="form-title">{form?.title || database.name}</h3>
      {form?.description && <p className="form-description">{form.description}</p>}
      {fields.length === 0 && (
        <p className="db-loading">Este formulario no pide nada todavía: usa «Editar formulario».</p>
      )}
      {fields.map((f) => (
        <div
          key={`${round}:${f.property}`}
          className="form-field"
          role="group"
          aria-label={labelOf(f)}
        >
          <span className="form-label">
            {labelOf(f)}
            {f.required && (
              <span className="form-required" aria-label="obligatorio">
                {" "}
                *
              </span>
            )}
          </span>
          {f.help && <span className="form-help">{f.help}</span>}
          {f.prop.id === TITLE_ID ? (
            <input
              className="db-input"
              type="text"
              maxLength={200}
              aria-label={labelOf(f)}
              defaultValue=""
              onChange={(e) => set(TITLE_ID, e.target.value)}
            />
          ) : (
            <Cell
              prop={f.prop}
              value={values[f.property]}
              targetRows={f.prop.type === "relation" ? rowsOf(f.prop) : []}
              commit={(v) => {
                set(f.property, v);
                return Promise.resolve(true);
              }}
            />
          )}
        </div>
      ))}
      <button
        type="button"
        className="form-submit"
        disabled={busy || fields.length === 0}
        onClick={() => void submit()}
      >
        {form?.submitLabel || "Enviar"}
      </button>
    </div>
  );
}

/** The form editor: title, description, button, message, and which questions to ask (label, help, required, order). */
export function FormBuilder({
  database,
  config,
  onChange,
}: {
  database: DatabaseData;
  config: ViewConfig;
  onChange: (next: ViewConfig) => void;
}) {
  const form = config.form ?? {};
  const current = resolveFields(form, database.properties);
  const all: Property[] = [TITLE_PROPERTY, ...database.properties];
  const save = (next: FormConfig) => onChange({ ...config, form: next });
  const setFields = (fields: FormField[]) =>
    save({
      ...form,
      fields: fields.map(({ property, label, help, required }) => ({
        property,
        ...(label ? { label } : {}),
        ...(help ? { help } : {}),
        required: !!required,
      })),
    });
  const setText = (
    key: "title" | "description" | "submitLabel" | "successMessage",
    value: string,
  ) => {
    const next: FormConfig = { ...form };
    if (value.trim()) next[key] = value.trim();
    else delete next[key];
    if (JSON.stringify(next) !== JSON.stringify(form)) save(next);
  };
  const patch = (id: string, change: Partial<FormField>) =>
    setFields(current.map((f) => (f.property === id ? { ...f, ...change } : f)));
  const move = (id: string, by: -1 | 1) => {
    const i = current.findIndex((f) => f.property === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= current.length) return;
    const next = [...current];
    [next[i], next[j]] = [next[j], next[i]];
    setFields(next);
  };

  const textInput = (
    label: string,
    key: "title" | "description" | "submitLabel" | "successMessage",
    max: number,
    placeholder?: string,
  ) => (
    <label key={key}>
      {label}
      <input
        type="text"
        maxLength={max}
        defaultValue={form[key] ?? ""}
        placeholder={placeholder}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        onBlur={(e) => setText(key, e.currentTarget.value)}
      />
    </label>
  );

  return (
    <div className="db-panel form-builder" role="group" aria-label="Editar formulario">
      {textInput("Título del formulario", "title", 100, database.name)}
      {textInput("Descripción", "description", 500)}
      {textInput("Texto del botón", "submitLabel", 40, "Enviar")}
      {textInput(
        "Mensaje al enviar",
        "successMessage",
        300,
        "¡Gracias! Tu respuesta se ha guardado.",
      )}

      <p className="db-panel-meta">Preguntas del formulario</p>
      {current.map((f, i) => (
        <div key={f.property} className="form-builder-field">
          <div className="db-rule">
            <strong>{f.prop.id === TITLE_ID ? "Título" : f.prop.name}</strong>
            <label className="db-check">
              <input
                type="checkbox"
                checked={!!f.required}
                onChange={(e) => patch(f.property, { required: e.target.checked })}
              />
              Obligatorio
            </label>
            <button
              type="button"
              className="db-icon-btn"
              aria-label={`Subir ${f.prop.name}`}
              disabled={i === 0}
              onClick={() => move(f.property, -1)}
            >
              <ArrowUp size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="db-icon-btn"
              aria-label={`Bajar ${f.prop.name}`}
              disabled={i === current.length - 1}
              onClick={() => move(f.property, 1)}
            >
              <ArrowDown size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setFields(current.filter((x) => x.property !== f.property))}
            >
              Quitar
            </button>
          </div>
          <div className="db-rule">
            <input
              type="text"
              maxLength={100}
              aria-label={`Pregunta de ${f.prop.name}`}
              placeholder={f.prop.id === TITLE_ID ? "Título" : f.prop.name}
              defaultValue={f.label ?? ""}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              onBlur={(e) =>
                e.currentTarget.value.trim() !== (f.label ?? "") &&
                patch(f.property, { label: e.currentTarget.value.trim() })
              }
            />
            <input
              type="text"
              maxLength={200}
              aria-label={`Ayuda de ${f.prop.name}`}
              placeholder="Ayuda (opcional)"
              defaultValue={f.help ?? ""}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              onBlur={(e) =>
                e.currentTarget.value.trim() !== (f.help ?? "") &&
                patch(f.property, { help: e.currentTarget.value.trim() })
              }
            />
          </div>
        </div>
      ))}
      {all.some((p) => !current.some((f) => f.property === p.id)) && (
        <div className="db-options">
          <span>Añadir:</span>
          {all
            .filter((p) => !current.some((f) => f.property === p.id))
            .map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setFields([...current, { property: p.id, required: false }])}
              >
                + {p.id === TITLE_ID ? "Título" : p.name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
