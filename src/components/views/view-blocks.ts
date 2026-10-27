import { Node, mergeAttributes, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import type { ReactElement } from "react";
import { CalendarBlockView, TimelineBlockView } from "./EventsBlockView";
import { CHART_TYPE_LABELS } from "../database/view-config";
import { ChartBlockView } from "./ChartBlockView";
import { MapBlockView } from "./MapBlockView";
import { sanitizeEntries, sanitizeEvents, sanitizePins } from "./view-items";

function parseList(raw: string | null): unknown {
  try {
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * A block that is its own thing: it keeps its entries in an attribute of the
 * node, so it needs no database, no table and nothing to clean up — delete the
 * block and the data goes with it. (A general calendar / task system is a
 * later feature; these are single-purpose views.)
 */
function createItemsBlock(options: {
  name: string;
  tag: string;
  attr: "events" | "pins" | "entries";
  sanitize: (raw: unknown) => unknown[];
  view: (props: NodeViewProps) => ReactElement;
  /** Further attributes of the node besides its list. */
  extraAttributes?: Record<string, unknown>;
}) {
  const { name, tag, attr, sanitize, view, extraAttributes } = options;
  return Node.create({
    name,
    group: "block",
    atom: true,
    addAttributes() {
      return {
        ...(extraAttributes ?? {}),
        [attr]: {
          default: [],
          // pasted HTML / old documents: keep what is valid, since Rust refuses a page with a bad entry
          parseHTML: (el: HTMLElement) => sanitize(parseList(el.getAttribute(`data-${attr}`))),
          renderHTML: (attrs: Record<string, unknown>) => ({
            [`data-${attr}`]: JSON.stringify(attrs[attr] ?? []),
          }),
        },
      };
    },
    parseHTML() {
      return [{ tag: `div[data-type="${tag}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-type": tag })];
    },
    addNodeView() {
      return ReactNodeViewRenderer(view);
    },
  });
}

/** «Vista de calendario»: a month/week calendar with its own events. */
export const CalendarBlock = createItemsBlock({
  name: "calendarView",
  tag: "calendar-view",
  attr: "events",
  sanitize: sanitizeEvents,
  view: CalendarBlockView,
});

/** «Vista de cronograma»: bars on a time axis, with its own items. */
export const TimelineBlock = createItemsBlock({
  name: "timelineView",
  tag: "timeline-view",
  attr: "events",
  sanitize: sanitizeEvents,
  view: TimelineBlockView,
});

/** «Vista de mapa»: a map with its own pins. */
export const MapBlock = createItemsBlock({
  name: "mapView",
  tag: "map-view",
  attr: "pins",
  sanitize: sanitizePins,
  view: MapBlockView,
});

/** «Vista de gráfico»: a chart (bars, line, ring or number) drawn from its own entries. */
export const ChartBlock = createItemsBlock({
  name: "chartView",
  tag: "chart-view",
  attr: "entries",
  sanitize: sanitizeEntries,
  view: ChartBlockView,
  extraAttributes: {
    chartType: {
      default: "bar",
      // pasted HTML: anything that is not one of the five types falls back to bars
      parseHTML: (el: HTMLElement) => {
        const raw = el.getAttribute("data-chart-type") ?? "";
        return raw in CHART_TYPE_LABELS ? raw : "bar";
      },
      renderHTML: (attrs: Record<string, unknown>) => ({
        "data-chart-type": String(attrs.chartType ?? "bar"),
      }),
    },
  },
});
