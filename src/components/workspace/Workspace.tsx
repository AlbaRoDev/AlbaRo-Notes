import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronsLeft, ChevronsRight, House } from "lucide-react";
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

/** Each zone keeps at least this much (px) unless it is folded away altogether. */
const MIN_ZONE = 240;
/** Under this width the main zone has no room for a sidebar beside the page: it floats over it instead. */
const NARROW_ZONE = 560;
/** How long the zones take to glide to a new split (workspace.css has the same figure). */
const ZONE_GLIDE_MS = 260;

/**
 * The main zone (the half you picked) next to the companion panel, with a draggable border between
 * them. Both zones stay mounted when one is folded, so nothing loses its state.
 */
export function Workspace({
  layout,
  main,
  companion,
  onEnter,
  onSplit,
  onHome,
  menu,
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
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const { split } = layout;
  const shown = shownHalf(layout);
  // Dragging shows the raw position and snaps on release, so the border follows the pointer smoothly.
  const [dragSplit, setDragSplit] = useState<number | null>(null);
  const hasCompanion = companion !== null;
  const ratio = hasCompanion ? (dragSplit ?? split) : 1;
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

  const mainFolded = ratio <= 0;
  const companionFolded = hasCompanion && ratio >= 1;
  const companionHalf = otherHalf(layout.main);
  const unfold = () => onSplit(lastOpen.current);

  return (
    <div className="workspace">
      <header className="workspace-bar" data-tauri-drag-region>
        {menu}
        <button
          type="button"
          className="ws-icon-button"
          onClick={onHome}
          title="Pantalla de inicio"
          aria-label="Pantalla de inicio"
        >
          <House size={16} />
        </button>
        <div className="workspace-switch" role="group" aria-label="Cambiar entre Notas y Gestor">
          {(["notes", "manager"] as const).map((half) => {
            const { label, Icon, key } = HALVES[half];
            return (
              <button
                key={half}
                type="button"
                aria-pressed={half === shown}
                onClick={() => onEnter(half)}
                title={`${label} (Ctrl+${key})`}
              >
                <Icon size={15} aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
        <span className="workspace-bar-fill" data-tauri-drag-region />
        <ThemeToggle />
        <WindowControls />
      </header>
      <div className="workspace-body" ref={bodyRef} data-dragging={dragSplit !== null || undefined}>
        {mainFolded && (
          <button
            type="button"
            className="workspace-rail"
            onClick={unfold}
            title={`Mostrar ${HALVES[layout.main].label}`}
            aria-label={`Mostrar ${HALVES[layout.main].label}`}
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
        {hasCompanion && !mainFolded && !companionFolded && (
          <div
            className="workspace-divider"
            data-dragging={dragSplit !== null}
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionar el panel compañero (doble clic: plegar)"
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
            style={{ flexGrow: 1 - ratio }}
            data-folded={companionFolded || undefined}
            aria-label={`${HALVES[companionHalf].label} (panel compañero)`}
          >
            <button
              type="button"
              className="workspace-companion-close"
              onClick={() => onSplit(1)}
              title="Cerrar el panel"
              aria-label="Cerrar el panel compañero"
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
            title={`Mostrar ${HALVES[companionHalf].label}`}
            aria-label={`Mostrar ${HALVES[companionHalf].label}`}
          >
            <ChevronsLeft size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
