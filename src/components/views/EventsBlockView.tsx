import { useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { CalendarDays, ChartNoAxesGantt, Plus } from "lucide-react";
import { addDays, todayIso } from "../../lib/date-utils";
import { CalendarGrid } from "./CalendarGrid";
import { EventPanel } from "./EventPanel";
import { TimelineChart } from "./TimelineChart";
import { MAX_ITEMS, toDatedItems, type StoredEvent } from "./view-items";
import "../database/DatabaseView.css"; // shared form controls

interface Config {
  kind: "calendar" | "timeline";
  title: string;
  noun: string;
}

/** Shared by the standalone calendar and timeline blocks: the same entries, drawn two ways. */
function EventsBlock({
  node,
  updateAttributes,
  deleteNode,
  editor,
  config,
}: NodeViewProps & { config: Config }) {
  const events = node.attrs.events as StoredEvent[];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const selected = events.find((e) => e.id === selectedId);
  const Icon = config.kind === "calendar" ? CalendarDays : ChartNoAxesGantt;

  const save = (next: StoredEvent[]) => updateAttributes({ events: next });
  const add = (start: string, end?: string) => {
    if (events.length >= MAX_ITEMS) return;
    const created: StoredEvent = {
      id: crypto.randomUUID(),
      title: "",
      start,
      ...(end ? { end } : {}),
    };
    save([...events, created]);
    setSelectedId(created.id);
  };

  const remove = () => {
    deleteNode();
    editor.commands.focus();
  };

  return (
    <NodeViewWrapper className="db-block view-block" contentEditable={false}>
      <div className="db-header">
        <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
        <span className="db-title view-block-title">{config.title}</span>
        <span className="db-header-actions">
          {config.kind === "timeline" && (
            <button type="button" onClick={() => add(todayIso(), addDays(todayIso(), 6))}>
              <Plus size={12} aria-hidden="true" /> Añadir {config.noun}
            </button>
          )}
          {confirmRemove ? (
            <>
              <span>¿Quitar{events.length > 0 ? ` (se pierden ${events.length})` : ""}?</span>
              <button type="button" onClick={remove}>
                Sí, quitar
              </button>
              <button type="button" onClick={() => setConfirmRemove(false)}>
                No
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => (events.length > 0 ? setConfirmRemove(true) : remove())}
            >
              Quitar
            </button>
          )}
        </span>
      </div>

      {config.kind === "calendar" ? (
        <CalendarGrid
          items={toDatedItems(events)}
          selectedId={selectedId}
          onOpen={setSelectedId}
          onAddOn={(day) => add(day)}
        />
      ) : (
        <>
          <TimelineChart
            items={toDatedItems(events)}
            selectedId={selectedId}
            onOpen={setSelectedId}
          />
          {events.length === 0 && (
            <p className="db-loading">Aún no hay nada: pulsa «Añadir {config.noun}».</p>
          )}
        </>
      )}

      {selected && (
        <EventPanel
          key={selected.id}
          event={selected}
          noun={config.noun}
          onChange={(next) => save(events.map((e) => (e.id === next.id ? next : e)))}
          onDelete={() => {
            save(events.filter((e) => e.id !== selected.id));
            setSelectedId(null);
          }}
          onClose={() => setSelectedId(null)}
        />
      )}
    </NodeViewWrapper>
  );
}

export function CalendarBlockView(props: NodeViewProps) {
  return (
    <EventsBlock {...props} config={{ kind: "calendar", title: "Calendario", noun: "evento" }} />
  );
}

export function TimelineBlockView(props: NodeViewProps) {
  return (
    <EventsBlock {...props} config={{ kind: "timeline", title: "Cronograma", noun: "elemento" }} />
  );
}
