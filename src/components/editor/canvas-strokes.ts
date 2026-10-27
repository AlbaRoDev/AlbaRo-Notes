// the canvas block's drawing data. A stroke is a flat list of x,y numbers on an
// (almost) infinite sheet: the block is a window onto it, 1000 units wide at 100 % zoom, so a
// drawing is plain JSON that stays editable and scales to the column.

export type CanvasColor = "ink" | "red" | "blue" | "green" | "orange";

/** `css` is what the screen draws with («ink» follows the theme's text colour); `raster` is for the image sent to the AI. */
export const CANVAS_COLORS: Record<CanvasColor, { label: string; css: string; raster: string }> = {
  ink: { label: "Tinta", css: "currentColor", raster: "#000000" },
  red: { label: "Rojo", css: "#e03e3e", raster: "#e03e3e" },
  blue: { label: "Azul", css: "#337ea9", raster: "#337ea9" },
  green: { label: "Verde", css: "#0f7b6c", raster: "#0f7b6c" },
  orange: { label: "Naranja", css: "#d9730d", raster: "#d9730d" },
};

export interface Stroke {
  color: CanvasColor;
  width: number;
  /** x0, y0, x1, y1, … */
  points: number[];
}

export const CANVAS_WIDTH = 1000;
export const DEFAULT_HEIGHT = 360;
export const MIN_HEIGHT = 160;
export const MAX_HEIGHT = 2000;
/** Mirrors the caps in validate.rs — Rust re-checks everything on save. */
export const MAX_STROKES = 2000;
export const MAX_STROKE_COORDS = 10_000;
export const MAX_CANVAS_COORDS = 200_000;
export const PEN_WIDTHS = [
  { width: 2.5, label: "Fino" },
  { width: 5, label: "Medio" },
  { width: 10, label: "Grueso" },
];

/** The block grows by this much when the pen gets within `GROW_MARGIN` of its bottom edge. */
export const GROW_STEP = 240;
const GROW_MARGIN = 60;
export const MIN_ZOOM = 0.05;
const MAX_ZOOM = 5;
/** How far from the origin ink and view can go: «infinite» for any real drawing, but bounded for Rust. */
export const COORD_LIMIT = 100_000;

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export const round1 = (n: number) => Math.round(n * 10) / 10;

export const cleanHeight = (raw: unknown): number =>
  typeof raw === "number" && Number.isFinite(raw)
    ? clamp(Math.round(raw), MIN_HEIGHT, MAX_HEIGHT)
    : DEFAULT_HEIGHT;

export const totalCoords = (strokes: Stroke[]) =>
  strokes.reduce((sum, s) => sum + s.points.length, 0);

/**
 * The window's height after a stroke: taller if the stroke ended near the bottom edge of what is
 * shown, so handwritten notes never run out of room (they can also be scrolled down, with no end).
 */
export function grownHeight(height: number, points: number[], view: View): number {
  let lowest = -Infinity;
  for (let i = 1; i < points.length; i += 2) lowest = Math.max(lowest, points[i]);
  const bottom = view.y + height / view.zoom;
  return lowest > bottom - GROW_MARGIN / view.zoom
    ? Math.min(MAX_HEIGHT, height + GROW_STEP)
    : height;
}

/** What part of the sheet the block shows: `zoom` 1 = 1000 units across; `x`, `y` = its top-left corner, in drawing units. */
export interface View {
  zoom: number;
  x: number;
  y: number;
}

export const FULL_VIEW: View = { zoom: 1, x: 0, y: 0 };

/** The view kept in range: zoom within its limits, and the visible area never past the sheet's far edges. */
export function clampView(v: View, height: number): View {
  const zoom = clamp(v.zoom, MIN_ZOOM, MAX_ZOOM);
  return {
    zoom,
    x: clamp(v.x, -COORD_LIMIT, COORD_LIMIT - CANVAS_WIDTH / zoom),
    y: clamp(v.y, -COORD_LIMIT, COORD_LIMIT - height / zoom),
  };
}

/** The view that shows all the ink with a margin (as large as 150 %), or the home view when there is none. */
export function fitView(strokes: Stroke[], height: number): View {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of strokes) {
    for (let i = 0; i < s.points.length; i += 2) {
      minX = Math.min(minX, s.points[i]);
      maxX = Math.max(maxX, s.points[i]);
      minY = Math.min(minY, s.points[i + 1]);
      maxY = Math.max(maxY, s.points[i + 1]);
    }
  }
  if (minX === Infinity) return FULL_VIEW;
  const margin = 40;
  const [w, h] = [maxX - minX + 2 * margin, maxY - minY + 2 * margin];
  const zoom = clamp(Math.min(CANVAS_WIDTH / w, height / h), MIN_ZOOM, 1.5);
  return clampView(
    {
      zoom,
      x: (minX + maxX) / 2 - CANVAS_WIDTH / zoom / 2,
      y: (minY + maxY) / 2 - height / zoom / 2,
    },
    height,
  );
}

/** Zooms by `factor` keeping the drawing point (px, py) under the cursor, as pinch and Ctrl+wheel do. */
export function zoomAt(v: View, factor: number, px: number, py: number, height: number): View {
  const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const [fx, fy] = [(px - v.x) / (CANVAS_WIDTH / v.zoom), (py - v.y) / (height / v.zoom)];
  return clampView(
    { zoom, x: px - (fx * CANVAS_WIDTH) / zoom, y: py - (fy * height) / zoom },
    height,
  );
}

export const viewBoxOf = (v: View, height: number) =>
  `${round1(v.x)} ${round1(v.y)} ${round1(CANVAS_WIDTH / v.zoom)} ${round1(height / v.zoom)}`;

function isStroke(v: unknown): v is Stroke {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.color === "string" &&
    s.color in CANVAS_COLORS &&
    typeof s.width === "number" &&
    s.width >= 0.5 &&
    s.width <= 40 &&
    Array.isArray(s.points) &&
    s.points.length >= 2 &&
    s.points.length % 2 === 0 &&
    s.points.length <= MAX_STROKE_COORDS &&
    s.points.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= COORD_LIMIT)
  );
}

/**
 * Whatever came out of pasted HTML or an old document becomes valid strokes within the caps:
 * Rust refuses a page with a bad stroke, so a paste must never be able to carry one in.
 */
export function sanitizeStrokes(raw: unknown): Stroke[] {
  if (!Array.isArray(raw)) return [];
  const out: Stroke[] = [];
  let total = 0;
  for (const item of raw) {
    if (out.length >= MAX_STROKES || !isStroke(item)) continue;
    if (total + item.points.length > MAX_CANVAS_COORDS) break;
    total += item.points.length;
    out.push({ color: item.color, width: item.width, points: item.points });
  }
  return out;
}

/** An SVG path for a stroke: quadratic curves through the midpoints, so handwriting looks smooth. */
export function strokePath(p: number[]): string {
  const n = p.length / 2;
  if (n === 0) return "";
  if (n === 1) return `M${p[0]} ${p[1]}l0.01 0`; // a dot: round caps make it visible
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 1; i < n - 1; i++) {
    const [cx, cy, nx, ny] = [p[2 * i], p[2 * i + 1], p[2 * i + 2], p[2 * i + 3]];
    d += `Q${cx} ${cy} ${round1((cx + nx) / 2)} ${round1((cy + ny) / 2)}`;
  }
  return `${d}L${p[2 * n - 2]} ${p[2 * n - 1]}`;
}

/** Whether the point (x, y) is within `radius` of the stroke (the eraser removes whole strokes). */
export function strokeHit(stroke: Stroke, x: number, y: number, radius: number): boolean {
  const reach = radius + stroke.width / 2;
  const p = stroke.points;
  if (p.length === 2) return Math.hypot(p[0] - x, p[1] - y) <= reach;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const [ax, ay, bx, by] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
    const [dx, dy] = [bx - ax, by - ay];
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : clamp(((x - ax) * dx + (y - ay) * dy) / len2, 0, 1);
    if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= reach) return true;
  }
  return false;
}

/**
 * The strokes drawn black on white whatever the theme, cropped to the writing (plus a margin)
 * and scaled so small handwriting stays legible: what a vision model reads or an image block shows.
 */
function drawStrokes(strokes: Stroke[]): HTMLCanvasElement {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of strokes) {
    for (let i = 0; i < s.points.length; i += 2) {
      minX = Math.min(minX, s.points[i]);
      maxX = Math.max(maxX, s.points[i]);
      minY = Math.min(minY, s.points[i + 1]);
      maxY = Math.max(maxY, s.points[i + 1]);
    }
  }
  const margin = 40;
  const [x0, y0] = [minX - margin, minY - margin];
  const [w, h] = [Math.max(maxX - minX + 2 * margin, 120), Math.max(maxY - minY + 2 * margin, 120)];
  // small writing is enlarged (up to ×3) and a huge drawing shrunk, so the image is never bigger than ~1600 px
  const scale = Math.min(3, 1600 / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se puede preparar la imagen");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.translate(-x0, -y0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    ctx.strokeStyle = CANVAS_COLORS[s.color].raster;
    ctx.lineWidth = Math.max(s.width, 3); // a thin line vanishes when the model downsizes the image
    ctx.stroke(new Path2D(strokePath(s.points)));
  }
  return canvas;
}

/** The strokes as a PNG data URL (for the vision model). */
export const rasterize = (strokes: Stroke[]): string => drawStrokes(strokes).toDataURL("image/png");

/** The strokes as a PNG file (for an image block). */
export function rasterizeBlob(strokes: Stroke[]): Promise<Blob> {
  return new Promise((resolve, reject) =>
    drawStrokes(strokes).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No se puede crear la imagen"))),
      "image/png",
    ),
  );
}
