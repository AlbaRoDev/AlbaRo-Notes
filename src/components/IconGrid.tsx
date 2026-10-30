import { useMemo, useState } from "react";
import {
  ICON_COLORS,
  formatIcon,
  parseIcon,
  searchIcons,
  useIconLibrary,
} from "../lib/icon-library";
import "./IconGrid.css";

const PAGE = 240;

const COLOR_LABELS: Record<string, string> = {
  gray: "Gris",
  brown: "Marrón",
  orange: "Naranja",
  yellow: "Amarillo",
  green: "Verde",
  blue: "Azul",
  purple: "Morado",
  pink: "Rosa",
  red: "Rojo",
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
        placeholder="Busca un icono… (casa, corazón, rocket)"
        aria-label="Buscar un icono"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(PAGE);
        }}
      />
      {withColor && (
        <div className="icon-colors" role="group" aria-label="Color del icono">
          {[null, ...ICON_COLORS].map((c) => (
            <button
              key={c ?? "none"}
              type="button"
              className="icon-color"
              data-color={c ?? "none"}
              aria-label={c ? COLOR_LABELS[c] : "Sin color"}
              aria-pressed={color === c}
              title={c ? COLOR_LABELS[c] : "Sin color"}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      )}
      {!lib && <p className="icon-grid-note">Cargando…</p>}
      {lib && found.length === 0 && <p className="icon-grid-note">Ningún icono coincide.</p>}
      <div className="icon-grid" role="listbox" aria-label="Iconos">
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
          Ver más ({found.length - limit})
        </button>
      )}
    </div>
  );
}
