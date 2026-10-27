import type { DatabaseRow, PlaceValue, Property } from "../../types";
import { MapCanvas, type MapPinData } from "../views/MapCanvas";

interface Props {
  /** Rows after the view's filter and sort. */
  rows: DatabaseRow[];
  /** The place property whose coordinates are the pins; null = the database has none. */
  placeProp: Property | null;
  onOpen: (pageId: string) => void;
  /** Creates a row whose place is this spot (the «Añadir pin» mode). */
  onAddAt: (lat: number, lng: number) => void;
}

const placeOf = (value: unknown): PlaceValue | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as PlaceValue) : null;

/** The map view of a database: a pin per row that has coordinates. */
export function DatabaseMap({ rows, placeProp, onOpen, onAddAt }: Props) {
  if (!placeProp) {
    return (
      <p className="db-loading">
        Este mapa necesita una propiedad de tipo lugar: añade una desde «Propiedades» y elígela en
        «Lugar».
      </p>
    );
  }
  const pins: MapPinData[] = [];
  const unlocated: { id: string; title: string }[] = [];
  for (const row of rows) {
    const place = placeOf(row.values[placeProp.id]);
    if (place && place.lat !== undefined && place.lng !== undefined) {
      pins.push({
        id: row.pageId,
        title: row.title,
        detail: place.name,
        lat: place.lat,
        lng: place.lng,
      });
    } else {
      unlocated.push({ id: row.pageId, title: row.title });
    }
  }
  return <MapCanvas pins={pins} unlocated={unlocated} onOpen={onOpen} onAddAt={onAddAt} />;
}
