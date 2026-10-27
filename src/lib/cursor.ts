// The mouse pointer. The window can draw its own, minimal one — the same thin outlined arrow as the pointer button
// of the sidebar (lucide's `mouse-pointer-2`), with no colour: a dark line on white in the light theme and a white
// line on dark in the dark one — instead of the system's. It is an SVG image in CSS (`cursor: url(...)`), which the CSP
// allows (`img-src data:`); App.css reads it from two variables and falls back to the system pointer wherever they are
// not set, so the system's own stay: the text I-beam, the resize arrows, grabbing. Over what can be pressed the arrow
// becomes a pointing hand drawn the same way (lucide's `pointer`: a thin outline, no colour).

const SIZE = 18; // the arrow fills about 17/24 of it: ~13 px, the size of the system pointer
const ARROW =
  "M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z";

const HAND =
  "M22 14a8 8 0 0 1-8 8M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15";

/** The arrow's outline in the ink of the theme, with the other tone inside so it reads on any background. */
function shapeSvg(path: string, dark: boolean): string {
  const line = dark ? "#ffffff" : "#1f1f1f";
  const inside = dark ? "#1f1f1f" : "#ffffff";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" fill="${inside}" stroke="${line}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${path}"/>` +
    `</svg>`
  );
}

const image = (path: string, dark: boolean, x: number, y: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(shapeSvg(path, dark))}") ${x} ${y}`;

/** The two CSS values (`--cursor-default`, `--cursor-pointer`) for the light or the dark theme; the hot spots are the arrow's tip and the finger's. */
export function cursorVariables(dark: boolean): Record<string, string> {
  return {
    "--cursor-default": `${image(ARROW, dark, 3, 3)}, default`,
    "--cursor-pointer": `${image(HAND, dark, 6, 2)}, pointer`,
  };
}

export const CURSOR_VARIABLES = ["--cursor-default", "--cursor-pointer"];
