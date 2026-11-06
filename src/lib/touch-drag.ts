/**
 * Drag and drop with a finger. Every drag in the app is written against HTML5 drag events (`draggable`,
 * `onDragStart`/`onDragOver`/`onDrop`, `lib/drag-item.ts`), which a touch screen does not fire reliably. Instead of
 * rewriting each of them, a finger that rests on a `draggable` element for a moment (and does not move: moving is
 * scrolling) starts a drag that this module plays out as the same events, with a real `DataTransfer`, on whatever
 * lies under the finger. Sources and targets cannot tell it from a mouse.
 *
 * Touch events, not pointer events, on purpose: when the browser takes a gesture over for scrolling it cancels the
 * pointer sequence, while touch events keep arriving and can be cancelled. Cancel a drag with back or Escape.
 */
/** How long the finger rests before the drag starts. */
const LONG_PRESS_MS = 350;
/** How far it may wander meanwhile (CSS px): further is a swipe, so a scroll. */
export const SLOP = 10;
const EDGE = 56;
const MAX_SCROLL = 18;
const TICK_MS = 50;

export const exceedsSlop = (dx: number, dy: number): boolean => dx * dx + dy * dy > SLOP * SLOP;

/**
 * px to scroll per tick for a finger at `pos` in a box `lo`..`hi`: negative near the start, positive near the end,
 * faster closer to the edge. The zones are at most a quarter of the box each, so in a narrow box (a board squeezed
 * by a panel) the middle half stays still instead of the two zones swallowing it.
 */
export function edgeSpeed(pos: number, lo: number, hi: number): number {
  const zone = Math.min(EDGE, (hi - lo) / 4);
  if (pos < lo + zone) return -Math.ceil(MAX_SCROLL * Math.min(1, (lo + zone - pos) / zone));
  if (pos > hi - zone) return Math.ceil(MAX_SCROLL * Math.min(1, (pos - (hi - zone)) / zone));
  return 0;
}

interface Drag {
  source: Element;
  data: DataTransfer;
  ghost: HTMLElement;
  over: Element | null;
  accepted: boolean;
  x: number;
  y: number;
  release: () => void;
  timer: number;
}

let drag: Drag | null = null;

function fire(type: string, target: Element, d: Drag, related?: Element | null): boolean {
  const e = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    dataTransfer: d.data,
    clientX: d.x,
    clientY: d.y,
    relatedTarget: related ?? null,
  });
  target.dispatchEvent(e);
  return e.defaultPrevented;
}

/** The window scrolls through the root element, whatever its `overflow` says (on a phone the page itself often scrolls). */
function scrollable(el: Element, axis: "x" | "y"): boolean {
  const style = getComputedStyle(el);
  const overflow = axis === "y" ? style.overflowY : style.overflowX;
  const [size, client] =
    axis === "y" ? [el.scrollHeight, el.clientHeight] : [el.scrollWidth, el.clientWidth];
  return (el === document.documentElement || /auto|scroll/.test(overflow)) && size > client + 1;
}

/** The nearest scrollable ancestor that can still move the way the finger pushes, and by how much. */
function autoscroll(d: Drag, under: Element | null) {
  for (const axis of ["y", "x"] as const) {
    for (let el = under; el; el = el.parentElement) {
      if (!scrollable(el, axis)) continue;
      const box =
        el === document.documentElement
          ? { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth }
          : el.getBoundingClientRect();
      const [pos, lo, hi, at, max] =
        axis === "y"
          ? [d.y, box.top, box.bottom, el.scrollTop, el.scrollHeight - el.clientHeight]
          : [d.x, box.left, box.right, el.scrollLeft, el.scrollWidth - el.clientWidth];
      const speed = edgeSpeed(pos, lo, hi);
      if (speed === 0 || (speed < 0 && at <= 0) || (speed > 0 && at >= max)) continue;
      el.scrollBy(axis === "x" ? { left: speed } : { top: speed });
      break;
    }
  }
}

/** Tells the element under the finger that the drag is over it (and the one it left that it is gone). */
function hover(d: Drag) {
  const el = document.elementFromPoint(d.x, d.y); // the ghost lets touches through
  if (el !== d.over) {
    if (d.over) fire("dragleave", d.over, d, el);
    if (el) fire("dragenter", el, d, d.over);
    d.over = el;
  }
  d.accepted = el ? fire("dragover", el, d) : false;
  autoscroll(d, el);
}

function moveGhost(d: Drag) {
  const { width, height } = d.ghost.getBoundingClientRect();
  const left = Math.min(Math.max(d.x - width / 2, 4), window.innerWidth - width - 4);
  d.ghost.style.transform = `translate(${left}px, ${Math.max(d.y - height - 16, 4)}px)`;
}

function finish(d: Drag, drop: boolean) {
  window.clearInterval(d.timer);
  if (drop && d.accepted && d.over) fire("drop", d.over, d);
  else if (d.over) fire("dragleave", d.over, d);
  fire("dragend", d.source, d);
  d.ghost.remove();
  document.documentElement.classList.remove("touch-dragging");
  d.release();
  drag = null;
  // a finger that lifts after dragging must not also «click» whatever is under it
  const swallow = (e: Event) => e.stopPropagation();
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, true), 400);
}

function begin(source: Element, x: number, y: number, pushBack: (close: () => void) => () => void) {
  const data = new DataTransfer();
  const box = source.getBoundingClientRect();
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("id");
  ghost.removeAttribute("draggable");
  ghost.classList.add("touch-drag-ghost");
  ghost.style.width = `${Math.min(box.width, 280)}px`;
  ghost.setAttribute("aria-hidden", "true");
  const d: Drag = {
    source,
    data,
    ghost,
    over: null,
    accepted: false,
    x,
    y,
    release: () => undefined,
    timer: 0,
  };
  if (fire("dragstart", source, d)) return; // the source refused
  // A drawer or sheet over the page hides what the drag is aimed at: lower it, as a tap on its scrim does.
  if (source.closest("[data-drawer], [data-sheet]"))
    document.querySelector<HTMLElement>(".sidebar-scrim, .workspace-scrim")?.click();
  document.body.append(ghost);
  document.documentElement.classList.add("touch-dragging");
  getSelection()?.removeAllRanges();
  navigator.vibrate?.(15);
  moveGhost(d);
  d.release = pushBack(() => finish(d, false));
  d.timer = window.setInterval(() => hover(d), TICK_MS);
  drag = d;
  hover(d);
}

/** Starts listening for touch drags, once. `pushBack` opens a layer for the system's back button (it cancels the drag). */
export function installTouchDrag(pushBack: (close: () => void) => () => void) {
  let press: { source: Element; id: number; x: number; y: number; timer: number } | null = null;
  const endPress = () => {
    if (press) window.clearTimeout(press.timer);
    press = null;
  };
  const find = (e: TouchEvent, id: number) =>
    Array.from(e.changedTouches).find((t) => t.identifier === id);

  document.addEventListener(
    "touchstart",
    (e) => {
      endPress();
      if (drag || e.touches.length !== 1) return; // a second finger is a pinch, not a drag
      const touch = e.touches[0];
      const target = e.target instanceof Element ? e.target : null;
      if (!touch || !target || target.closest("input, textarea, select")) return;
      const source = target.closest('[draggable="true"]');
      if (!source) return;
      press = {
        source,
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        timer: window.setTimeout(() => {
          if (!press) return;
          const { source, x, y } = press;
          press = null;
          begin(source, x, y, pushBack);
        }, LONG_PRESS_MS),
      };
    },
    { passive: true },
  );

  // Not passive, and installed up front: the browser decides at the first touch whether it must wait for the page
  // before scrolling, so a listener added when the drag begins would come too late to hold the scroll back.
  document.addEventListener(
    "touchmove",
    (e) => {
      if (drag) {
        const touch = Array.from(e.changedTouches)[0];
        if (!touch) return;
        e.preventDefault();
        drag.x = touch.clientX;
        drag.y = touch.clientY;
        moveGhost(drag);
        hover(drag);
      } else if (press) {
        const t = find(e, press.id);
        if (!t || exceedsSlop(t.clientX - press.x, t.clientY - press.y)) endPress();
      }
    },
    { passive: false },
  );

  const lifted = (drop: boolean) => (e: TouchEvent) => {
    if (drag) {
      if (drop) {
        const t = Array.from(e.changedTouches)[0];
        if (t) {
          drag.x = t.clientX;
          drag.y = t.clientY;
          hover(drag);
        }
      }
      finish(drag, drop);
    } else endPress();
  };
  document.addEventListener("touchend", lifted(true));
  document.addEventListener("touchcancel", lifted(false));

  // what the system does on its own with a long press (menu, selection, its own drag) must not compete
  document.addEventListener("contextmenu", (e) => (press || drag) && e.preventDefault());
  document.addEventListener("selectstart", (e) => drag && e.preventDefault());
  document.addEventListener(
    "dragstart",
    (e) => {
      if (e.isTrusted && (press || drag)) e.preventDefault();
    },
    true,
  );
  document.addEventListener("keydown", (e) => {
    if (drag && e.key === "Escape") finish(drag, false);
  });
}
