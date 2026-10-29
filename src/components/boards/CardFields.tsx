import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { setSelectOptions, setValue } from "../../lib/db-client";
import type { CellValue, Property } from "../../types";
import { OptionPopover } from "../database/OptionCell";
import { optionColor } from "../database/property-types";

/** Properties that read as labels on a card: their value is one of the property's coloured options. */
const isLabelProp = (p: Property) => p.type === "tags" || p.type === "select";

/** A plain value as a short text for a field that is not a label (null = nothing to show). */
function plain(value: CellValue | undefined): string | null {
  if (value === undefined || value === null || value === "" || value === false) return null;
  if (value === true) return "✓";
  if (Array.isArray(value)) return value.length ? value.join(", ") : null;
  if (typeof value === "object") return value.name || null;
  return String(value);
}

/** One option property of a card as Trello's labels: coloured chips and a «+» that opens the same list a cell does. */
function Labels({
  prop,
  value,
  taskId,
  onWritten,
  onError,
}: {
  prop: Property;
  value: CellValue | undefined;
  taskId: string;
  onWritten: () => void;
  onError: (message: string) => void;
}) {
  const multi = prop.type === "tags";
  const selected = multi
    ? Array.isArray(value)
      ? (value as string[])
      : []
    : typeof value === "string" && value
      ? [value]
      : [];
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  const commit = async (next: CellValue | null) => {
    try {
      await setValue(taskId, prop.id, next);
      onWritten();
    } catch (e) {
      onError(String(e));
    }
  };
  const close = () => {
    setAnchor(null);
    addRef.current?.focus();
  };

  return (
    <div className="board-labels" role="group" aria-label={prop.name}>
      {selected.map((option) => (
        <span key={option} className="board-label" data-color={optionColor(prop, option)}>
          {option}
        </span>
      ))}
      <button
        ref={addRef}
        type="button"
        className="board-label-add"
        aria-label={`Cambiar ${prop.name}`}
        title={prop.name}
        onClick={() => addRef.current && setAnchor(addRef.current.getBoundingClientRect())}
      >
        <Plus size={11} aria-hidden="true" />
      </button>
      {anchor && (
        <OptionPopover
          prop={prop}
          selected={selected}
          multi={multi}
          anchor={anchor}
          onPick={(option) => {
            if (!multi) {
              close();
              void commit(option);
            } else {
              void commit(
                selected.includes(option)
                  ? selected.filter((t) => t !== option)
                  : [...selected, option],
              );
            }
          }}
          // the option exists before the value does: Rust checks a value against the property's options
          onCreate={async (name) => {
            try {
              await setSelectOptions(prop.id, [...(prop.config.options ?? []), name]);
            } catch (e) {
              return String(e);
            }
            if (!multi) close();
            void commit(multi ? [...selected, name] : name);
            return null;
          }}
          onClear={() => {
            close();
            void commit(null);
          }}
          onClose={close}
        />
      )}
    </div>
  );
}

/** The fields the board shows on its cards, taken from the task table's properties. */
export function CardFields({
  props,
  values,
  taskId,
  onWritten,
  onError,
}: {
  props: Property[];
  values: Record<string, CellValue>;
  taskId: string;
  onWritten: () => void;
  onError: (message: string) => void;
}) {
  if (props.length === 0) return null;
  return (
    <div className="board-card-fields">
      {props.map((p) =>
        isLabelProp(p) ? (
          <Labels
            key={p.id}
            prop={p}
            value={values[p.id]}
            taskId={taskId}
            onWritten={onWritten}
            onError={onError}
          />
        ) : (
          plain(values[p.id]) && (
            <span key={p.id} className="board-field" title={p.name}>
              {plain(values[p.id])}
            </span>
          )
        ),
      )}
    </div>
  );
}
