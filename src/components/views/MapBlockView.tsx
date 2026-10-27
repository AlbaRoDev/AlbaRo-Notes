import { useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Map as MapIcon, Search } from "lucide-react";
import { geocodePlace, type GeocodeResult } from "../../lib/db-client";
import { MapCanvas } from "./MapCanvas";
import { MAX_ITEMS, MAX_ITEM_TITLE, type StoredPin } from "./view-items";
import "../database/DatabaseView.css"; // shared form controls

/** Edits one pin. Fields save when you leave them; coordinates only when both are real. */
function PinPanel({
  pin,
  onChange,
  onDelete,
  onClose,
}: {
  pin: StoredPin;
  onChange: (next: StoredPin) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState<string | null>(null);

  const saveCoords = (lat: HTMLInputElement, lng: HTMLInputElement) => {
    const [la, ln] = [Number(lat.value), Number(lng.value)];
    const ok =
      lat.value !== "" &&
      lng.value !== "" &&
      !lat.validity.badInput &&
      !lng.validity.badInput &&
      Math.abs(la) <= 90 &&
      Math.abs(ln) <= 180;
    if (!ok) {
      setNote("Latitud entre -90 y 90, longitud entre -180 y 180");
      lat.value = String(pin.lat);
      lng.value = String(pin.lng);
      return;
    }
    setNote(null);
    if (la !== pin.lat || ln !== pin.lng) onChange({ ...pin, lat: la, lng: ln });
  };

  return (
    <div
      className="db-panel"
      role="group"
      aria-label="Editar pin"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <label>
        Nombre del sitio
        <input
          autoFocus
          type="text"
          maxLength={MAX_ITEM_TITLE}
          defaultValue={pin.title}
          placeholder="Sin título"
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={(e) => {
            const title = e.currentTarget.value.trim();
            if (title !== pin.title) onChange({ ...pin, title });
          }}
        />
      </label>
      {/* Both coordinates are saved together when focus leaves the pair. */}
      <div
        className="db-rule"
        onBlur={(e) => {
          if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
          const inputs = e.currentTarget.querySelectorAll("input");
          saveCoords(inputs[0], inputs[1]);
        }}
        onKeyDown={(e) =>
          e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.blur()
        }
      >
        <label>
          Latitud
          <input
            type="number"
            step="any"
            min={-90}
            max={90}
            defaultValue={pin.lat}
            key={`lat-${pin.lat}`}
          />
        </label>
        <label>
          Longitud
          <input
            type="number"
            step="any"
            min={-180}
            max={180}
            defaultValue={pin.lng}
            key={`lng-${pin.lng}`}
          />
        </label>
      </div>
      {note && <p className="db-error">{note}</p>}
      <div className="db-panel-actions">
        <button type="button" onClick={onDelete}>
          Borrar pin
        </button>
        <button type="button" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}

/** The standalone map block: pins to remember places and coordinates, kept in the block itself. */
export function MapBlockView({ node, updateAttributes, deleteNode, editor }: NodeViewProps) {
  const pins = node.attrs.pins as StoredPin[];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const selected = pins.find((p) => p.id === selectedId);

  const save = (next: StoredPin[]) => updateAttributes({ pins: next });
  const add = (pin: Omit<StoredPin, "id">) => {
    if (pins.length >= MAX_ITEMS) return;
    const created = { id: crypto.randomUUID(), ...pin };
    save([...pins, created]);
    setSelectedId(created.id);
  };

  const search = async (query: string) => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const found = await geocodePlace(query);
      setResults(found);
      if (found.length === 0) setSearchError("Sin resultados");
    } catch (err) {
      setResults(null);
      setSearchError(String(err));
    } finally {
      setSearching(false);
    }
  };

  const remove = () => {
    deleteNode();
    editor.commands.focus();
  };

  const toolbar = (
    <form
      className="map-search"
      onSubmit={(e) => {
        e.preventDefault();
        void search(new FormData(e.currentTarget).get("q") as string);
      }}
    >
      <input
        className="db-input"
        type="search"
        name="q"
        maxLength={200}
        placeholder="Buscar un lugar para añadir un pin…"
        aria-label="Buscar un lugar"
      />
      <button
        type="submit"
        className="db-icon-btn"
        aria-label="Buscar"
        title="Buscar el lugar en internet"
        disabled={searching}
      >
        <Search size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {searchError && <span className="db-place-note">{searchError}</span>}
      {results && results.length > 0 && (
        <ul className="db-place-results" aria-label="Resultados de la búsqueda">
          {results.map((r) => (
            <li key={`${r.lat},${r.lng}`}>
              <button
                type="button"
                title={`${r.lat}, ${r.lng}`}
                onClick={() => {
                  setResults(null);
                  add({
                    title: r.name.split(",")[0].trim().slice(0, MAX_ITEM_TITLE),
                    lat: r.lat,
                    lng: r.lng,
                  });
                }}
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );

  return (
    <NodeViewWrapper className="db-block view-block" contentEditable={false}>
      <div className="db-header">
        <MapIcon size={14} strokeWidth={1.75} aria-hidden="true" />
        <span className="db-title view-block-title">Mapa</span>
        <span className="db-header-actions">
          {confirmRemove ? (
            <>
              <span>¿Quitar (se pierden {pins.length})?</span>
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
              onClick={() => (pins.length > 0 ? setConfirmRemove(true) : remove())}
            >
              Quitar
            </button>
          )}
        </span>
      </div>

      <MapCanvas
        pins={pins.map((p) => ({
          id: p.id,
          title: p.title || "Sin título",
          lat: p.lat,
          lng: p.lng,
        }))}
        selectedId={selectedId}
        openLabel="Editar"
        onOpen={setSelectedId}
        onAddAt={(lat, lng) => add({ title: "", lat, lng })}
        toolbar={toolbar}
      />

      {selected && (
        <PinPanel
          key={selected.id}
          pin={selected}
          onChange={(next) => save(pins.map((p) => (p.id === next.id ? next : p)))}
          onDelete={() => {
            save(pins.filter((p) => p.id !== selected.id));
            setSelectedId(null);
          }}
          onClose={() => setSelectedId(null)}
        />
      )}
    </NodeViewWrapper>
  );
}
