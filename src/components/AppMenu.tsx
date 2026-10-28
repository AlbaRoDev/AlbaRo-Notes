import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronRight, ExternalLink, RefreshCw, Search, Info, PanelLeft, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import appIcon from "../../src-tauri/icons/128x128.png";
import { requestUpdateCheck } from "../lib/app-update";
import type { PaletteCommand } from "./search/SearchModal";
import "./app-menu.css";

const REPOSITORY = "https://github.com/AlbaRoDev/AlbaRo-Notes";
const RELEASES = `${REPOSITORY}/releases`;

interface Entry {
  label: string;
  icon: LucideIcon;
  hint?: string;
  run: () => void;
}
type Item = Entry | "separator";

/**
 * The app's menu, behind the app's own icon in the corner of every screen (the start screen and the
 * workspace): what a desktop app has in its menu bar. Most entries are the palette's commands, looked up by
 * id, so a command added or renamed there shows up here; the rest are this menu's own (sidebar, updates, about).
 */
export function AppMenu({
  commands,
  hasSidebar,
  version,
  dbSchema,
  onSearch,
}: {
  commands: PaletteCommand[];
  /** The start screen has no sidebar to toggle. */
  hasSidebar: boolean;
  version: string | null;
  dbSchema: number | null;
  onSearch: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [about, setAbout] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setActive(null);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const byId = (id: string): Entry[] => {
    const c = commands.find((x) => x.id === id);
    return c ? [{ label: c.label, icon: c.icon, hint: c.hint, run: c.run }] : [];
  };
  const link = (label: string, url: string): Entry => ({
    label,
    icon: ExternalLink,
    run: () => void openUrl(url).catch((e) => console.error("openUrl", e)),
  });
  const sidebarToggle: Entry[] = hasSidebar
    ? [
        {
          label: "Mostrar u ocultar la barra lateral",
          icon: PanelLeft,
          hint: "Ctrl+\\",
          // the sidebar listens for its own shortcut: this is the same key
          run: () =>
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "\\", ctrlKey: true })),
        },
      ]
    : [];

  const menus: { id: string; label: string; items: Item[] }[] = [
    {
      id: "file",
      label: "Archivo",
      items: ["new-page", "new-database", "import-files", "import-folder"].flatMap(byId),
    },
    {
      id: "view",
      label: "Ver",
      items: [
        ...sidebarToggle,
        ...(hasSidebar ? (["separator"] as const) : []),
        ...["theme-light", "theme-dark", "theme-system"].flatMap(byId),
        "separator",
        ...["style-themed", "style-sober"].flatMap(byId),
        "separator",
        ...["cursor-minimal", "cursor-system"].flatMap(byId),
      ],
    },
    {
      id: "go",
      label: "Ir",
      items: [
        ...["go-home", "go-notes", "go-manager"].flatMap(byId),
        "separator",
        { label: "Buscar", icon: Search, hint: "Ctrl+K", run: onSearch },
        ...byId("ask-ai"),
      ],
    },
    {
      id: "help",
      label: "Ayuda",
      items: [
        { label: "Buscar actualizaciones…", icon: RefreshCw, run: requestUpdateCheck },
        { label: "Acerca de AlbaRo Notes", icon: Info, run: () => setAbout(true) },
        "separator",
        link("Repositorio en GitHub", REPOSITORY),
        link("Versiones publicadas", RELEASES),
      ],
    },
  ];
  const current = menus.find((m) => m.id === active);

  const choose = (entry: Entry) => {
    close();
    entry.run();
  };

  return (
    <div className="app-menu" ref={rootRef}>
      <button
        type="button"
        className="app-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menú de AlbaRo Notes"
        title="Menú de AlbaRo Notes"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <img src={appIcon} alt="" className="app-menu-icon" />
      </button>
      {open && (
        <div className="app-menu-pop" role="menu" aria-label="Menú de AlbaRo Notes">
          <div className="app-menu-categories">
            {menus.map((m) => (
              <button
                key={m.id}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={active === m.id}
                data-active={active === m.id || undefined}
                onMouseEnter={() => setActive(m.id)}
                onClick={() => setActive(m.id)}
              >
                {m.label}
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            ))}
          </div>
          {current && (
            <div className="app-menu-items" role="menu" aria-label={current.label}>
              {current.items.map((item, i) =>
                item === "separator" ? (
                  <hr key={`sep-${i}`} />
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    onClick={() => choose(item)}
                  >
                    <item.icon size={15} strokeWidth={1.75} aria-hidden="true" />
                    <span>{item.label}</span>
                    {item.hint && <kbd>{item.hint}</kbd>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      )}
      {about && <About version={version} dbSchema={dbSchema} onClose={() => setAbout(false)} />}
    </div>
  );
}

/** «Acerca de»: the version, the database schema and where to read more. */
function About({
  version,
  dbSchema,
  onClose,
}: {
  version: string | null;
  dbSchema: number | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="about-backdrop" onMouseDown={onClose}>
      <div
        className="about"
        role="dialog"
        aria-modal="true"
        aria-label="Acerca de AlbaRo Notes"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button type="button" className="about-close" aria-label="Cerrar" onClick={onClose}>
          <X size={14} />
        </button>
        <img src={appIcon} alt="" className="about-icon" />
        <h2>AlbaRo Notes</h2>
        <p>{version ? `Versión ${version}` : "Versión desconocida"}</p>
        {dbSchema !== null && <p className="about-faint">Base de datos: esquema v{dbSchema}</p>}
        <p className="about-faint">
          Código abierto, licencia MIT. Tus notas se quedan en este equipo.
        </p>
        <div className="about-actions">
          <button
            type="button"
            onClick={() => {
              onClose();
              requestUpdateCheck();
            }}
          >
            <RefreshCw size={14} aria-hidden="true" /> Buscar actualizaciones
          </button>
          <button
            type="button"
            onClick={() => void openUrl(RELEASES).catch((e) => console.error("openUrl", e))}
          >
            <ExternalLink size={14} aria-hidden="true" /> Versiones
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
