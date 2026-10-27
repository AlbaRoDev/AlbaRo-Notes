// The colours of the themed style: warm cream surfaces with brown text in light, deep brown in dark, and an
// accent that changes with the season — the same palette AlbaRo Downloader and the author's website use. Each
// season is the accent (hue and chroma), the tint of the surfaces and the hues of a thin gradient strip;
// `paletteFor` turns that into the CSS variables of App.css. Lightness is fixed per mode, so the text on every
// surface keeps its contrast whatever the hue: `tests/palette.test.mjs` checks all 9 seasons in both modes
// against WCAG AA, and that no two seasons look alike, so a retuned season fails there and not in front of the
// user.
//
// The colours are worked out in OKLCH and written as plain sRGB, because App.css also needs them as `r, g, b`
// triplets (`rgba(var(--ink), 0.08)`), which `oklch()` cannot give.
import type { Season } from "./seasons";

interface SeasonColours {
  /** Accent hue, in OKLCH degrees. */
  hue: number;
  /** Accent chroma: how vivid it is. */
  chroma: number;
  /** Hue of the surfaces (background, cards, text). */
  tint: number;
  /** How much of that hue the surfaces carry: a little (cream) or hardly any (cool white). */
  tintChroma: number;
  /** The hues of the strip along the top of the window, left to right: the season's colours. */
  strip: number[];
}

// The website's palette, season by season, reduced to what an app needs (see AlbaRo Downloader's palette.ts,
// from which these figures come): the accent colours the buttons and links, the tint the surfaces, and the
// strip carries the rest of the season's colours.
export const SEASON_COLOURS: Record<Season, SeasonColours> = {
  // Fresh green on warm cream; the strip is the flowers (red, yellow, green, blue).
  spring: { hue: 150, chroma: 0.13, tint: 100, tintChroma: 0.022, strip: [25, 95, 150, 250] },
  // Royal blue on sunny cream, going to green.
  summer: { hue: 260, chroma: 0.17, tint: 95, tintChroma: 0.02, strip: [260, 215, 150] },
  // Sun and beach: teal on sand (a gold accent turns mustard brown at the lightness the contrast needs).
  summerSun: { hue: 200, chroma: 0.1, tint: 85, tintChroma: 0.026, strip: [200, 85, 50] },
  // Dawn orange on cream, into brown.
  autumn: { hue: 45, chroma: 0.18, tint: 70, tintChroma: 0.024, strip: [85, 50, 35] },
  // Ice: a cold cyan-blue on cool white.
  winter: { hue: 220, chroma: 0.09, tint: 240, tintChroma: 0.014, strip: [215, 235, 255] },
  // Red on pale-green surfaces (deep green in dark), with red, green and gold in the strip.
  christmas: { hue: 25, chroma: 0.19, tint: 150, tintChroma: 0.028, strip: [25, 150, 90] },
  // Orange on purple surfaces (deep purple in dark): orange, purple and green.
  halloween: { hue: 50, chroma: 0.17, tint: 305, tintChroma: 0.03, strip: [50, 305, 140] },
  // Lilac on pale yellow, into gold.
  easter: { hue: 295, chroma: 0.13, tint: 95, tintChroma: 0.022, strip: [295, 320, 90] },
  // Pink.
  anniversary: { hue: 350, chroma: 0.16, tint: 20, tintChroma: 0.018, strip: [350, 330, 10] },
};

export type Mode = "light" | "dark";
export type Rgb = [number, number, number];

/** OKLCH to sRGB (0–255, Björn Ottosson's matrices), clipped to the gamut: a colour out of range only goes greyer. */
export function oklchToRgb(l: number, c: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
  const encode = (v: number) => {
    const x = Math.min(1, Math.max(0, v));
    return Math.round((x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055) * 255);
  };
  return [encode(linear[0]), encode(linear[1]), encode(linear[2])];
}

/** WCAG relative luminance of an sRGB colour. */
function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The colours a season gives one mode, before they become CSS. */
export interface Colours {
  bg: Rgb;
  sidebar: Rgb;
  popover: Rgb;
  text: Rgb;
  muted: Rgb;
  accent: Rgb;
  /** Text on the accent (buttons, today's date). */
  onAccent: Rgb;
  /** Error text and destructive buttons: darker than Notion's red in light, so it reads on cream. */
  danger: Rgb;
}

export function coloursFor(season: Season, mode: Mode): Colours {
  const { hue, chroma, tint, tintChroma: tc } = SEASON_COLOURS[season];
  if (mode === "light") {
    return {
      bg: oklchToRgb(0.975, tc, tint),
      sidebar: oklchToRgb(0.94, tc * 1.4, tint),
      popover: oklchToRgb(0.99, tc / 2, tint),
      text: oklchToRgb(0.3, 0.035, tint),
      muted: oklchToRgb(0.44, 0.03, tint),
      accent: oklchToRgb(0.52, chroma, hue),
      onAccent: oklchToRgb(0.99, 0.01, tint),
      danger: oklchToRgb(0.55, 0.22, 27),
    };
  }
  return {
    bg: oklchToRgb(0.2, tc * 1.2, tint),
    sidebar: oklchToRgb(0.235, tc * 1.2, tint),
    popover: oklchToRgb(0.26, tc * 1.2, tint),
    text: oklchToRgb(0.93, 0.035, tint),
    muted: oklchToRgb(0.76, 0.03, tint),
    accent: oklchToRgb(0.77, chroma * 0.85, hue),
    onAccent: oklchToRgb(0.2, 0.03, hue),
    danger: oklchToRgb(0.7, 0.19, 22),
  };
}

const css = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`;

/** A season's colours as a gradient (the strip along the top of the window, and the season covers of a page). The same in both modes: bright colours read on cream and on deep brown alike. */
export function seasonGradient(season: Season): string {
  const stops = SEASON_COLOURS[season].strip.map((h) => css(oklchToRgb(0.72, 0.16, h))).join(", ");
  return `linear-gradient(90deg, ${stops})`;
}
const triplet = ([r, g, b]: Rgb) => `${r}, ${g}, ${b}`;
const alpha = ([r, g, b]: Rgb, a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;

// The variables of App.css that the themed style replaces (name -> value). Everything else (the tag colours, the
// shadow) is shared with the sober style.
export function paletteFor(season: Season, mode: Mode): Record<string, string> {
  const c = coloursFor(season, mode);
  const light = mode === "light";
  return {
    "--bg": css(c.bg),
    "--bg-sidebar": css(c.sidebar),
    "--bg-popover": css(c.popover),
    "--text": css(c.text),
    "--text-muted": css(c.muted),
    "--text-faint": alpha(c.text, light ? 0.45 : 0.4),
    "--ink": triplet(c.text),
    "--border": alpha(c.text, light ? 0.16 : 0.14),
    "--border-strong": alpha(c.text, light ? 0.28 : 0.26),
    "--accent": css(c.accent),
    "--accent-rgb": triplet(c.accent),
    "--on-accent": css(c.onAccent),
    "--danger": css(c.danger),
    "--callout-bg": css(c.sidebar),
    "--scrollbar-thumb": alpha(c.text, 0.22),
    "--scrollbar-thumb-hover": alpha(c.text, 0.4),
    "--season-strip": seasonGradient(season),
  };
}

// The variable names `paletteFor` sets, to take them off again when the style goes back to sober.
export const PALETTE_VARIABLES = Object.keys(paletteFor("autumn", "light"));
