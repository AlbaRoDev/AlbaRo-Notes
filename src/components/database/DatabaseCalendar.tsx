import type { DatabaseRow, Property } from "../../types";
import { CalendarGrid } from "../views/CalendarGrid";
import { rowsToDated } from "./rows-to-dated";

interface Props {
  /** Rows after the view's filter and sort. */
  rows: DatabaseRow[];
  /** The date property the calendar is laid out by; null = the database has none. */
  dateProp: Property | null;
  onOpen: (pageId: string) => void;
  /** Creates a row dated on that day. */
  onAddOn: (iso: string) => void;
}

/** The calendar view of a database: its rows laid out by a date property. */
export function DatabaseCalendar({ rows, dateProp, onOpen, onAddOn }: Props) {
  if (!dateProp) {
    return (
      <p className="db-loading">
        Esta vista necesita una propiedad de fecha: añade una desde «Propiedades» y elígela en
        «Fecha».
      </p>
    );
  }
  const { items, undated } = rowsToDated(rows, dateProp);
  return <CalendarGrid items={items} undated={undated} onOpen={onOpen} onAddOn={onAddOn} />;
}
