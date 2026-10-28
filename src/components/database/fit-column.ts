/** A date cell shows its day, month and year in boxes of its own: it never needs less than this. */
const DATE_CELL_MIN = 150;
/** What a header keeps besides its icon, name and padding: the grip of its resize edge and a little air. */
const HEADER_SLACK = 8;

/**
 * The width (px) one column of a rendered table needs to show its widest content without cutting or wrapping
 * it: what a double click on the edge of its header sets. Text fields are measured with their own font (a field
 * is as wide as its cell, so its box says nothing about its text); chips are added up. Whatever surrounds the
 * content — the cell's padding, a grip or a button beside the field — is what the cell has over the content now.
 */
export function fitColumn(table: HTMLTableElement, index: number): number {
  const ctx = document.createElement("canvas").getContext("2d");
  const px = (value: string) => parseFloat(value) || 0;
  const textWidth = (text: string, el: Element) => {
    if (!ctx) return 0;
    const cs = getComputedStyle(el);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return Math.max(0, ...text.split("\n").map((line) => ctx.measureText(line).width));
  };
  const width = (el: Element) => el.getBoundingClientRect().width;

  const cells = [...table.rows]
    .filter((row) => row.hasAttribute("data-grid-row") || row.parentElement?.tagName === "THEAD")
    .map((row) => row.cells[index])
    .filter((cell): cell is HTMLTableCellElement => !!cell);

  let need = 0;
  for (const cell of cells) {
    const around = (inner: Element) => width(cell) - width(inner);

    // the «Abrir» pill sits over the end of the title when the row is hovered: leave it room
    const pill = cell.querySelector<HTMLElement>(".db-open-btn");
    const room = pill ? pill.offsetWidth + 8 : 0;

    for (const field of cell.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "textarea, input:not([type]), input[type=text], input[type=number]",
    )) {
      const cs = getComputedStyle(field);
      const own =
        px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth);
      need = Math.max(need, textWidth(field.value, field) + own + around(field) + room + 2);
    }

    // a header: its icon and name, plus the padding round them (the name is as wide as its text, not as its cell)
    const name = cell.querySelector<HTMLElement>(".db-prop-name");
    if (name) {
      const ncs = getComputedStyle(name);
      const ccs = getComputedStyle(cell);
      const parts = [...name.children];
      const content =
        parts.reduce(
          (sum, part) =>
            sum +
            (part.classList.contains("db-prop-label")
              ? textWidth(part.textContent ?? "", part)
              : width(part)),
          0,
        ) +
        px(ncs.columnGap) * (parts.length - 1);
      const padding =
        px(ncs.paddingLeft) + px(ncs.paddingRight) + px(ccs.paddingLeft) + px(ccs.paddingRight);
      need = Math.max(need, content + padding + HEADER_SLACK);
    }

    const chips = [...cell.querySelectorAll<HTMLElement>(".db-chip, .db-select-chip")];
    const row = chips[0]?.parentElement;
    if (row) {
      const cs = getComputedStyle(row);
      const gap = px(cs.columnGap);
      const content =
        chips.reduce((sum, chip) => sum + chip.offsetWidth, 0) + gap * (chips.length - 1);
      need = Math.max(need, content + px(cs.paddingLeft) + px(cs.paddingRight) + around(row));
    }

    if (cell.querySelector("input[type=date]")) need = Math.max(need, DATE_CELL_MIN);
  }
  return Math.ceil(need);
}
