import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useAttachmentUrl } from "../../hooks/useAttachmentUrl";
import type { CellValue, DatabaseRow, Property, RowPreview } from "../../types";
import { cellKey } from "./cell-commit";
import { Cell } from "./DatabaseCells";

/** A run of rows: the whole view, or one group / board column. */
export interface Section {
  key: string;
  /** null when the view isn't grouped */
  label: string | null;
  rows: DatabaseRow[];
}

type CardKind = "list" | "gallery" | "feed" | "board";

interface CardsProps {
  kind: CardKind;
  sections: Section[];
  /** Properties this view shows (hidden ones already removed). */
  properties: Property[];
  previews: Record<string, RowPreview> | null;
  rowsOf: (p: Property) => DatabaseRow[];
  onOpen: (pageId: string) => void;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  /** Saves one cell (Rust validates it); resolves false if rejected. */
  onCommit: (pageId: string, propertyId: string, value: CellValue | null) => Promise<boolean>;
  /** Board only: the select whose options are the columns, and the add-card handler. */
  board: {
    property: Property | null;
    onAdd: (columnKey: string) => void;
  };
}

/**
 * The row's visible properties as the same typed cells the table uses, so a
 * card edits the database itself (validated by Rust, and every other view of it
 * refreshes through the database bus). Empty ones stay so they can be filled;
 * hide the ones you don't want from the «Propiedades» panel.
 */
function CardFields({
  row,
  properties,
  rowsOf,
  onCommit,
  skip,
}: {
  row: DatabaseRow;
  properties: Property[];
  rowsOf: CardsProps["rowsOf"];
  onCommit: CardsProps["onCommit"];
  skip?: string;
}) {
  const shown = properties.filter((p) => p.id !== skip);
  if (shown.length === 0) return null;
  return (
    <div className="card-fields">
      {shown.map((p) => {
        const value = row.values[p.id];
        return (
          <div key={p.id} className="card-field">
            <span className="card-field-name" title={p.name}>
              {p.name}
            </span>
            <Cell
              key={cellKey(p, value)}
              prop={p}
              value={value}
              targetRows={p.type === "relation" ? rowsOf(p) : []}
              commit={(v) => onCommit(row.pageId, p.id, v)}
            />
          </div>
        );
      })}
    </div>
  );
}

function CardImage({ file }: { file: string }) {
  const url = useAttachmentUrl(file);
  return url ? (
    <img className="card-image" src={url} alt="" loading="lazy" />
  ) : (
    <div className="card-image card-image-empty" />
  );
}

function Title({ row, onOpen }: { row: DatabaseRow; onOpen: CardsProps["onOpen"] }) {
  return (
    <button
      type="button"
      className="card-title"
      onClick={() => onOpen(row.pageId)}
      title="Abrir como página"
    >
      {row.title}
    </button>
  );
}

function SectionHeader({
  section,
  collapsed,
  onToggle,
}: {
  section: Section;
  collapsed: boolean;
  onToggle: (key: string) => void;
}) {
  return (
    <button
      type="button"
      className="db-group-toggle card-section-toggle"
      aria-expanded={!collapsed}
      onClick={() => onToggle(section.key)}
    >
      {collapsed ? (
        <ChevronRight size={14} aria-hidden="true" />
      ) : (
        <ChevronDown size={14} aria-hidden="true" />
      )}
      <span className="db-group-label">{section.label}</span>
      <span className="db-tool-count">{section.rows.length}</span>
    </button>
  );
}

export function DatabaseCards(props: CardsProps) {
  const {
    kind,
    sections,
    properties,
    previews,
    rowsOf,
    onOpen,
    collapsed,
    onToggle,
    onCommit,
    board,
  } = props;

  if (kind === "board") {
    if (!board.property) {
      return (
        <p className="db-loading">
          Elige una propiedad de selección en «Agrupar»: sus opciones serán las columnas del
          tablero.
        </p>
      );
    }
    const groupProp = board.property;
    return (
      <div className="board" role="list">
        {sections.map((section) => (
          <section
            key={section.key || "__none__"}
            className="board-column"
            role="listitem"
            aria-label={section.label ?? ""}
          >
            <header className="board-column-header">
              <span className="db-group-label">{section.label}</span>
              <span className="db-tool-count">{section.rows.length}</span>
              <button
                type="button"
                className="db-icon-btn"
                aria-label={`Añadir fila a ${section.label}`}
                title="Añadir fila a esta columna"
                onClick={() => board.onAdd(section.key)}
              >
                <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </header>
            {section.rows.map((row) => (
              <article key={row.pageId} className="card">
                <Title row={row} onOpen={onOpen} />
                <CardFields
                  row={row}
                  properties={properties}
                  rowsOf={rowsOf}
                  onCommit={onCommit}
                  skip={groupProp.id}
                />
                {/* Changing the column's own property moves the card (drag and drop is not supported here). */}
                <Cell
                  key={String(row.values[groupProp.id] ?? "")}
                  prop={groupProp}
                  value={row.values[groupProp.id]}
                  targetRows={[]}
                  commit={(v) => onCommit(row.pageId, groupProp.id, v)}
                />
              </article>
            ))}
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className={`cards cards-${kind}`}>
      {sections.map((section) => {
        const closed = section.label !== null && collapsed.has(section.key);
        return (
          <section key={section.key || "__all__"} className="cards-section">
            {section.label !== null && (
              <SectionHeader section={section} collapsed={closed} onToggle={onToggle} />
            )}
            {!closed && (
              <div className={`cards-items cards-items-${kind}`} role="list">
                {section.rows.map((row) => {
                  const preview = previews?.[row.pageId];
                  return (
                    <article key={`${section.key}:${row.pageId}`} className="card" role="listitem">
                      {kind === "gallery" && preview?.image && <CardImage file={preview.image} />}
                      <div className="card-body">
                        <Title row={row} onOpen={onOpen} />
                        <CardFields
                          row={row}
                          properties={properties}
                          rowsOf={rowsOf}
                          onCommit={onCommit}
                        />
                        {preview?.snippet && <p className="card-snippet">{preview.snippet}</p>}
                      </div>
                      {kind === "feed" && preview?.image && <CardImage file={preview.image} />}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
