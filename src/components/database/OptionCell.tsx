import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Plus, X } from "lucide-react";
import { setSelectOptions } from "../../lib/db-client";
import type { CellValue, Property } from "../../types";
import type { Commit } from "./cell-commit";
import { STATUS_GROUPS, optionColor } from "./property-types";

const POPOVER_WIDTH = 260;
const MAX_NAME = 60;

type Entry =
  | { kind: "heading"; label: string }
  | { kind: "option"; option: string }
  | { kind: "create"; name: string }
  | { kind: "clear" };

/**
 * The options of a select or tags cell, Notion's way: pressing anywhere on the cell opens a list with a box
 * to search the options or, when none matches, create the one you typed. A select takes one and closes;
 * tags toggle and stay open. A status property lists its options under their groups.
 */
function OptionPopover({
  prop,
  selected,
  multi,
  anchor,
  onPick,
  onCreate,
  onClear,
  onClose,
}: {
  prop: Property;
  selected: string[];
  multi: boolean;
  anchor: DOMRect;
  onPick: (option: string) => void;
  onCreate: (name: string) => Promise<string | null>;
  onClear: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const entries = useMemo<Entry[]>(() => {
    const needle = query.trim().toLowerCase();
    const options = (prop.config.options ?? []).filter(
      (o) => !needle || o.toLowerCase().includes(needle),
    );
    const out: Entry[] = [];
    if (prop.config.status) {
      for (const { group, label } of STATUS_GROUPS) {
        const inGroup = options.filter((o) => (prop.config.groups?.[o] ?? "todo") === group);
        if (inGroup.length === 0) continue;
        out.push({ kind: "heading", label });
        out.push(...inGroup.map((option) => ({ kind: "option" as const, option })));
      }
    } else {
      out.push(...options.map((option) => ({ kind: "option" as const, option })));
    }
    const typed = query.trim();
    const exists = (prop.config.options ?? []).some((o) => o.toLowerCase() === typed.toLowerCase());
    if (typed && !exists) out.push({ kind: "create", name: typed });
    if (!multi && selected.length > 0 && !typed) out.push({ kind: "clear" });
    return out;
  }, [prop.config, query, selected, multi]);

  const choosable = entries.map((e, i) => (e.kind === "heading" ? -1 : i)).filter((i) => i >= 0);
  const current = choosable.includes(active) ? active : (choosable[0] ?? -1);

  // A click outside closes the list and only that: the capture phase keeps it from also reaching what's behind.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  const choose = async (entry: Entry | undefined) => {
    if (!entry || entry.kind === "heading") return;
    if (entry.kind === "option") onPick(entry.option);
    else if (entry.kind === "clear") onClear();
    else {
      const failure = await onCreate(entry.name);
      if (failure) setError(failure);
      else setQuery("");
    }
  };

  const below = window.innerHeight - anchor.bottom - 8;
  const up = below < 220 && anchor.top > below;
  const style = {
    left: Math.max(8, Math.min(anchor.left, window.innerWidth - POPOVER_WIDTH - 8)),
    width: Math.max(POPOVER_WIDTH, Math.min(anchor.width, 360)),
    ...(up
      ? { bottom: window.innerHeight - anchor.top + 2, maxHeight: anchor.top - 8 }
      : { top: anchor.bottom + 2, maxHeight: below }),
  };

  return createPortal(
    <div ref={popRef} className="option-pop" style={style} role="listbox" aria-label={prop.name}>
      <input
        autoFocus
        type="text"
        className="option-pop-search"
        value={query}
        maxLength={MAX_NAME}
        placeholder={multi ? "Busca o crea una opción…" : "Selecciona una opción o crea una…"}
        aria-label="Buscar o crear una opción"
        onChange={(e) => {
          setQuery(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const at = choosable.indexOf(current);
            const next =
              choosable[
                (at + (e.key === "ArrowDown" ? 1 : -1) + choosable.length) % choosable.length
              ];
            if (next !== undefined) setActive(next);
          } else if (e.key === "Enter") {
            e.preventDefault();
            void choose(entries[current]);
          }
        }}
      />
      {error && (
        <p className="option-pop-error" role="alert">
          {error}
        </p>
      )}
      <div className="option-pop-list">
        {entries.map((entry, i) => {
          if (entry.kind === "heading") {
            return (
              <div key={`h-${entry.label}`} className="option-pop-heading">
                {entry.label}
              </div>
            );
          }
          const isActive = i === current;
          if (entry.kind === "create") {
            return (
              <button
                key="create"
                type="button"
                role="option"
                aria-selected={false}
                data-active={isActive || undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => void choose(entry)}
              >
                <Plus size={14} aria-hidden="true" /> Crear{" "}
                <span className="opt-chip">{entry.name}</span>
              </button>
            );
          }
          if (entry.kind === "clear") {
            return (
              <button
                key="clear"
                type="button"
                role="option"
                aria-selected={false}
                data-active={isActive || undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => void choose(entry)}
              >
                <X size={14} aria-hidden="true" /> Quitar la selección
              </button>
            );
          }
          const on = selected.includes(entry.option);
          return (
            <button
              key={entry.option}
              type="button"
              role="option"
              aria-selected={on}
              data-active={isActive || undefined}
              onMouseEnter={() => setActive(i)}
              onClick={() => void choose(entry)}
            >
              <span className="opt-chip" data-color={optionColor(prop, entry.option)}>
                {entry.option}
              </span>
              {on && <Check size={14} aria-hidden="true" className="opt-check" />}
            </button>
          );
        })}
        {entries.length === 0 && <p className="option-pop-empty">Escribe para crear una opción.</p>}
      </div>
    </div>,
    document.body,
  );
}

/** A select (one option), status (one option, grouped) or tags (several) cell. */
export function OptionCell({
  prop,
  value,
  commit,
}: {
  prop: Property;
  value: CellValue | undefined;
  commit: Commit;
}) {
  const multi = prop.type === "tags";
  const tags = multi && Array.isArray(value) ? (value as string[]) : [];
  const single = !multi && typeof value === "string" ? value : "";
  const selected = multi ? tags : single ? [single] : [];
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const cellRef = useRef<HTMLDivElement>(null);
  const open = () => cellRef.current && setAnchor(cellRef.current.getBoundingClientRect());

  // closing the list hands the focus back to the cell, so the keyboard can carry on from there
  const close = () => {
    setAnchor(null);
    cellRef.current?.focus();
  };

  const pick = (option: string) => {
    if (!multi) {
      close();
      void commit(option);
    } else {
      void commit(tags.includes(option) ? tags.filter((t) => t !== option) : [...tags, option]);
    }
  };

  // The option exists before the value does: Rust checks a cell's value against the property's options.
  const create = async (name: string): Promise<string | null> => {
    try {
      await setSelectOptions(prop.id, [...(prop.config.options ?? []), name]);
    } catch (e) {
      return String(e);
    }
    if (multi) {
      void commit([...tags, name]);
    } else {
      close();
      void commit(name);
    }
    return null;
  };

  return (
    <>
      <div
        ref={cellRef}
        className={multi ? "db-relation db-tags db-option-cell" : "db-select-cell db-option-cell"}
        data-color={!multi ? optionColor(prop, single) : undefined}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={anchor !== null}
        aria-label={prop.name}
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          // the arrows are the table's: they move between cells (see grid-nav.ts)
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
      >
        {multi ? (
          tags.map((tag) => (
            <span key={tag} className="db-chip db-tag" data-color={optionColor(prop, tag)}>
              {tag}
              <button
                type="button"
                aria-label={`Quitar ${tag}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void commit(tags.filter((t) => t !== tag));
                }}
              >
                ×
              </button>
            </span>
          ))
        ) : (
          <span className="db-select-chip" data-empty={!single || undefined}>
            {single || "—"}
          </span>
        )}
      </div>
      {anchor && (
        <OptionPopover
          prop={prop}
          selected={selected}
          multi={multi}
          anchor={anchor}
          onPick={pick}
          onCreate={create}
          onClear={() => {
            close();
            void commit(null);
          }}
          onClose={close}
        />
      )}
    </>
  );
}
