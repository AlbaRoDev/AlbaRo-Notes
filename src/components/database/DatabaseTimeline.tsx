import type { DatabaseRow, Property } from "../../types";
import { TimelineChart } from "../views/TimelineChart";
import { rowsToDated } from "./rows-to-dated";

interface Props {
  /** Rows after the view's filter and sort. */
  rows: DatabaseRow[];
  /** The date property the bars are laid out by (a range gives a bar; a single day a marker). */
  dateProp: Property | null;
  onOpen: (pageId: string) => void;
}

/** The timeline view of a database: its rows as bars on a time axis. */
export function DatabaseTimeline({ rows, dateProp, onOpen }: Props) {
  if (!dateProp) {
    return (
      <p className="db-loading">
        Esta vista necesita una propiedad de fecha: añade una desde «Propiedades» y elígela en
        «Fecha».
      </p>
    );
  }
  const { items, undated } = rowsToDated(rows, dateProp);
  return <TimelineChart items={items} undated={undated} onOpen={onOpen} />;
}
