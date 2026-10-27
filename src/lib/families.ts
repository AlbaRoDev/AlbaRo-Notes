export interface Circle {
  x: number;
  y: number;
  r: number;
}

const ANGLES = 24;

/**
 * Packs circles of the given radii (biggest first reads best) into a tight cluster around the origin, no two
 * overlapping and `gap` apart: each one goes where it touches an already placed circle and sits closest to the
 * centre. Returns them in the order given. O(n²) — fine for the hundred families Rust caps it at.
 */
export function packCircles(radii: number[], gap = 4): Circle[] {
  const placed: Circle[] = [];
  for (const r of radii) {
    if (placed.length === 0) {
      placed.push({ x: 0, y: 0, r });
      continue;
    }
    let best: Circle | null = null;
    let bestDistance = Infinity;
    for (const around of placed) {
      const reach = around.r + r + gap;
      for (let i = 0; i < ANGLES; i++) {
        const angle = (i / ANGLES) * Math.PI * 2;
        const x = around.x + Math.cos(angle) * reach;
        const y = around.y + Math.sin(angle) * reach;
        if (placed.some((c) => Math.hypot(c.x - x, c.y - y) < c.r + r + gap - 1e-6)) continue;
        const distance = Math.hypot(x, y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { x, y, r };
        }
      }
    }
    placed.push(best ?? { x: 0, y: 0, r }); // unreachable: a free spot always exists around the outermost circle
  }
  return placed;
}

/** The box that holds every circle, to size the drawing around them. */
export function bounds(circles: Circle[]): {
  minX: number;
  minY: number;
  width: number;
  height: number;
} {
  if (circles.length === 0) return { minX: 0, minY: 0, width: 0, height: 0 };
  const minX = Math.min(...circles.map((c) => c.x - c.r));
  const maxX = Math.max(...circles.map((c) => c.x + c.r));
  const minY = Math.min(...circles.map((c) => c.y - c.r));
  const maxY = Math.max(...circles.map((c) => c.y + c.r));
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/** Radius of a family's bubble: the area follows its size, with a floor so a small family can still be clicked. */
export function radiusOf(size: number, biggest: number, max: number, min = 22): number {
  if (biggest <= 0 || size <= 0) return min;
  return Math.max(min, Math.sqrt(size / biggest) * max);
}
