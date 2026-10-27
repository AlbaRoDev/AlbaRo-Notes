import type { KeyboardEvent } from "react";

/**
 * Keyboard navigation for the cells of a database table, like a spreadsheet's. One handler on the `<table>`:
 *
 * - **↑ / ↓** move to the same column of the row above / below; **← / →** to the neighbouring cell (in a text
 *   field only when the caret is already at its start / end, so editing the text still works).
 * - **Enter** in a text cell saves it and moves down; in an option cell it opens the list (that cell's own
 *   handler); on a checkbox it toggles it. **Ctrl/⌘ + Enter** opens the row (its «Abrir» button) from any cell.
 * - **Esc** in a text cell puts the old value back and keeps the focus there.
 * - **Alt + arrows** move from *any* cell, including a date field's ← / →.
 *
 * A native date keeps ← / → (they move between its day, month and year) and a select keeps ↑ / ↓ unless Alt is held.
 */

const CELL_TARGET = "input:not([type=hidden]):not([disabled]), textarea, [role=combobox], select";

type Field = HTMLInputElement | HTMLTextAreaElement;

const isField = (el: Element): el is Field =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

/** The element of a cell that takes the focus: its field or list, else its first button. */
function targetOf(cell: Element | null | undefined): HTMLElement | null {
  if (!cell) return null;
  return (
    cell.querySelector<HTMLElement>(CELL_TARGET) ??
    cell.querySelector<HTMLElement>("button:not(.db-open-btn)")
  );
}

function focusCell(el: HTMLElement | null): boolean {
  if (!el) return false;
  el.focus();
  // like a spreadsheet: arriving on a text cell selects it, so typing replaces it
  if (isField(el) && (el.type === "text" || el.tagName === "TEXTAREA")) el.select();
  return true;
}

/**
 * Is the caret at the very start (or end) of a text field? A field whose whole text is selected counts as both:
 * that is how a cell looks when it was just arrived at, before any editing, so the arrows keep moving on.
 */
function caretAt(el: Field, edge: "start" | "end"): boolean {
  if (el.selectionStart === null || el.selectionEnd === null) return false;
  if (el.selectionStart === 0 && el.selectionEnd === el.value.length) return true;
  if (el.selectionStart !== el.selectionEnd) return false;
  return edge === "start" ? el.selectionStart === 0 : el.selectionStart === el.value.length;
}

export function handleGridKeyDown(e: KeyboardEvent<HTMLTableElement>): void {
  const target = e.target as HTMLElement;
  // React bubbles events out of portals (the option list, the column menu): those are not ours
  if (e.defaultPrevented || !e.currentTarget.contains(target)) return;
  const cell = target.closest("td");
  const row = cell?.closest<HTMLTableRowElement>("tr[data-grid-row]");
  if (!cell || !row) return;

  const open = (e.ctrlKey || e.metaKey) && e.key === "Enter";
  if (open) {
    const button = row.querySelector<HTMLButtonElement>(".db-open-btn");
    if (button) {
      e.preventDefault();
      button.click();
    }
    return;
  }

  const field = isField(target) ? target : null;
  const textual = field !== null && (field.tagName === "TEXTAREA" || field.type === "text");

  // Escape: the cell's own handler puts the value back and blurs; take the focus back
  if (e.key === "Escape" && textual) {
    queueMicrotask(() => target.focus());
    return;
  }
  if (e.key === "Enter" && !e.altKey && !e.shiftKey) {
    if (target instanceof HTMLInputElement && target.type === "checkbox") {
      e.preventDefault();
      target.click();
    } else if (textual) {
      const next = row.nextElementSibling?.closest("tr[data-grid-row]")
        ? row.nextElementSibling
        : null;
      // the cell's own handler saved it (blur); carry on to the row below
      if (focusCell(targetOf(next?.children[cell.cellIndex]))) e.preventDefault();
    }
    return;
  }

  const vertical = e.key === "ArrowDown" || e.key === "ArrowUp";
  const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
  if (!vertical && !horizontal) return;
  if (e.shiftKey || e.ctrlKey || e.metaKey) return;

  if (!e.altKey) {
    // a native date moves between its day / month / year with ← / →, a select its options with ↑ / ↓, and an open list keeps both
    if (field?.type === "date" && horizontal) return;
    if (target instanceof HTMLSelectElement && vertical) return; // its options go up and down
    if (target.getAttribute("aria-expanded") === "true") return;
    if (textual && field) {
      if (e.key === "ArrowLeft" && !caretAt(field, "start")) return;
      if (e.key === "ArrowRight" && !caretAt(field, "end")) return;
      // a wrapped (multi-line) text keeps ↑/↓ for its own lines
      if (field.tagName === "TEXTAREA") {
        if (
          e.key === "ArrowUp" &&
          !caretAt(field, "start") &&
          field.value.slice(0, field.selectionStart ?? 0).includes("\n")
        )
          return;
        if (e.key === "ArrowDown" && field.value.slice(field.selectionEnd ?? 0).includes("\n"))
          return;
      }
    }
  }

  let destination: HTMLElement | null = null;
  if (vertical) {
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("tr[data-grid-row]"));
    const at = rows.indexOf(row);
    const next = rows[at + (e.key === "ArrowDown" ? 1 : -1)];
    destination = targetOf(next?.children[cell.cellIndex]);
  } else {
    const step = e.key === "ArrowRight" ? 1 : -1;
    for (let i = cell.cellIndex + step; i >= 0 && i < row.cells.length; i += step) {
      destination = targetOf(row.cells[i]);
      if (destination) break;
    }
  }
  if (focusCell(destination)) e.preventDefault();
}
