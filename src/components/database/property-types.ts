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
import { t } from "../../lib/i18n.ts";

export const TYPE_LABELS: Record<PropertyKind, string> = {
  text: t("Texto"),
  number: t("Número"),
  date: t("Fecha"),
  select: t("Seleccionar"),
  relation: t("Relación"),
  place: t("Lugar"),
  checkbox: t("Casilla"),
  tags: t("Selección múltiple"),
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
  { group: "todo", label: t("Por hacer") },
  { group: "doing", label: t("En curso") },
  { group: "done", label: t("Completado") },
];

export const TYPE_CHOICES: TypeChoice[] = [
  { id: "text", label: t("Texto"), icon: TYPE_ICONS.text, kind: "text" },
  { id: "number", label: t("Número"), icon: TYPE_ICONS.number, kind: "number" },
  { id: "select", label: t("Seleccionar"), icon: TYPE_ICONS.select, kind: "select" },
  { id: "tags", label: t("Selección múltiple"), icon: TYPE_ICONS.tags, kind: "tags" },
  {
    id: "status",
    label: t("Estado"),
    icon: LoaderCircle,
    kind: "select",
    status: true,
  },
  { id: "date", label: t("Fecha"), icon: TYPE_ICONS.date, kind: "date" },
  { id: "checkbox", label: t("Casilla"), icon: TYPE_ICONS.checkbox, kind: "checkbox" },
  { id: "url", label: "URL", icon: Link, kind: "text", format: "url" },
  { id: "email", label: t("Correo electrónico"), icon: AtSign, kind: "text", format: "email" },
  { id: "phone", label: t("Teléfono"), icon: Phone, kind: "text", format: "phone" },
  { id: "relation", label: t("Relación"), icon: TYPE_ICONS.relation, kind: "relation" },
  { id: "place", label: t("Lugar"), icon: TYPE_ICONS.place, kind: "place" },
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
  { color: "default", label: t("Predeterminado") },
  { color: "gray", label: t("Gris") },
  { color: "brown", label: t("Marrón") },
  { color: "orange", label: t("Naranja") },
  { color: "yellow", label: t("Amarillo") },
  { color: "green", label: t("Verde") },
  { color: "blue", label: t("Azul") },
  { color: "purple", label: t("Morado") },
  { color: "pink", label: t("Rosa") },
  { color: "red", label: t("Rojo") },
];

/** An option's colour: the one chosen for it, else one picked by its position (as Notion does for new options). */
export function optionColor(prop: Property, option: string): TagColor | undefined {
  const index = (prop.config.options ?? []).indexOf(option);
  if (index < 0) return undefined;
  return prop.config.colors?.[option] ?? TAG_COLORS[1 + (index % 9)].color;
}
