import type { CellValue, DatabaseRow, PlaceValue, Property } from "../../types";
import { useRef, useState, type FocusEvent } from "react";
import { ExternalLink, Search, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { geocodePlace, type GeocodeResult } from "../../lib/db-client";
import { commitOnBlur, type Commit } from "./cell-commit";
import { OptionCell } from "./OptionCell";

interface CellProps {
  prop: Property;
  value: CellValue | undefined;
  commit: Commit;
  /** Rows of the relation's target database (relation cells only). */
  targetRows: DatabaseRow[];
  /** Dates only: a single day, no range (a filter compares against one day). */
  single?: boolean;
  /** Table column set to «Ajustar contenido»: text wraps onto several lines. */
  wrap?: boolean;
}

/**
 * A place cell, like Notion's: a label/address plus map coordinates. The label
 * can be searched online (Rust makes the request); the coordinates can also be
 * typed, which is all an offline note needs. Saved when focus leaves the cell.
 */
function PlaceCell({
  prop,
  value,
  commit,
}: {
  prop: Property;
  value: CellValue | undefined;
  commit: Commit;
}) {
  const place: PlaceValue =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const nameRef = useRef<HTMLInputElement>(null);
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const revert = () => {
    if (nameRef.current) nameRef.current.value = place.name ?? "";
    if (latRef.current) latRef.current.value = place.lat === undefined ? "" : String(place.lat);
    if (lngRef.current) lngRef.current.value = place.lng === undefined ? "" : String(place.lng);
  };

  const onBlur = async (e: FocusEvent<HTMLDivElement>) => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return; // still inside the cell
    const [name, lat, lng] = [nameRef.current, latRef.current, lngRef.current];
    if (!name || !lat || !lng || lat.validity.badInput || lng.validity.badInput) return revert();
    const next: PlaceValue = {};
    if (name.value.trim()) next.name = name.value.trim();
    // a lone coordinate goes to Rust as it is: it refuses it and the cell reverts with the reason
    if (lat.value !== "") next.lat = Number(lat.value);
    if (lng.value !== "") next.lng = Number(lng.value);
    if (JSON.stringify(next) === JSON.stringify(place)) return;
    if (!(await commit(Object.keys(next).length ? next : null))) revert();
  };

  const search = async () => {
    const query = nameRef.current?.value.trim();
    if (!query) return;
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

  const pick = async (r: GeocodeResult) => {
    setResults(null);
    await commit({ name: r.name, lat: r.lat, lng: r.lng });
  };

  return (
    <div
      className="db-place"
      onBlur={(e) => void onBlur(e)}
      onKeyDown={(e) =>
        e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.blur()
      }
    >
      <div className="db-place-name">
        <input
          ref={nameRef}
          className="db-input"
          type="text"
          maxLength={200}
          defaultValue={place.name ?? ""}
          placeholder="Lugar o dirección"
          aria-label={prop.name}
        />
        <button
          type="button"
          className="db-icon-btn"
          aria-label={`Buscar ${prop.name}`}
          title="Buscar el lugar en internet"
          disabled={searching}
          onClick={() => void search()}
        >
          <Search size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <div className="db-place-coords">
        <input
          ref={latRef}
          className="db-input"
          type="number"
          step="any"
          min={-90}
          max={90}
          defaultValue={place.lat ?? ""}
          placeholder="lat"
          aria-label={`${prop.name} (latitud)`}
        />
        <input
          ref={lngRef}
          className="db-input"
          type="number"
          step="any"
          min={-180}
          max={180}
          defaultValue={place.lng ?? ""}
          placeholder="lng"
          aria-label={`${prop.name} (longitud)`}
        />
      </div>
      {searchError && <span className="db-place-note">{searchError}</span>}
      {results && results.length > 0 && (
        <ul className="db-place-results" aria-label="Resultados de la búsqueda">
          {results.map((r) => (
            <li key={`${r.lat},${r.lng}`}>
              <button type="button" onClick={() => void pick(r)} title={`${r.lat}, ${r.lng}`}>
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A date cell: a start day and, as in Notion, an optional end day (a range).
 * Both are native date inputs; nothing is saved while focus moves between
 * them — only when it leaves the cell — and a half-typed date saves nothing.
 */
function DateCell({
  prop,
  value,
  commit,
}: {
  prop: Property;
  value: CellValue | undefined;
  commit: Commit;
}) {
  const current = typeof value === "string" ? value : "";
  const [start, end] = current.split("/");
  const [withEnd, setWithEnd] = useState(Boolean(end));
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  const revert = () => {
    if (startRef.current) startRef.current.value = start ?? "";
    if (endRef.current) endRef.current.value = end ?? "";
    setWithEnd(Boolean(end));
  };

  const onBlur = async (e: FocusEvent<HTMLDivElement>) => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return; // still inside the cell
    const s = startRef.current;
    const en = endRef.current;
    if (!s || s.validity.badInput || en?.validity.badInput) return revert();
    if (!s.value && en?.value) return revert(); // an end without a start means nothing
    const next = s.value ? (en?.value ? `${s.value}/${en.value}` : s.value) : "";
    if (next === current) return;
    if (!(await commit(next || null))) revert();
  };

  return (
    <div
      className="db-date"
      data-empty={!current}
      onBlur={(e) => void onBlur(e)}
      onKeyDown={(e) =>
        e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.blur()
      }
    >
      <input
        ref={startRef}
        className="db-input"
        type="date"
        defaultValue={start ?? ""}
        aria-label={prop.name}
      />
      {withEnd ? (
        <>
          <span aria-hidden="true">→</span>
          <input
            ref={endRef}
            className="db-input"
            type="date"
            defaultValue={end ?? ""}
            aria-label={`${prop.name} (fin)`}
          />
          <button
            type="button"
            className="db-icon-btn"
            aria-label={`Quitar fecha de fin de ${prop.name}`}
            onClick={() => {
              setWithEnd(false);
              if (end) void commit(start || null); // drops the end right away
            }}
          >
            <X size={12} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </>
      ) : (
        <button
          type="button"
          className="db-icon-btn db-date-add-end"
          aria-label={`Añadir fecha de fin a ${prop.name}`}
          title="Añadir fecha de fin"
          onClick={() => {
            setWithEnd(true);
            requestAnimationFrame(() => endRef.current?.focus());
          }}
        >
          →
        </button>
      )}
    </div>
  );
}

/** What the opener gets for a url / email / phone cell (Rust already checked its shape when it was saved). */
function linkOf(format: "url" | "email" | "phone", text: string): string {
  if (format === "email") return `mailto:${text}`;
  if (format === "phone") return `tel:${text.replace(/[^\d+]/g, "")}`;
  return text;
}

export function Cell({ prop, value, commit, targetRows, single, wrap }: CellProps) {
  switch (prop.type) {
    case "text": {
      const current = typeof value === "string" ? value : "";
      const format = prop.config.format;
      if (format) {
        return (
          <div className="db-link-cell">
            <input
              className="db-input"
              type="text"
              inputMode={format === "phone" ? "tel" : format === "email" ? "email" : "url"}
              maxLength={2000}
              defaultValue={current}
              aria-label={prop.name}
              {...commitOnBlur(current, commit, (raw) => raw || null)}
            />
            {current && (
              <button
                type="button"
                className="db-icon-btn"
                aria-label={`Abrir ${prop.name}`}
                title="Abrir"
                onClick={() =>
                  void openUrl(linkOf(format, current)).catch((e) => console.error("openUrl", e))
                }
              >
                <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}
          </div>
        );
      }
      if (wrap) {
        // «Ajustar contenido»: the text grows onto as many lines as it needs
        return (
          <textarea
            className="db-input db-wrap"
            rows={1}
            maxLength={2000}
            defaultValue={current}
            aria-label={prop.name}
            {...commitOnBlur(current, commit, (raw) => raw || null)}
          />
        );
      }
      return (
        <input
          className="db-input"
          type="text"
          maxLength={2000}
          defaultValue={current}
          aria-label={prop.name}
          {...commitOnBlur(current, commit, (raw) => raw || null)}
        />
      );
    }
    case "number": {
      const current = typeof value === "number" ? String(value) : "";
      return (
        <input
          className="db-input"
          type="number"
          step="any"
          defaultValue={current}
          aria-label={prop.name}
          {...commitOnBlur(current, commit, (raw) => (raw === "" ? null : Number(raw)))}
        />
      );
    }
    case "date": {
      if (!single) return <DateCell prop={prop} value={value} commit={commit} />;
      const current = typeof value === "string" ? value : "";
      return (
        <input
          className="db-input"
          type="date"
          defaultValue={current}
          aria-label={prop.name}
          {...commitOnBlur(current, commit, (raw) => raw || null)}
        />
      );
    }
    case "place":
      return <PlaceCell prop={prop} value={value} commit={commit} />;
    case "checkbox":
      return (
        <input
          className="db-input db-checkbox"
          type="checkbox"
          checked={value === true}
          aria-label={prop.name}
          onChange={(e) => void commit(e.target.checked)}
        />
      );
    case "select":
    case "tags":
      return <OptionCell prop={prop} value={value} commit={commit} />;
    case "relation": {
      const linked = Array.isArray(value) ? value : [];
      const titleOf = (id: string) => targetRows.find((r) => r.pageId === id)?.title ?? "…";
      return (
        <div className="db-relation">
          {linked.map((id) => (
            <span key={id} className="db-chip">
              {titleOf(id)}
              <button
                type="button"
                aria-label={`Quitar ${titleOf(id)}`}
                onClick={() => void commit(linked.filter((l) => l !== id))}
              >
                ×
              </button>
            </span>
          ))}
          <select
            className="db-input db-relation-add"
            value=""
            aria-label={`Añadir a ${prop.name}`}
            onChange={(e) => e.target.value && void commit([...linked, e.target.value])}
          >
            <option value="">+</option>
            {targetRows
              .filter((r) => !linked.includes(r.pageId))
              .map((r) => (
                <option key={r.pageId} value={r.pageId}>
                  {r.title}
                </option>
              ))}
          </select>
        </div>
      );
    }
  }
}
