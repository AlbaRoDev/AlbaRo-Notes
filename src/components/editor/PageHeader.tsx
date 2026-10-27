import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Smile, X } from "lucide-react";
import { setPageCover, setPageIcon } from "../../lib/db-client";
import { errorMessage, storeAttachment } from "../../lib/attachments";
import { seasonGradient } from "../../lib/palette";
import { SEASONS, type Season } from "../../lib/seasons";
import { useAttachmentUrl } from "../../hooks/useAttachmentUrl";
import type { PageSummary } from "../../types";
import { MARK_COLORS } from "./ColorMarks";
import {
  EMOJI_CATEGORIES,
  addRecentEmoji,
  getRecentEmoji,
  loadEmojiData,
  type EmojiEntry,
} from "./emoji-data";
import "./PageHeader.css";

const SEASON_LABELS: Record<Season, string> = {
  spring: "Primavera",
  summer: "Verano",
  summerSun: "Playa",
  autumn: "Otoño",
  winter: "Invierno",
  christmas: "Navidad",
  halloween: "Halloween",
  easter: "Semana Santa",
  anniversary: "Aniversario",
};

/** What a cover is made of: one of Notion's colours, a season's colours, or an uploaded image (Rust's `valid_cover`). */
function coverParts(cover: string): { kind: string; value: string } {
  const at = cover.indexOf(":");
  return { kind: cover.slice(0, at), value: cover.slice(at + 1) };
}

function PageCover({ cover }: { cover: string }) {
  const { kind, value } = coverParts(cover);
  const url = useAttachmentUrl(kind === "image" ? value : null);
  const style =
    kind === "color"
      ? { background: `var(--tag-${value})` }
      : kind === "season"
        ? { background: seasonGradient(value as Season) }
        : url
          ? { backgroundImage: `url("${url}")` }
          : undefined;
  return <div className="page-cover-art" style={style} aria-hidden="true" />;
}

/** A box that closes on Esc or a press outside it. */
function Popover({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="page-popover" role="dialog" aria-label={label}>
      {children}
    </div>
  );
}

const MAX_SHOWN = 160;

function IconPicker({
  hasIcon,
  onPick,
  onClose,
}: {
  hasIcon: boolean;
  onPick: (icon: string | null) => void;
  onClose: () => void;
}) {
  const [emoji, setEmoji] = useState<EmojiEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [recent] = useState(getRecentEmoji);
  useEffect(() => {
    let cancelled = false;
    void loadEmojiData().then((all) => !cancelled && setEmoji(all));
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = useMemo(() => {
    if (!emoji) return [];
    const needle = query.trim().toLowerCase();
    if (!needle)
      return emoji
        .filter(
          (e) =>
            e.group === EMOJI_CATEGORIES[0].group ||
            e.group === 3 ||
            e.group === 4 ||
            e.group === 6 ||
            e.group === 5,
        )
        .slice(0, MAX_SHOWN);
    return emoji
      .filter(
        (e) =>
          e.label.toLowerCase().includes(needle) ||
          e.tags.some((t) => t.toLowerCase().includes(needle)),
      )
      .slice(0, MAX_SHOWN);
  }, [emoji, query]);

  const choose = (char: string) => {
    addRecentEmoji(char);
    onPick(char);
  };

  return (
    <Popover label="Elegir un icono" onClose={onClose}>
      <input
        autoFocus
        type="search"
        placeholder="Busca un emoji…"
        aria-label="Buscar un emoji"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!query && recent.length > 0 && (
        <div className="page-popover-section">
          <span>Recientes</span>
          <div className="page-emoji-grid">
            {recent.slice(0, 16).map((char) => (
              <button key={char} type="button" onClick={() => choose(char)} aria-label={char}>
                {char}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="page-emoji-grid" role="listbox" aria-label="Emojis">
        {!emoji && <p className="page-popover-note">Cargando…</p>}
        {emoji && shown.length === 0 && <p className="page-popover-note">Ningún emoji coincide.</p>}
        {shown.map((e) => (
          <button
            key={e.hexcode}
            type="button"
            title={e.label}
            aria-label={e.label}
            onClick={() => choose(e.char)}
          >
            {e.char}
          </button>
        ))}
      </div>
      {hasIcon && (
        <button type="button" className="page-popover-remove" onClick={() => onPick(null)}>
          Quitar el icono
        </button>
      )}
    </Popover>
  );
}

function CoverPicker({
  hasCover,
  onPick,
  onClose,
}: {
  hasCover: boolean;
  onPick: (cover: string | null) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Elige un archivo de imagen");
    setBusy(true);
    try {
      const info = await storeAttachment(file);
      onPick(`image:${info.file}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Popover label="Elegir una portada" onClose={onClose}>
      <div className="page-popover-section">
        <span>Colores</span>
        <div className="page-cover-swatches">
          {MARK_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              style={{ background: `var(--tag-${color})` }}
              aria-label={`Portada de color ${color}`}
              onClick={() => onPick(`color:${color}`)}
            />
          ))}
        </div>
      </div>
      <div className="page-popover-section">
        <span>Estaciones</span>
        <div className="page-cover-swatches page-cover-seasons">
          {SEASONS.map((season) => (
            <button
              key={season}
              type="button"
              style={{ background: seasonGradient(season) }}
              title={SEASON_LABELS[season]}
              aria-label={`Portada de ${SEASON_LABELS[season]}`}
              onClick={() => onPick(`season:${season}`)}
            />
          ))}
        </div>
      </div>
      <label className="page-popover-upload">
        <ImagePlus size={14} aria-hidden="true" /> {busy ? "Subiendo…" : "Subir una imagen"}
        <input
          type="file"
          accept="image/*"
          hidden
          disabled={busy}
          onChange={(e) => void upload(e.target.files?.[0])}
        />
      </label>
      {error && (
        <p className="page-popover-note" role="alert">
          {error}
        </p>
      )}
      {hasCover && (
        <button type="button" className="page-popover-remove" onClick={() => onPick(null)}>
          Quitar la portada
        </button>
      )}
    </Popover>
  );
}

/**
 * The top of a page, like Notion's: an optional cover, an optional icon (an emoji) and, while the pointer is
 * over it, the buttons to add or change them. Rust validates both; the sidebar shows the icon.
 */
export function PageHeader({ page, onChanged }: { page: PageSummary; onChanged: () => void }) {
  const [open, setOpen] = useState<"icon" | "cover" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = () => setOpen(null);

  const save = (write: Promise<void>) => {
    write
      .then(() => {
        setError(null);
        setOpen(null);
        onChanged();
      })
      .catch((e) => setError(errorMessage(e)));
  };

  return (
    <div className="page-header" data-has-cover={page.cover ? "" : undefined}>
      {page.cover && (
        <div className="page-cover">
          <PageCover cover={page.cover} />
          <div className="page-cover-actions">
            <button type="button" onClick={() => setOpen(open === "cover" ? null : "cover")}>
              Cambiar portada
            </button>
            <button
              type="button"
              aria-label="Quitar la portada"
              onClick={() => save(setPageCover(page.id, null))}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      <div className="page-header-row">
        {page.icon && (
          <button
            type="button"
            className="page-icon"
            aria-label="Cambiar el icono"
            onClick={() => setOpen(open === "icon" ? null : "icon")}
          >
            {page.icon}
          </button>
        )}
        <div className="page-header-add">
          {!page.icon && (
            <button type="button" onClick={() => setOpen(open === "icon" ? null : "icon")}>
              <Smile size={14} aria-hidden="true" /> Añadir icono
            </button>
          )}
          {!page.cover && (
            <button type="button" onClick={() => setOpen(open === "cover" ? null : "cover")}>
              <ImagePlus size={14} aria-hidden="true" /> Añadir portada
            </button>
          )}
        </div>
      </div>
      {open === "icon" && (
        <IconPicker
          hasIcon={!!page.icon}
          onClose={close}
          onPick={(icon) => save(setPageIcon(page.id, icon))}
        />
      )}
      {open === "cover" && (
        <CoverPicker
          hasCover={!!page.cover}
          onClose={close}
          onPick={(cover) => save(setPageCover(page.id, cover))}
        />
      )}
      {error && (
        <p className="page-popover-note" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
