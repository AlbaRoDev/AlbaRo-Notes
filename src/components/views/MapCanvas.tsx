import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Crosshair, MapPin, Minus, Plus } from "lucide-react";
import { attachmentUrl } from "../../lib/attachments";
import { fetchMapTile } from "../../lib/db-client";
import "./views.css";

const TILE = 256;
const MIN_ZOOM = 1;
const MAX_ZOOM = 18;
const HEIGHT = 380;
const MAX_LAT = 85.0511; // the Web Mercator limit

// Web Mercator: lat/lng <-> "world pixel" at a zoom (the whole world is 256·2^z pixels wide).
const worldSize = (z: number) => TILE * 2 ** z;
const toX = (lng: number, z: number) => ((lng + 180) / 360) * worldSize(z);
const toY = (lat: number, z: number) => {
  const r = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * worldSize(z);
};
const toLng = (x: number, z: number) => (x / worldSize(z)) * 360 - 180;
const wrapLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const toLat = (y: number, z: number) =>
  (Math.atan(Math.sinh(Math.PI - (2 * Math.PI * y) / worldSize(z))) * 180) / Math.PI;

interface View {
  lat: number;
  lng: number;
  z: number;
}

export interface MapPinData {
  id: string;
  title: string;
  /** Secondary text shown next to the title in the list (an address, say). */
  detail?: string;
  lat: number;
  lng: number;
}

/** Centre and zoom that show every pin (a single pin gets a street-level zoom). */
function fit(pins: MapPinData[], width: number): View {
  if (pins.length === 0) return { lat: 25, lng: 0, z: 2 };
  const lats = pins.map((p) => p.lat);
  const lngs = pins.map((p) => p.lng);
  const [south, north, west, east] = [
    Math.min(...lats),
    Math.max(...lats),
    Math.min(...lngs),
    Math.max(...lngs),
  ];
  const lat = (south + north) / 2;
  const lng = (west + east) / 2;
  if (pins.length === 1) return { lat, lng, z: 13 };
  for (let z = 16; z > MIN_ZOOM; z--) {
    if (toX(east, z) - toX(west, z) <= width - 90 && toY(south, z) - toY(north, z) <= HEIGHT - 90)
      return { lat, lng, z };
  }
  return { lat, lng, z: MIN_ZOOM };
}

/** One map tile: Rust downloads it the first time and caches it; offline it just stays blank. */
function MapTile({
  z,
  x,
  y,
  left,
  top,
}: {
  z: number;
  x: number;
  y: number;
  left: number;
  top: number;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchMapTile(z, x, y)
      .then(attachmentUrl)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setUrl(null));
    return () => {
      cancelled = true;
    };
  }, [z, x, y]);
  const style = { left, top, width: TILE, height: TILE };
  return url ? (
    <img className="map-tile" src={url} alt="" draggable={false} style={style} />
  ) : (
    <div className="map-tile map-tile-empty" style={style} />
  );
}

interface MapCanvasProps {
  pins: MapPinData[];
  /** Entries with no coordinates, listed apart. */
  unlocated?: { id: string; title: string }[];
  selectedId?: string | null;
  /** What the button of each listed place says («Abrir» a row, «Editar» a pin). */
  openLabel?: string;
  onOpen: (id: string) => void;
  /** Called with the spot clicked in «Añadir pin» mode. */
  onAddAt: (lat: number, lng: number) => void;
  /** Rendered above the map (a place search, say). */
  toolbar?: ReactNode;
}

/**
 * A map with pins, drawn with Web Mercator tiles Rust fetches and caches (the
 * frontend never reaches the network itself). Pan by dragging, zoom with the
 * buttons, «Ajustar» frames every pin. Used by the database map view and by
 * the standalone map block; it knows nothing about either.
 */
export function MapCanvas({
  pins,
  unlocated = [],
  selectedId,
  openLabel = "Abrir",
  onOpen,
  onAddAt,
  toolbar,
}: MapCanvasProps) {
  const surface = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [view, setView] = useState<View | null>(null); // null = fit to the pins
  const [addMode, setAddMode] = useState(false);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(
    null,
  );

  useEffect(() => {
    const el = surface.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(Math.round(entry.contentRect.width), 200)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const current = view ?? fit(pins, width);
  const { z } = current;
  const cx = toX(current.lng, z);
  const cy = toY(current.lat, z);
  const originX = cx - width / 2; // world pixel at the surface's top-left
  const originY = cy - HEIGHT / 2;

  const tiles: { key: string; z: number; x: number; y: number; left: number; top: number }[] = [];
  const n = 2 ** z;
  for (
    let ty = Math.max(Math.floor(originY / TILE), 0);
    ty <= Math.min(Math.floor((originY + HEIGHT) / TILE), n - 1);
    ty++
  ) {
    for (let tx = Math.floor(originX / TILE); tx <= Math.floor((originX + width) / TILE); tx++) {
      tiles.push({
        key: `${z}/${tx}/${ty}`,
        z,
        x: ((tx % n) + n) % n,
        y: ty,
        left: tx * TILE - originX,
        top: ty * TILE - originY,
      });
    }
  }

  const zoomBy = (by: number) =>
    setView({ ...current, z: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + by)) });

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".map-pin, .map-controls")) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // the pointer is already gone (or synthetic): the drag still works while it stays over the map
    }
    drag.current = { x: e.clientX, y: e.clientY, cx, cy, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const [dx, dy] = [e.clientX - d.x, e.clientY - d.y];
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.moved) setView({ z, lat: toLat(d.cy - dy, z), lng: toLng(d.cx - dx, z) });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || !addMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const [wx, wy] = [originX + e.clientX - rect.left, originY + e.clientY - rect.top];
    setAddMode(false);
    onAddAt(round6(toLat(wy, z)), round6(wrapLng(toLng(wx, z))));
  };

  return (
    <div className="map">
      {toolbar}
      <div
        ref={surface}
        className="map-surface"
        style={{ height: HEIGHT }}
        data-adding={addMode}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="application"
        aria-label="Mapa"
      >
        {tiles.map((t) => (
          <MapTile key={t.key} z={t.z} x={t.x} y={t.y} left={t.left} top={t.top} />
        ))}
        {pins.map((pin) => (
          <button
            key={pin.id}
            type="button"
            className="map-pin"
            data-selected={pin.id === selectedId}
            style={{ left: toX(pin.lng, z) - originX, top: toY(pin.lat, z) - originY }}
            title={`${pin.title}${pin.detail ? ` — ${pin.detail}` : ""}`}
            aria-label={`${openLabel} ${pin.title}`}
            onClick={() => onOpen(pin.id)}
          >
            <MapPin size={26} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ))}
        <div className="map-controls">
          <button type="button" aria-label="Acercar" onClick={() => zoomBy(1)}>
            <Plus size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Alejar" onClick={() => zoomBy(-1)}>
            <Minus size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Ajustar a los pins"
            title="Ajustar a los pins"
            onClick={() => setView(null)}
          >
            <Crosshair size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="map-add"
            aria-pressed={addMode}
            title="Pulsa y luego haz clic en el mapa para añadir un pin en ese punto"
            onClick={() => setAddMode((on) => !on)}
          >
            {addMode ? "Haz clic en el mapa…" : "+ Añadir pin"}
          </button>
        </div>
        <span className="map-attribution">© OpenStreetMap</span>
      </div>

      {pins.length > 0 && (
        <ul className="map-places" aria-label="Lugares">
          {pins.map((pin) => (
            <li key={pin.id}>
              <button
                type="button"
                className="map-place"
                title={`${pin.lat}, ${pin.lng}`}
                onClick={() => setView({ lat: pin.lat, lng: pin.lng, z: Math.max(z, 13) })}
              >
                <MapPin size={13} aria-hidden="true" /> {pin.title}
                {pin.detail && <span className="map-place-name"> · {pin.detail}</span>}
              </button>
              <button
                type="button"
                className="calendar-chip map-open"
                onClick={() => onOpen(pin.id)}
              >
                {openLabel}
              </button>
            </li>
          ))}
        </ul>
      )}

      {unlocated.length > 0 && (
        <div className="calendar-undated">
          <span className="db-panel-meta">Sin ubicación</span>
          {unlocated.map((item) => (
            <button
              key={item.id}
              type="button"
              className="calendar-chip"
              onClick={() => onOpen(item.id)}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
