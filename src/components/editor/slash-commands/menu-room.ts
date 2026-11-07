/** Never smaller than a couple of rows: with less than this the list scrolls instead of vanishing. */
const MIN_ROOM = 88;
const BREATHING = 12;

/**
 * The height a floating list can have on the side of the cursor it opened on: all the room above it, or all the
 * room below it up to the window's foot, less the bar that sits over the keyboard.
 */
export function menuRoom(
  placement: string,
  cursor: { top: number; bottom: number },
  windowHeight: number,
  barHeight: number,
): number {
  const room = placement.startsWith("top") ? cursor.top : windowHeight - barHeight - cursor.bottom;
  return Math.max(MIN_ROOM, room - BREATHING);
}
