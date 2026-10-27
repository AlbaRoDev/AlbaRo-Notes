// Run with: node --test tests/   (Node 22.18+ loads the .ts modules directly, stripping their types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { SEASONS, seasonFor } from "../src/lib/seasons.ts";
import {
  PALETTE_VARIABLES,
  SEASON_COLOURS,
  contrast,
  coloursFor,
  oklchToRgb,
  paletteFor,
} from "../src/lib/palette.ts";

// WCAG AA wants 4.5 for text and 3 for large text and interface parts; a little margin on top.
const TEXT = 4.6;
const PART = 3.1;
const WHITE = [255, 255, 255];
const MODES = ["light", "dark"];

test("every season keeps its text readable on every surface, in both modes", () => {
  for (const season of SEASONS)
    for (const mode of MODES) {
      const c = coloursFor(season, mode);
      const where = `${season} ${mode}`;
      assert.ok(contrast(c.text, c.bg) > 7, `${where}: text on the page`);
      assert.ok(contrast(c.text, c.sidebar) > 7, `${where}: text on the sidebar`);
      assert.ok(contrast(c.text, c.popover) > 7, `${where}: text on a menu`);
      for (const surface of [c.bg, c.sidebar, c.popover])
        assert.ok(contrast(c.muted, surface) > TEXT, `${where}: muted text`);
      assert.ok(contrast(c.onAccent, c.accent) > TEXT, `${where}: text on the accent`);
      assert.ok(contrast(c.accent, c.bg) > PART, `${where}: the accent on the page`);
      assert.ok(contrast(c.accent, c.sidebar) > PART, `${where}: the accent on the sidebar`);
      for (const surface of [c.bg, c.popover])
        assert.ok(contrast(c.danger, surface) > TEXT, `${where}: error text`);
    }
});

test("the text on the accent is never plain white where white would not read", () => {
  // light accents carry light text, dark mode's bright accents carry dark text: that is why --on-accent exists
  for (const season of SEASONS) {
    assert.ok(contrast(coloursFor(season, "light").accent, WHITE) > TEXT - 0.5, season);
    assert.ok(
      contrast(coloursFor(season, "dark").accent, WHITE) < TEXT,
      `${season}: dark accents need dark text`,
    );
  }
});

test("every season and mode sets the same variables, with real values", () => {
  for (const season of SEASONS)
    for (const mode of MODES) {
      const p = paletteFor(season, mode);
      assert.deepEqual(Object.keys(p).sort(), [...PALETTE_VARIABLES].sort());
      assert.match(p["--ink"], /^\d+, \d+, \d+$/);
      assert.match(p["--accent-rgb"], /^\d+, \d+, \d+$/);
      assert.match(p["--bg"], /^rgb\(\d+, \d+, \d+\)$/);
      assert.match(p["--season-strip"], /^linear-gradient\(90deg, rgb\(/);
    }
});

test("each season has its own accent, and light and dark their own surfaces", () => {
  const accents = SEASONS.map((s) => paletteFor(s, "light")["--accent"]);
  assert.equal(new Set(accents).size, SEASONS.length);
  for (const season of SEASONS)
    assert.notEqual(paletteFor(season, "light")["--bg"], paletteFor(season, "dark")["--bg"]);
});

const hueGap = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

test("no two seasons look alike", () => {
  for (const [i, a] of SEASONS.entries())
    for (const b of SEASONS.slice(i + 1)) {
      const accent = hueGap(SEASON_COLOURS[a].hue, SEASON_COLOURS[b].hue);
      const surface = hueGap(SEASON_COLOURS[a].tint, SEASON_COLOURS[b].tint);
      assert.ok(
        accent >= 30 || surface >= 60,
        `${a} and ${b}: accent ${accent}°, surfaces ${surface}°`,
      );
    }
  const strips = SEASONS.map((s) => paletteFor(s, "light")["--season-strip"]);
  assert.equal(new Set(strips).size, SEASONS.length);
  for (const s of SEASONS)
    assert.equal(paletteFor(s, "light")["--season-strip"], paletteFor(s, "dark")["--season-strip"]);
});

test("Halloween is orange on purple and Christmas red on green, as on the website", () => {
  assert.deepEqual(SEASON_COLOURS.halloween.strip, [50, 305, 140]);
  assert.equal(SEASON_COLOURS.halloween.hue, 50);
  assert.ok(hueGap(SEASON_COLOURS.halloween.tint, 305) < 15);
  assert.deepEqual(SEASON_COLOURS.christmas.strip.slice(0, 2), [25, 150]);
});

test("the colour converter knows black, white and a mid grey", () => {
  assert.deepEqual(oklchToRgb(0, 0, 0), [0, 0, 0]);
  assert.deepEqual(oklchToRgb(1, 0, 0), [255, 255, 255]);
  const [r, g, b] = oklchToRgb(0.6, 0, 0);
  assert.ok(r === g && g === b && r > 100 && r < 130);
  assert.ok(Math.abs(contrast([0, 0, 0], WHITE) - 21) < 0.01);
});

// [month (1-12), day, season]: the website's calendar, edges included.
const CALENDAR = [
  [1, 1, "christmas"],
  [1, 6, "christmas"],
  [1, 7, "winter"],
  [3, 19, "winter"],
  [3, 20, "spring"],
  [3, 29, "easter"],
  [4, 5, "easter"],
  [4, 6, "spring"],
  [6, 1, "spring"],
  [6, 2, "anniversary"],
  [6, 3, "spring"],
  [6, 22, "summer"],
  [7, 1, "summerSun"],
  [7, 15, "summerSun"],
  [7, 16, "summer"],
  [9, 23, "summer"],
  [9, 24, "autumn"],
  [10, 29, "autumn"],
  [10, 30, "halloween"],
  [11, 1, "halloween"],
  [11, 2, "autumn"],
  [12, 14, "autumn"],
  [12, 15, "christmas"],
  [12, 31, "christmas"],
];

test("seasonFor follows the website's calendar, edges included", () => {
  for (const [month, day, season] of CALENDAR)
    assert.equal(seasonFor(new Date(2026, month - 1, day)), season, `${day}/${month}`);
});

test("every day of the year has a season, every season appears, and the time of day does not matter", () => {
  const seen = new Set();
  for (const year of [2026, 2028])
    for (let d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 1))
      seen.add(seasonFor(d));
  assert.deepEqual([...seen].sort(), [...SEASONS].sort());
  assert.equal(seasonFor(new Date(2026, 9, 30, 0, 0, 0)), "halloween");
  assert.equal(seasonFor(new Date(2026, 9, 29, 23, 59, 59)), "autumn");
});
