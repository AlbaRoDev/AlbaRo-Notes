export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const claimed = new WeakSet<Event>();
const STEP = 4; // pixels of movement before a press becomes a drag (a plain click is left alone)
const EDGE = 32; // near the top or bottom of the scroll area, the page scrolls under the band

/** The blank space around a page's text: the zone, the page column and the editor's own padding. */
export const isPageBlank = (t: Element) =>
  t.matches(
    ".app-layout, .page-column, .container, .manager, .tasks, .page-editor-wrapper, .page-editor, .ProseMirror",
  );

export const hits = (el: Element, box: Box) => {
  const r = el.getBoundingClientRect();
  return r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top;
};

function scrollParent(el: Element | null): HTMLElement {
  for (; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight)
      return el as HTMLElement;
  }
  return document.documentElement;
}

/**
 * Notion's rubber band: from a press on blank space, dragging draws a box and `onBox` gets it (in client
 * pixels) on every change. Only the first caller for an event takes it. `onEnd` runs on release with whether
 * a drag ever happened.
 */
export function startMarquee(
  down: MouseEvent,
  onBox: (box: Box) => void,
  onEnd?: (dragged: boolean) => void,
) {
  if (down.button !== 0 || claimed.has(down)) return;
  claimed.add(down);

  const scroller = scrollParent(down.target as Element);
  // The anchor is kept in scroll coordinates so it stays on its content while the page scrolls.
  const ax = down.clientX + scroller.scrollLeft;
  const ay = down.clientY + scroller.scrollTop;
  let x = down.clientX;
  let y = down.clientY;
  let band: HTMLDivElement | null = null;
  let frame = 0;

  const update = () => {
    const sx = ax - scroller.scrollLeft;
    const sy = ay - scroller.scrollTop;
    if (!band && Math.hypot(x - sx, y - sy) < STEP) return;
    if (!band) {
      band = document.createElement("div");
      band.className = "marquee-band";
      document.body.append(band);
      document.body.dataset.marquee = "";
      getSelection()?.removeAllRanges();
      (document.activeElement as HTMLElement | null)?.blur();
      frame = requestAnimationFrame(tick);
    }
    const box = {
      left: Math.min(sx, x),
      top: Math.min(sy, y),
      right: Math.max(sx, x),
      bottom: Math.max(sy, y),
    };
    Object.assign(band.style, {
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.right - box.left}px`,
      height: `${box.bottom - box.top}px`,
    });
    onBox(box);
  };

  const tick = () => {
    const area =
      scroller === document.documentElement
        ? { top: 0, bottom: innerHeight }
        : scroller.getBoundingClientRect();
    if (y < area.top + EDGE) scroller.scrollTop -= 14;
    else if (y > area.bottom - EDGE) scroller.scrollTop += 14;
    update();
    frame = requestAnimationFrame(tick);
  };

  const move = (e: MouseEvent) => {
    x = e.clientX;
    y = e.clientY;
    update();
  };
  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    cancelAnimationFrame(frame);
    const dragged = band !== null;
    band?.remove();
    delete document.body.dataset.marquee;
    onEnd?.(dragged);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}
