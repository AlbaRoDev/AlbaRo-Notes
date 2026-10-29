import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { CropRect } from "../../lib/image-edit";

const MIN = 0.05; // smallest side, as a fraction of the picture
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Which edges a handle moves; "move" drags the whole box. */
const HANDLES = ["nw", "n", "ne", "w", "e", "sw", "s", "se"] as const;
type Handle = (typeof HANDLES)[number] | "move";

/** Moves the edges `handle` names by (dx, dy) fractions, keeping the box inside the picture and at least MIN wide. */
function drag(start: CropRect, handle: Handle, dx: number, dy: number): CropRect {
  if (handle === "move") {
    return {
      ...start,
      x: clamp(start.x + dx, 0, 1 - start.w),
      y: clamp(start.y + dy, 0, 1 - start.h),
    };
  }
  let { x, y, w, h } = start;
  if (handle.includes("w")) {
    const nx = clamp(x + dx, 0, x + w - MIN);
    w += x - nx;
    x = nx;
  }
  if (handle.includes("e")) w = clamp(w + dx, MIN, 1 - x);
  if (handle.includes("n")) {
    const ny = clamp(y + dy, 0, y + h - MIN);
    h += y - ny;
    y = ny;
  }
  if (handle.includes("s")) h = clamp(h + dy, MIN, 1 - y);
  return { x, y, w, h };
}

/**
 * The crop box laid over the picture. Nothing is written until «Recortar»:
 * the box is local state, and Esc or «Cancelar» leave the image untouched.
 */
export function ImageCrop({
  onApply,
  onCancel,
}: {
  onApply: (rect: CropRect) => void;
  onCancel: () => void;
}) {
  const [rect, setRect] = useState<CropRect>({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const root = useRef<HTMLDivElement>(null);
  const active = useRef<{ handle: Handle; x: number; y: number; start: CropRect } | null>(null);

  const down = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const handle = e.currentTarget.dataset.h as Handle;
    e.preventDefault(); // the editor must never see a click in here
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // the pointer is no longer active; the drag simply doesn't track
    }
    active.current = { handle, x: e.clientX, y: e.clientY, start: rect };
  };

  const move = (e: PointerEvent) => {
    const a = active.current;
    const box = root.current?.getBoundingClientRect();
    if (!a || !box?.width || !box.height) return;
    setRect(drag(a.start, a.handle, (e.clientX - a.x) / box.width, (e.clientY - a.y) / box.height));
  };

  const up = () => {
    active.current = null;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
    else if (e.key === "Enter") onApply(rect);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const pct = (n: number) => `${n * 100}%`;
  return (
    <div
      ref={root}
      className="image-crop"
      role="group"
      aria-label="Recortar la imagen"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div
        className="image-crop-box"
        style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
        data-h="move"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {/* move/up bubble from the captured handle to the box */}
        {HANDLES.map((h) => (
          <span key={h} className="image-crop-handle" data-h={h} onPointerDown={down} />
        ))}
      </div>
      <div className="image-crop-actions">
        <button type="button" autoFocus onClick={() => onApply(rect)}>
          Recortar
        </button>
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
