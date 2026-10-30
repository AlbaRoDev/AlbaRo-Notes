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

/** `moveItem` for several ids at once: `moved` keep their relative order and land together next to `target`. */
export function moveItems(
  items: string[],
  moved: string[],
  target: string,
  after: boolean,
): string[] {
  const block = items.filter((o) => moved.includes(o));
  if (block.length < 2)
    return block.length === 1 ? moveItem(items, block[0], target, after) : items;
  if (block.includes(target) || !items.includes(target)) return items;
  const rest = items.filter((o) => !block.includes(o));
  rest.splice(rest.indexOf(target) + (after ? 1 : 0), 0, ...block);
  return rest.every((o, i) => o === items[i]) ? items : rest;
}
