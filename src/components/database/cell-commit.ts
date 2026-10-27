import type { FocusEvent, KeyboardEvent } from "react";
import type { CellValue, Property } from "../../types";

/**
 * The `key` a cell gets from its parent: uncontrolled inputs remount with their value to show it. The option
 * cells hold an open list, which must outlive a change (tags toggle several options in a row), and a checkbox is
 * controlled and must keep the focus the keyboard just toggled it with, so they keep one key.
 */
export function cellKey(prop: Pick<Property, "type">, value: CellValue | undefined): string {
  return prop.type === "select" || prop.type === "tags" || prop.type === "checkbox"
    ? prop.type
    : JSON.stringify(value ?? null);
}

/** Resolves true if the value was saved; false (Rust rejected it) makes the cell revert. */
export type Commit = (value: CellValue | null) => Promise<boolean>;

// Text-like cells are uncontrolled inputs that commit on blur / Enter, never per
// keystroke: a native date/number input being edited must not be written back
// mid-edit (it resets its partial-segment state — see the 2.3.x date lesson).
// `badInput` = the user left a half-typed date/number: nothing is committed
// or cleared, the input just reverts.
type Field = HTMLInputElement | HTMLTextAreaElement;

export function commitOnBlur(
  current: string,
  commit: Commit,
  toValue: (raw: string) => CellValue | null,
): { onBlur: (e: FocusEvent<Field>) => void; onKeyDown: (e: KeyboardEvent<Field>) => void } {
  return {
    onBlur: async (e) => {
      const input = e.currentTarget;
      if (input.validity.badInput || input.value === current) {
        input.value = current;
        return;
      }
      if (!(await commit(toValue(input.value)))) input.value = current;
    },
    onKeyDown: (e) => {
      if (e.key === "Enter") e.currentTarget.blur();
      else if (e.key === "Escape") {
        e.currentTarget.value = current;
        e.currentTarget.blur();
      }
    },
  };
}
