/**
 * The list after dragging `from` onto `target` (an option, a row id…): just before it, or just after it when `after`.
 * Returns the same array when nothing would move (dropped on itself, or into the place it already has), so callers
 * can skip the write.
 */
export function moveItem(items: string[], from: string, target: string, after: boolean): string[] {
  if (from === target || !items.includes(from) || !items.includes(target)) return items;
  const rest = items.filter((o) => o !== from);
  rest.splice(rest.indexOf(target) + (after ? 1 : 0), 0, from);
  return rest.every((o, i) => o === items[i]) ? items : rest;
}
