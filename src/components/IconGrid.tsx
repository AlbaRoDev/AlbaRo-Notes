import { useMemo, useState } from "react";
import {
  ICON_COLORS,
  formatIcon,
  parseIcon,
  searchIcons,
  useIconLibrary,
} from "../lib/icon-library";
import "./IconGrid.css";
import { t } from "../lib/i18n.ts";

const PAGE = 240;

const COLOR_LABELS: Record<string, string> = {
  gray: t("Gris"),
  brown: t("Marrón"),
  orange: t("Naranja"),
  yellow: t("Amarillo"),
  green: t("Verde"),
  blue: t("Azul"),
  purple: t("Morado"),
  pink: t("Rosa"),
  red: t("Rojo"),
};

/**
 * Notion's icon library: every icon of the set, found by typing (in English or Spanish), in the colour picked above
 * the grid when `withColor`. `onPick` gets the string to save (`lucide:Name` or `lucide:Name:colour`).
 */
export function IconGrid({
  current,
  withColor,
  onPick,
}: {
  current?: string | null;
  withColor: boolean;
  onPick: (icon: string) => void;
}) {
  const lib = useIconLibrary();
  const [query, setQuery] = useState("");
  const [color, setColor] = useState<string | null>(() => {
    const parsed = current ? parseIcon(current, true) : null;
    return parsed?.kind === "lucide" ? parsed.color : null;
  });
  const [limit, setLimit] = useState(PAGE);
  const names = useMemo(() => (lib ? Object.keys(lib).sort() : []), [lib]);
  const found = useMemo(() => searchIcons(names, query), [names, query]);
  const selected = current ? parseIcon(current, true) : null;

  return (
    <div className="icon-grid-box">
      <input
        autoFocus
        type="search"
        placeholder={t("Busca un icono… (casa, corazón, rocket)")}
        aria-label={t("Buscar un icono")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(PAGE);
        }}
      />
      {withColor && (
        <div className="icon-colors" role="group" aria-label={t("Color del icono")}>
          {[null, ...ICON_COLORS].map((c) => (
            <button
              key={c ?? "none"}
              type="button"
              className="icon-color"
              data-color={c ?? "none"}
              aria-label={c ? COLOR_LABELS[c] : t("Sin color")}
              aria-pressed={color === c}
              title={c ? COLOR_LABELS[c] : t("Sin color")}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      )}
      {!lib && <p className="icon-grid-note">{t("Cargando…")}</p>}
      {lib && found.length === 0 && <p className="icon-grid-note">{t("Ningún icono coincide.")}</p>}
      <div className="icon-grid" role="listbox" aria-label={t("Iconos")}>
        {found.slice(0, limit).map((name) => {
          const Icon = lib![name];
          return (
            <button
              key={name}
              type="button"
              role="option"
              aria-selected={selected?.kind === "lucide" && selected.name === name}
              aria-label={name}
              title={name}
              onClick={() => onPick(formatIcon(name, withColor ? color : null))}
            >
              <Icon
                size={18}
                strokeWidth={1.75}
                style={color && withColor ? { color: `var(--text-${color})` } : undefined}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
      {found.length > limit && (
        <button type="button" className="icon-grid-more" onClick={() => setLimit((l) => l + PAGE)}>
          {t("Ver más ({count})", { count: found.length - limit })}
        </button>
      )}
    </div>
  );
}
