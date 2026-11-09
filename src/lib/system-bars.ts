/**
 * Tells the Android window the colour of the page and whether it is dark, so the strip under the navigation
 * buttons and the icons of the status bar follow the theme the user picked, not the system's (`SystemBars` in
 * MainActivity.kt). Elsewhere there is no such bridge and this does nothing.
 */
type Bridge = { set(rgb: number, dark: boolean): void };

/** `#rgb`, `#rrggbb` or `rgb(r, g, b)` as 0xRRGGBB; null for anything else (a name, a `var()`, a gradient). */
export function parseColor(text: string): number | null {
  const s = text.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1] ?? "";
    return parseInt(h.length === 3 ? [...h].map((c) => c + c).join("") : h, 16);
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  if (!rgb) return null;
  const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n)));
  return ((r ?? 0) << 16) | ((g ?? 0) << 8) | (b ?? 0);
}

export function syncSystemBars(root: HTMLElement, dark: boolean) {
  const bridge = (window as { AlbaroNative?: Bridge }).AlbaroNative;
  if (!bridge) return;
  const rgb = parseColor(getComputedStyle(root).getPropertyValue("--bg"));
  if (rgb !== null) bridge.set(rgb, dark);
}
