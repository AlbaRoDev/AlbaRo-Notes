import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronsLeft, ChevronsRight, House, PanelLeft } from "lucide-react";
import { HALVES } from "./halves";
import { ThemeToggle } from "./ThemeToggle";
import { WindowControls } from "./WindowControls";
import {
  DEFAULT_SPLIT,
  SNAPS,
  otherHalf,
  shownHalf,
  snapSplit,
  type Half,
  type Layout,
} from "../../lib/workspace";
import "./workspace.css";
import { t } from "../../lib/i18n.ts";
import { dragRegion, isMobile, useSizeClass } from "../../lib/viewport.ts";
import { useBackLayer } from "../../hooks/useBackLayer.ts";

/** Each zone keeps at least this much (px) unless it is folded away altogether. */
const MIN_ZONE = 240;
/** Under this width the main zone has no room for a sidebar beside the page: it floats over it instead. */
const NARROW_ZONE = 560;
/** How long the zones take to glide to a new split (workspace.css has the same figure). */
const ZONE_GLIDE_MS = 260;

/**
 * The main zone (the half you picked) next to the companion panel, with a draggable border between
 * them. Both zones stay mounted when one is folded, so nothing loses its state.
 *
 * Only on an expanded window. On compact and medium ones a single zone is on screen: the companion becomes a
 * sheet opened from the bar, the sidebar a drawer (`onToggleSidebar`), and on compact the Notes/Gestor switch moves
 * to a bar at the foot of the screen, where a thumb reaches.
 */
export function Workspace({
  layout,
  main,
  companion,
  onEnter,
  onSplit,
  onHome,
  menu,
  sidebarOpen,
  onToggleSidebar,
}: {
  layout: Layout & { main: Half };
  main: ReactNode;
  /** The other half as a side panel; `null` = none (the Gestor has no Notes panel: the sidebar already is Notes). */
  companion: ReactNode | null;
  onEnter: (half: Half) => void;
  onSplit: (split: number) => void;
  onHome: () => void;
  /** The app's menu, first in the bar. */
  menu: ReactNode;
  /** The sidebar's drawer (only drawn when there is a single zone). */
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const { split } = layout;
  const size = useSizeClass();
  const single = size !== "expanded";
  // With one zone on screen it is always the main one (a width saved from a desktop session does not apply).
  const shown = single ? layout.main : shownHalf(layout);
  // Dragging shows the raw position and snaps on release, so the border follows the pointer smoothly.
  const [dragSplit, setDragSplit] = useState<number | null>(null);
  const hasCompanion = companion !== null;
  const ratio = hasCompanion && !single ? (dragSplit ?? split) : 1;
  // The companion as a sheet over the page (single zone only). Closed whenever it cannot be shown.
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetShown = sheetOpen && single && hasCompanion;
  if (sheetOpen && !sheetShown) setSheetOpen(false);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  useBackLayer(sheetShown, closeSheet);
  // Where the rail and a double click bring a folded zone back to.
  const mainRef = useRef<HTMLElement>(null);
  const [mainNarrow, setMainNarrow] = useState(false);
  // While the zones glide to a new split the width passes through every value: judge it only once it has settled.
  const gliding = useRef(false);
  const measure = () => {
    const width = mainRef.current?.getBoundingClientRect().width ?? 0;
    // a folded zone reports 0: keep the last answer instead of flipping
    if (width > 0) setMainNarrow(width < NARROW_ZONE);
  };
  useEffect(() => {
    const zone = mainRef.current;
    if (!zone) return;
    const observer = new ResizeObserver(() => !gliding.current && measure());
    observer.observe(zone);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    gliding.current = true;
    const timer = window.setTimeout(() => {
      gliding.current = false;
      measure();
    }, ZONE_GLIDE_MS + 40);
    return () => window.clearTimeout(timer);
  }, [split]);
  const lastOpen = useRef(DEFAULT_SPLIT);
  useEffect(() => {
    if (split > 0 && split < 1) lastOpen.current = split;
  }, [split]);

  const settle = (raw: number, width: number) => {
    const snapped = snapSplit(raw);
    if (snapped === 0 || snapped === 1) return snapped;
    const min = Math.min(0.5, MIN_ZONE / width);
    return Math.min(1 - min, Math.max(min, snapped));
  };
  const rawAt = (clientX: number) => {
    const rect = bodyRef.current!.getBoundingClientRect();
    return { raw: (clientX - rect.left) / rect.width, width: rect.width };
  };

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault(); // no text selection while dragging
    const handle = e.currentTarget;
    try {
      handle.setPointerCapture(e.pointerId); // throws when the pointer is no longer active
    } catch {
      /* the drag still works without capture, just less forgivingly */
    }
    const onMove = (ev: PointerEvent) => setDragSplit(rawAt(ev.clientX).raw);
    const onUp = (ev: PointerEvent) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      setDragSplit(null);
      if (ev.type === "pointerup") {
        const { raw, width } = rawAt(ev.clientX);
        onSplit(settle(raw, width));
      }
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  // ←/→ on the focused border jump between the snap points.
  const step = (dir: -1 | 1) => {
    const next =
      dir > 0
        ? SNAPS.find((s) => s > split + 0.001)
        : [...SNAPS].reverse().find((s) => s < split - 0.001);
    if (next !== undefined) onSplit(next);
  };

  const mainFolded = !single && ratio <= 0;
  const companionFolded = !single && hasCompanion && ratio >= 1;
  const companionHalf = otherHalf(layout.main);
  const CompanionIcon = HALVES[companionHalf].Icon;
  const unfold = () => onSplit(lastOpen.current);
  const switchTo = (half: Half) => {
    setSheetOpen(false);
    onEnter(half);
  };
  const halfButtons = (iconSize: number, withKey: boolean) =>
    (["notes", "manager"] as const).map((half) => {
      const { label, Icon, key } = HALVES[half];
      return (
        <button
          key={half}
          type="button"
          aria-pressed={half === shown}
          onClick={() => switchTo(half)}
          title={withKey ? `${label} (Ctrl+${key})` : undefined}
        >
          <Icon size={iconSize} aria-hidden />
          {label}
        </button>
      );
    });

  return (
    <div className="workspace">
      <header className="workspace-bar" {...dragRegion}>
        {single && (
          <button
            type="button"
            className="ws-icon-button"
            onClick={onToggleSidebar}
            aria-label={t("Abrir barra lateral")}
            aria-expanded={sidebarOpen}
          >
            <PanelLeft size={16} />
          </button>
        )}
        {menu}
        <button
          type="button"
          className="ws-icon-button"
          onClick={onHome}
          title={t("Pantalla de inicio")}
          aria-label={t("Pantalla de inicio")}
        >
          <House size={16} />
        </button>
        {size !== "compact" && (
          <div
            className="workspace-switch"
            role="group"
            aria-label={t("Cambiar entre Notas y Gestor")}
          >
            {halfButtons(15, true)}
          </div>
        )}
        <span className="workspace-bar-fill" {...dragRegion} />
        {single && hasCompanion && (
          <button
            type="button"
            className="ws-icon-button"
            onClick={() => setSheetOpen((open) => !open)}
            title={t("Mostrar {label}", { label: HALVES[companionHalf].label })}
            aria-label={t("Mostrar {label}", { label: HALVES[companionHalf].label })}
            aria-expanded={sheetShown}
          >
            <CompanionIcon size={16} />
          </button>
        )}
        <ThemeToggle />
        {!isMobile && <WindowControls />}
      </header>
      <div className="workspace-body" ref={bodyRef} data-dragging={dragSplit !== null || undefined}>
        {mainFolded && (
          <button
            type="button"
            className="workspace-rail"
            onClick={unfold}
            title={t("Mostrar {label}", { label: HALVES[layout.main].label })}
            aria-label={t("Mostrar {label}", { label: HALVES[layout.main].label })}
          >
            <ChevronsRight size={16} />
          </button>
        )}
        <section
          ref={mainRef}
          className="workspace-zone workspace-main"
          data-narrow={mainNarrow}
          style={{ flexGrow: ratio }}
          data-folded={mainFolded || undefined}
          aria-label={HALVES[layout.main].label}
        >
          {main}
        </section>
        {hasCompanion && !single && !mainFolded && !companionFolded && (
          <div
            className="workspace-divider"
            data-dragging={dragSplit !== null}
            role="separator"
            aria-orientation="vertical"
            aria-label={t("Redimensionar el panel compañero (doble clic: plegar)")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(ratio * 100)}
            tabIndex={0}
            onPointerDown={startDrag}
            onDoubleClick={() => onSplit(1)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              step(e.key === "ArrowLeft" ? -1 : 1);
            }}
          />
        )}
        {hasCompanion && (
          <aside
            className="workspace-zone workspace-companion"
            style={single ? undefined : { flexGrow: 1 - ratio }}
            data-folded={companionFolded || undefined}
            data-sheet={single || undefined}
            data-open={sheetShown || undefined}
            inert={single && !sheetShown}
            aria-label={t("{label} (panel compañero)", { label: HALVES[companionHalf].label })}
          >
            <button
              type="button"
              className="workspace-companion-close"
              onClick={single ? closeSheet : () => onSplit(1)}
              title={t("Cerrar el panel")}
              aria-label={t("Cerrar el panel compañero")}
            >
              <ChevronsRight size={18} />
            </button>
            {companion}
          </aside>
        )}
        {companionFolded && (
          <button
            type="button"
            className="workspace-rail"
            onClick={unfold}
            title={t("Mostrar {label}", { label: HALVES[companionHalf].label })}
            aria-label={t("Mostrar {label}", { label: HALVES[companionHalf].label })}
          >
            <ChevronsLeft size={16} />
          </button>
        )}
        {sheetShown && (
          <button
            type="button"
            className="workspace-scrim"
            onClick={closeSheet}
            tabIndex={-1}
            aria-label={t("Cerrar el panel")}
          />
        )}
      </div>
      {size === "compact" && (
        <nav className="workspace-tabs" aria-label={t("Cambiar entre Notas y Gestor")}>
          {halfButtons(20, false)}
        </nav>
      )}
    </div>
  );
}
