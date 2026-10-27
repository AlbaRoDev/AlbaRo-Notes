import {
  AlignLeft,
  ArrowUpRight,
  AtSign,
  Calendar,
  CircleChevronDown,
  Hash,
  Link,
  List,
  LoaderCircle,
  MapPin,
  Phone,
  SquareCheck,
  type LucideIcon,
} from "lucide-react";
import type { Property, PropertyKind, StatusGroup, TagColor, TextFormat } from "../../types";

export const TYPE_LABELS: Record<PropertyKind, string> = {
  text: "Texto",
  number: "Número",
  date: "Fecha",
  select: "Seleccionar",
  relation: "Relación",
  place: "Lugar",
  checkbox: "Casilla",
  tags: "Selección múltiple",
};

/** The icon Notion-style column headers show before each property's name. */
export const TYPE_ICONS: Record<PropertyKind, LucideIcon> = {
  text: AlignLeft,
  number: Hash,
  date: Calendar,
  select: CircleChevronDown,
  relation: ArrowUpRight,
  place: MapPin,
  checkbox: SquareCheck,
  tags: List,
};

/**
 * What the «tipo» menu offers, in Notion's order. A choice is a stored kind plus, for some, a bit of
 * config: «URL», «Correo» and «Teléfono» are text with a format, and «Estado» is a select that starts
 * with Notion's three states (it stays a select afterwards, so it filters, groups and fills a board as one).
 */
export interface TypeChoice {
  id: string;
  label: string;
  icon: LucideIcon;
  kind: PropertyKind;
  format?: TextFormat;
  /** A select whose options belong to groups (Rust seeds «Sin empezar / En curso / Listo»). */
  status?: boolean;
}

export const STATUS_GROUPS: { group: StatusGroup; label: string }[] = [
  { group: "todo", label: "Por hacer" },
  { group: "doing", label: "En curso" },
  { group: "done", label: "Completado" },
];

export const TYPE_CHOICES: TypeChoice[] = [
  { id: "text", label: "Texto", icon: TYPE_ICONS.text, kind: "text" },
  { id: "number", label: "Número", icon: TYPE_ICONS.number, kind: "number" },
  { id: "select", label: "Seleccionar", icon: TYPE_ICONS.select, kind: "select" },
  { id: "tags", label: "Selección múltiple", icon: TYPE_ICONS.tags, kind: "tags" },
  {
    id: "status",
    label: "Estado",
    icon: LoaderCircle,
    kind: "select",
    status: true,
  },
  { id: "date", label: "Fecha", icon: TYPE_ICONS.date, kind: "date" },
  { id: "checkbox", label: "Casilla", icon: TYPE_ICONS.checkbox, kind: "checkbox" },
  { id: "url", label: "URL", icon: Link, kind: "text", format: "url" },
  { id: "email", label: "Correo electrónico", icon: AtSign, kind: "text", format: "email" },
  { id: "phone", label: "Teléfono", icon: Phone, kind: "text", format: "phone" },
  { id: "relation", label: "Relación", icon: TYPE_ICONS.relation, kind: "relation" },
  { id: "place", label: "Lugar", icon: TYPE_ICONS.place, kind: "place" },
];

/** The choice a stored property is: «Estado» is a select with `config.status`. */
export function typeChoiceOf(prop: Pick<Property, "type" | "config">): TypeChoice {
  const format = prop.type === "text" ? prop.config.format : undefined;
  const status = prop.type === "select" && prop.config.status === true;
  return (
    TYPE_CHOICES.find(
      (c) => c.kind === prop.type && c.format === format && (c.status ?? false) === status,
    ) ?? TYPE_CHOICES[0]
  );
}

/** Notion's tag colours, in its menu order (CSS: `--tag-<colour>`). */
export const TAG_COLORS: { color: TagColor; label: string }[] = [
  { color: "default", label: "Predeterminado" },
  { color: "gray", label: "Gris" },
  { color: "brown", label: "Marrón" },
  { color: "orange", label: "Naranja" },
  { color: "yellow", label: "Amarillo" },
  { color: "green", label: "Verde" },
  { color: "blue", label: "Azul" },
  { color: "purple", label: "Morado" },
  { color: "pink", label: "Rosa" },
  { color: "red", label: "Rojo" },
];

/** An option's colour: the one chosen for it, else one picked by its position (as Notion does for new options). */
export function optionColor(prop: Property, option: string): TagColor | undefined {
  const index = (prop.config.options ?? []).indexOf(option);
  if (index < 0) return undefined;
  return prop.config.colors?.[option] ?? TAG_COLORS[1 + (index % 9)].color;
}
