import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownWideNarrow,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpDown,
  ArrowUpNarrowWide,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  EyeOff,
  ListFilter,
  Pin,
  PinOff,
  Plus,
  Repeat,
  Rows3,
  Sigma,
  SlidersHorizontal,
  Trash2,
  Type,
  WrapText,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  addProperty,
  changePropertyType,
  deleteProperty,
  duplicateProperty,
  listDatabases,
  renameProperty,
  renameSelectOption,
  reorderProperties,
  setOptionColor,
  setOptionGroup,
  setPropertyIcon,
  setSelectOptions,
} from "../../lib/db-client";
import type {
  Calc,
  DatabaseData,
  DatabaseSummary,
  Property,
  PropertyKind,
  StatusGroup,
  ViewConfig,
  ViewKind,
} from "../../types";
import { calcLabel, calcsFor } from "./calculations";
import { IconPicker, PropIcon } from "./PropIcon";
import {
  STATUS_GROUPS,
  TAG_COLORS,
  TYPE_CHOICES,
  TYPE_ICONS,
  TYPE_LABELS,
  optionColor,
  typeChoiceOf,
  type TypeChoice,
} from "./property-types";
import { OPERATORS, TITLE_ID } from "./view-config";

export type MenuView = "main" | "edit" | "type" | "icon" | "sort" | "calc";

interface PropertyMenuProps {
  /** Where to open: the column header (or footer cell) that was clicked. */
  anchor: DOMRect;
  /** A property id, or TITLE_ID for the row's title column. */
  column: string;
  startView?: MenuView;
  /** A property just created from this menu: its name starts selected, ready to type over. */
  fresh?: boolean;
  data: DatabaseData;
  config: ViewConfig;
  viewKind: ViewKind;
  run: (write: () => Promise<unknown>) => Promise<boolean>;
  onConfig: (next: ViewConfig) => void;
  /** «Filtrar» adds a rule for this column, then the view's filter panel takes over. */
  onOpenFilter: () => void;
  /** After inserting a column, its own menu opens. */
  onOpenColumn: (id: string) => void;
  onClose: () => void;
}

const MENU_WIDTH = 290;

/**
 * The menu of one table column, like Notion's: rename, edit options (with colours), change type,
 * filter, sort, group, calculate, freeze, hide, wrap, insert, duplicate, delete. Rendered in a portal
 * so the table's scroll container never clips it.
 */
export function PropertyMenu(props: PropertyMenuProps) {
  const { anchor, column, data, config, viewKind, run, onConfig, onClose } = props;
  const [view, setView] = useState<MenuView>(props.startView ?? "main");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [relationPick, setRelationPick] = useState<DatabaseSummary[] | null>(null);
  const [colorFor, setColorFor] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isTitle = column === TITLE_ID;
  const prop = isTitle ? null : (data.properties.find((p) => p.id === column) ?? null);
  const kind: PropertyKind = prop?.type ?? "text";
  // Filter/sort/group/hide are the view's own tools; the form's answers table only edits the properties.
  const viewTools = viewKind === "table";

  // A click outside closes; a click on another column header is handled by the table (it switches menus).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (menuRef.current?.contains(target) || target.closest(".db-prop-name, .db-calc-cell"))
        return;
      // commit a name or option being edited before the menu unmounts under it
      const active = document.activeElement;
      if (active instanceof HTMLElement && menuRef.current?.contains(active)) active.blur();
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (view === "main") onClose();
      else setView("main");
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, view]);

  // The property was deleted (or not loaded yet after being created): nothing to show.
  if (!isTitle && !prop) return null;

  // Open below the header, or above it when there's more room there (a footer cell near the bottom).
  const below = window.innerHeight - anchor.bottom - 8;
  const above = anchor.top - 8;
  const up = below < 280 && above > below;
  const style = {
    left: Math.max(8, Math.min(anchor.left, window.innerWidth - MENU_WIDTH - 8)),
    ...(up
      ? { bottom: window.innerHeight - anchor.top + 4, maxHeight: above }
      : { top: anchor.bottom + 4, maxHeight: below }),
  };

  const setConfig = (next: ViewConfig) => onConfig(next);
  const done = (next: ViewConfig) => {
    setConfig(next);
    onClose();
  };

  const sortDirection = config.sorts.find((s) => s.property === column)?.direction;
  const sortBy = (direction: "asc" | "desc" | null) =>
    done({
      ...config,
      sorts: [
        ...(direction ? [{ property: column, direction }] : []),
        ...config.sorts.filter((s) => s.property !== column),
      ],
    });

  const calc = config.calculations?.[column];
  const setCalc = (next: Calc | null) => {
    const calculations = { ...config.calculations };
    if (next) calculations[column] = next;
    else delete calculations[column];
    done({ ...config, calculations });
  };

  const wrapped = config.wrapped?.includes(column) ?? false;
  const grouped = config.group?.property === column;
  const frozen = config.frozenUpTo === column;

  const insert = (side: -1 | 1) => {
    let created = "";
    void run(async () => {
      const added = await addProperty(data.id, TYPE_LABELS.text, "text");
      const ids = data.properties.map((p) => p.id);
      const at = isTitle ? 0 : ids.indexOf(column) + (side === 1 ? 1 : 0);
      ids.splice(at, 0, added.id);
      await reorderProperties(data.id, ids);
      created = added.id;
    }).then((ok) => ok && props.onOpenColumn(created));
  };

  const changeType = (choice: TypeChoice, target?: string) => {
    if (!prop) return;
    const config = target
      ? { target }
      : choice.format
        ? { format: choice.format }
        : choice.status
          ? { status: true }
          : {};
    void run(() => changePropertyType(prop.id, choice.kind, config)).then(() => {
      setRelationPick(null);
      setView("main");
    });
  };

  const header = (title: string) => (
    <div className="pm-subhead">
      <button type="button" className="pm-back" aria-label="Volver" onClick={() => setView("main")}>
        <ChevronLeft size={16} />
      </button>
      <span>{title}</span>
    </div>
  );

  let body: ReactNode;

  if (view === "type" && prop) {
    body = (
      <>
        {header("Cambiar tipo")}
        {relationPick ? (
          <>
            <p className="pm-note">¿Con qué base de datos se relaciona?</p>
            {relationPick.map((d) => (
              <Item
                key={d.id}
                icon={TYPE_ICONS.relation}
                label={d.name || "Sin título"}
                onClick={() =>
                  changeType(
                    TYPE_CHOICES.find((c) => c.kind === "relation")!,
                    d.id,
                  )
                }
              />
            ))}
          </>
        ) : (
          <>
            {TYPE_CHOICES.map((c) => (
              <Item
                key={c.id}
                icon={c.icon}
                label={c.label}
                checked={c.id === typeChoiceOf(prop).id}
                onClick={() => {
                  if (c.id === typeChoiceOf(prop).id) return setView("main");
                  if (c.kind === "relation") return void listDatabases().then(setRelationPick);
                  changeType(c);
                }}
              />
            ))}
            <p className="pm-note">
              Los valores se convierten al tipo nuevo; los que no encajen se vacían.
            </p>
          </>
        )}
      </>
    );
  } else if (view === "edit" && prop) {
    body = (
      <>
        {header("Editar propiedad")}
        {prop.type === "select" || prop.type === "tags" ? (
          <OptionsEditor prop={prop} run={run} colorFor={colorFor} setColorFor={setColorFor} />
        ) : (
          <RelationInfo target={prop.config.target} />
        )}
      </>
    );
  } else if (view === "icon" && prop) {
    body = (
      <>
        {header("Icono")}
        <IconPicker
          current={prop.icon}
          onPick={(icon) =>
            void run(() => setPropertyIcon(prop.id, icon)).then(() => setView("main"))
          }
        />
      </>
    );
  } else if (view === "sort") {
    body = (
      <>
        {header("Ordenar")}
        <Item
          icon={ArrowUpNarrowWide}
          label="Ascendente"
          checked={sortDirection === "asc"}
          onClick={() => sortBy("asc")}
        />
        <Item
          icon={ArrowDownWideNarrow}
          label="Descendente"
          checked={sortDirection === "desc"}
          onClick={() => sortBy("desc")}
        />
        {sortDirection && <Item icon={X} label="Quitar orden" onClick={() => sortBy(null)} />}
      </>
    );
  } else if (view === "calc") {
    body = (
      <>
        {props.startView !== "calc" && header("Calcular")}
        <Item icon={X} label="Ninguno" checked={!calc} onClick={() => setCalc(null)} />
        {calcsFor(kind).map((c) => (
          <Item
            key={c}
            icon={Sigma}
            label={calcLabel(c, kind).menu}
            checked={calc === c}
            onClick={() => setCalc(c)}
          />
        ))}
      </>
    );
  } else {
    body = (
      <>
        <div className="pm-head">
          {prop ? (
            <button
              type="button"
              className="pm-type"
              title="Cambiar el icono"
              aria-label="Cambiar el icono"
              onClick={() => setView("icon")}
            >
              <PropIcon prop={prop} size={16} />
            </button>
          ) : (
            <span className="pm-type" aria-hidden="true">
              <Type size={16} />
            </span>
          )}
          {prop ? (
            <input
              key={prop.name}
              className="pm-name"
              type="text"
              maxLength={60}
              defaultValue={prop.name}
              aria-label="Nombre de la propiedad"
              autoFocus
              onFocus={(e) => props.fresh && e.currentTarget.select()}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              onBlur={(e) => {
                const name = e.currentTarget.value.trim();
                if (name && name !== prop.name) void run(() => renameProperty(prop.id, name));
                else e.currentTarget.value = prop.name;
              }}
            />
          ) : (
            <span className="pm-name pm-name-static">Nombre</span>
          )}
        </div>
        {(prop?.type === "select" || prop?.type === "tags" || prop?.type === "relation") && (
          <Item
            icon={SlidersHorizontal}
            label="Editar propiedad"
            chevron
            onClick={() => setView("edit")}
          />
        )}
        {prop && (
          <Item icon={Repeat} label="Cambiar tipo" chevron onClick={() => setView("type")} />
        )}
        <hr className="pm-sep" />
        {viewTools && (
          <Item
            icon={ListFilter}
            label="Filtrar"
            onClick={() => {
              const rule = { property: column, operator: OPERATORS[kind][0] };
              setConfig({
                ...config,
                filter: { ...config.filter, rules: [...config.filter.rules, rule] },
              });
              props.onOpenFilter();
              onClose();
            }}
          />
        )}
        {viewTools && (
          <Item icon={ArrowUpDown} label="Ordenar" chevron onClick={() => setView("sort")} />
        )}
        {viewTools && prop && (
          <Item
            icon={Rows3}
            label={grouped ? "Desagrupar" : "Agrupar"}
            onClick={() =>
              done({
                ...config,
                group: grouped ? undefined : { property: column, hideEmpty: false },
              })
            }
          />
        )}
        <Item icon={Sigma} label="Calcular" chevron onClick={() => setView("calc")} />
        <Item
          icon={frozen ? PinOff : Pin}
          label={frozen ? "Desfijar" : "Fijar"}
          onClick={() => done({ ...config, frozenUpTo: frozen ? undefined : column })}
        />
        {viewTools && prop && (
          <Item
            icon={EyeOff}
            label="Ocultar"
            onClick={() =>
              done({ ...config, hiddenProperties: [...(config.hiddenProperties ?? []), column] })
            }
          />
        )}
        <Item
          icon={WrapText}
          label="Ajustar contenido"
          checked={wrapped}
          onClick={() =>
            done({
              ...config,
              wrapped: wrapped
                ? config.wrapped!.filter((c) => c !== column)
                : [...(config.wrapped ?? []), column],
            })
          }
        />
        <hr className="pm-sep" />
        {prop && (
          <Item icon={ArrowLeftToLine} label="Insertar a la izquierda" onClick={() => insert(-1)} />
        )}
        <Item icon={ArrowRightToLine} label="Insertar a la derecha" onClick={() => insert(1)} />
        {prop && (
          <Item
            icon={Copy}
            label="Duplicar propiedad"
            onClick={() => void run(() => duplicateProperty(prop.id)).then(onClose)}
          />
        )}
        {prop &&
          (confirmDelete ? (
            <div className="pm-confirm" role="alert">
              <span>¿Eliminar «{prop.name}» y todos sus valores?</span>
              <button
                type="button"
                className="pm-danger-btn"
                onClick={() => void run(() => deleteProperty(prop.id)).then(onClose)}
              >
                Eliminar
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </button>
            </div>
          ) : (
            <Item
              icon={Trash2}
              label="Eliminar propiedad"
              danger
              onClick={() => setConfirmDelete(true)}
            />
          ))}
      </>
    );
  }

  return createPortal(
    <div
      ref={menuRef}
      className="prop-menu"
      role="menu"
      aria-label={`Propiedad ${prop?.name ?? "Nombre"}`}
      style={style}
    >
      {body}
    </div>,
    document.body,
  );
}

function Item({
  icon: Icon,
  label,
  onClick,
  chevron,
  checked,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  chevron?: boolean;
  checked?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="pm-item"
      data-danger={danger || undefined}
      onClick={onClick}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      <span className="pm-label">{label}</span>
      {checked && <Check size={16} aria-label="activo" />}
      {chevron && <ChevronRight size={16} className="pm-chevron" aria-hidden="true" />}
    </button>
  );
}

/** A select's options as in Notion's «Editar propiedad»: each with its colour, renamable, removable. */
function OptionsEditor({
  prop,
  run,
  colorFor,
  setColorFor,
}: {
  prop: Property;
  run: (write: () => Promise<unknown>) => Promise<boolean>;
  colorFor: string | null;
  setColorFor: (option: string | null) => void;
}) {
  const options = prop.config.options ?? [];
  return (
    <>
      <div className="pm-section">Opciones</div>
      {options.map((o) => (
        <div key={o}>
          <div className="pm-option">
            <button
              type="button"
              className="pm-swatch"
              data-color={optionColor(prop, o)}
              aria-label={`Color de ${o}`}
              aria-expanded={colorFor === o}
              onClick={() => setColorFor(colorFor === o ? null : o)}
            />
            {/* Rust rewrites the values that used the old name (and moves its colour). */}
            <input
              className="pm-option-name"
              data-color={optionColor(prop, o)}
              type="text"
              maxLength={60}
              defaultValue={o}
              aria-label={`Opción ${o}`}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") {
                  e.stopPropagation();
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
                if (!(await run(() => renameSelectOption(prop.id, o, name)))) input.value = o;
              }}
            />
            {prop.config.status && (
              <select
                className="pm-option-group"
                value={prop.config.groups?.[o] ?? "todo"}
                aria-label={`Grupo de ${o}`}
                onChange={(e) =>
                  void run(() => setOptionGroup(prop.id, o, e.target.value as StatusGroup))
                }
              >
                {STATUS_GROUPS.map(({ group, label }) => (
                  <option key={group} value={group}>
                    {label}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="pm-icon"
              aria-label={`Quitar opción ${o}`}
              title="Quitar opción (vacía las celdas que la usan)"
              onClick={() =>
                void run(() =>
                  setSelectOptions(
                    prop.id,
                    options.filter((x) => x !== o),
                  ),
                )
              }
            >
              <X size={14} />
            </button>
          </div>
          {colorFor === o && (
            <div className="pm-colors" role="radiogroup" aria-label={`Color de ${o}`}>
              {TAG_COLORS.map(({ color, label }) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={optionColor(prop, o) === color}
                  className="pm-item"
                  onClick={() =>
                    void run(() => setOptionColor(prop.id, o, color)).then(() => setColorFor(null))
                  }
                >
                  <span className="pm-swatch" data-color={color} aria-hidden="true" />
                  <span className="pm-label">{label}</span>
                  {optionColor(prop, o) === color && <Check size={16} aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="pm-option">
        <Plus size={16} className="pm-muted" aria-hidden="true" />
        <input
          className="pm-option-new"
          type="text"
          maxLength={60}
          placeholder="Añadir una opción…"
          aria-label="Nueva opción"
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const input = e.currentTarget;
            const name = input.value.trim();
            if (!name) return;
            void run(() => setSelectOptions(prop.id, [...options, name])).then(
              (ok) => ok && (input.value = ""),
            );
          }}
        />
      </div>
    </>
  );
}

function RelationInfo({ target }: { target?: string }) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    void listDatabases().then((all) =>
      setName(all.find((d) => d.id === target)?.name || "Sin título"),
    );
  }, [target]);
  return <p className="pm-note">Relacionada con la base de datos «{name ?? "…"}».</p>;
}
