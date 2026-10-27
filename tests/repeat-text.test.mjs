// Run with: node --test tests/   (Node 22.18+ loads the .ts module directly, stripping its types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayNumber } from "../src/lib/date-utils.ts";
import { dayFacts, defaultRepeatEnd, describeRepeat } from "../src/lib/repeat-text.ts";

const rule = (freq, extra = {}) => ({
  freq,
  interval: 1,
  weekdays: [],
  until: null,
  count: null,
  nth: null,
  lastDay: false,
  ...extra,
});

// 2026-10-27 is a Tuesday and the fourth and last one of its month; 2026-10-20 is the third Tuesday.
const TUESDAY_27 = "2026-10-27";
const TUESDAY_20 = "2026-10-20";

test("a rule is read back in words: every N days, weeks, months or years", () => {
  assert.equal(describeRepeat(rule("daily"), TUESDAY_27), "Cada día");
  assert.equal(describeRepeat(rule("daily", { interval: 4 }), TUESDAY_27), "Cada 4 días");
  assert.equal(
    describeRepeat(rule("monthly", { interval: 2 }), TUESDAY_20),
    "Cada 2 meses, el día 20",
  );
  assert.equal(describeRepeat(rule("yearly"), TUESDAY_20), "Cada año, el 20 de octubre");
  assert.equal(
    describeRepeat(rule("yearly", { interval: 3 }), TUESDAY_20),
    "Cada 3 años, el 20 de octubre",
  );
});

test("weekly rules name their days, with the plural only where the word changes", () => {
  assert.equal(
    describeRepeat(rule("weekly", { weekdays: [1] }), TUESDAY_27),
    "Cada semana, el martes",
  );
  assert.equal(
    describeRepeat(rule("weekly", { weekdays: [5] }), TUESDAY_27),
    "Cada semana, el sábado",
  );
  assert.equal(
    describeRepeat(rule("weekly", { interval: 2, weekdays: [1, 3] }), TUESDAY_27),
    "Cada 2 semanas, los martes y jueves",
  );
  assert.equal(
    describeRepeat(rule("weekly", { weekdays: [0, 2, 5] }), TUESDAY_27),
    "Cada semana, los lunes, miércoles y sábados",
  );
  assert.equal(
    describeRepeat(rule("weekly", { weekdays: [5, 6] }), TUESDAY_27),
    "Cada semana, los sábados y domingos",
  );
  assert.equal(
    describeRepeat(rule("weekly", { weekdays: [0, 1, 2, 3, 4] }), TUESDAY_27),
    "Cada semana, de lunes a viernes",
  );
  // an order that came unsorted reads the same; no day at all means the day the entry starts on
  assert.equal(
    describeRepeat(rule("weekly", { weekdays: [4, 0, 2, 1, 3] }), TUESDAY_27),
    "Cada semana, de lunes a viernes",
  );
  assert.equal(describeRepeat(rule("weekly"), TUESDAY_27), "Cada semana, el martes");
});

test("monthly and yearly rules say how the month is counted", () => {
  assert.equal(
    describeRepeat(rule("monthly", { weekdays: [1], nth: 3 }), TUESDAY_20),
    "Cada mes, el tercer martes",
  );
  assert.equal(
    describeRepeat(rule("monthly", { weekdays: [1], nth: -1 }), TUESDAY_27),
    "Cada mes, el último martes",
  );
  assert.equal(
    describeRepeat(rule("monthly", { lastDay: true }), TUESDAY_27),
    "Cada mes, el último día del mes",
  );
  assert.equal(
    describeRepeat(rule("yearly", { weekdays: [1], nth: 3 }), TUESDAY_20),
    "Cada año, el tercer martes de octubre",
  );
  assert.equal(
    describeRepeat(rule("yearly", { weekdays: [1], nth: -1 }), TUESDAY_27),
    "Cada año, el último martes de octubre",
  );
});

test("how a rule ends is said last: on a day or after a number of times", () => {
  assert.equal(
    describeRepeat(
      rule("weekly", { interval: 2, weekdays: [1, 3], until: "2026-12-15" }),
      TUESDAY_27,
    ),
    "Cada 2 semanas, los martes y jueves, hasta el 15 de diciembre de 2026",
  );
  assert.equal(
    describeRepeat(rule("daily", { interval: 4, count: 5 }), TUESDAY_27),
    "Cada 4 días, 5 veces",
  );
  assert.equal(describeRepeat(rule("daily", { count: 1 }), TUESDAY_27), "Cada día, 1 vez");
});

test("a rule told to end on a day starts from far enough to be seen repeating", () => {
  const span = (freq) => dayNumber(defaultRepeatEnd(freq, TUESDAY_27)) - dayNumber(TUESDAY_27);
  assert.equal(defaultRepeatEnd("daily", TUESDAY_27), "2026-11-26");
  assert.equal(span("weekly"), 30);
  assert.equal(span("monthly"), 365);
  assert.equal(span("yearly"), 5 * 365);
});

test("the facts of the day an entry starts on", () => {
  const f = dayFacts(TUESDAY_27);
  assert.deepEqual(
    [f.d, f.wd, f.name, f.month, f.nth, f.isLastOfKind, f.isLastDay],
    [27, 1, "martes", "octubre", 4, true, false],
  );
  const third = dayFacts(TUESDAY_20);
  assert.deepEqual([third.nth, third.isLastOfKind], [3, false]);
  // the 31st is the fifth of its weekday: it can only be «the last one», never «the fifth»
  const last = dayFacts("2026-10-31");
  assert.deepEqual([last.nth, last.isLastOfKind, last.isLastDay], [null, true, true]);
});
