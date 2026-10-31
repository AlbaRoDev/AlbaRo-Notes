const ATTR = "data-find";

/** Lower case and without accents, so «tarea» finds «Tárea». */
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** What a cell shows: the text typed in its fields (a title, a number) and the text around them (an option, a tag). */
function cellText(cell: HTMLElement): string {
  const typed = [
    ...cell.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
  ]
    .filter((field) => field.type !== "checkbox")
    .map((field) => field.value);
  return [...typed, cell.textContent ?? ""].join(" ");
}

/** The cells of the database tables under `root` that have the words — the page's own search only reaches its text. */
export function findCells(root: HTMLElement, query: string): HTMLElement[] {
  const needle = fold(query.trim());
  if (!needle) return [];
  return [...root.querySelectorAll<HTMLElement>("table.db-table tbody td")].filter((cell) =>
    fold(cellText(cell)).includes(needle),
  );
}

/** Tints every found cell, the one shown (`current`, an index or -1 for none) stronger. */
export function markCells(cells: HTMLElement[], current: number) {
  cells.forEach((cell, i) => cell.setAttribute(ATTR, i === current ? "current" : "match"));
}

export function clearCells(root: HTMLElement | null) {
  root?.querySelectorAll(`[${ATTR}]`).forEach((cell) => cell.removeAttribute(ATTR));
}

/** The found cells and which one is shown (`at`, -1 while it is one of the page's own matches), for React to read. */
export function createCellHits() {
  let snapshot = { cells: [] as HTMLElement[], at: -1 };
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    get: () => snapshot,
    set(cells: HTMLElement[], at: number) {
      snapshot = { cells, at };
      listeners.forEach((listener) => listener());
    },
  };
}
