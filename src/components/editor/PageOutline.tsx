import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import "./PageOutline.css";

interface Heading {
  pos: number;
  level: number;
  text: string;
}

/** The page's headings (not its title, the first block), in order. */
function collectHeadings(editor: Editor): Heading[] {
  const found: Heading[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return true;
    const text = node.textContent.trim();
    if (pos > 0 && text) found.push({ pos, level: Number(node.attrs.level) || 1, text });
    return false;
  });
  return found;
}

/** Below this much width the page's own text is too near the edge for the outline to fit beside it. */
const MIN_ZONE = 760;
/** How far below the top of the window a heading counts as the one being read. */
const READING_LINE = 150;

/**
 * Notion's outline of the page: a slim column of dashes at the edge of the page zone, one per heading (the higher
 * the level, the longer), the one being read in bold. Pointing at it opens the list of titles; one click goes there.
 * Drawn on the body (the page column clips what is fixed to it) and placed from the column's own box.
 */
export function PageOutline({
  editor,
  wrapperRef,
}: {
  editor: Editor;
  wrapperRef: RefObject<HTMLDivElement | null>;
}) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ right: number; roomy: boolean } | null>(null);

  // The headings follow the document (a loaded page counts too: it comes as a transaction).
  useEffect(() => {
    let timer = 0;
    const update = () => setHeadings(collectHeadings(editor));
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 150);
    };
    timer = window.setTimeout(update, 0);
    editor.on("transaction", onTransaction);
    return () => {
      window.clearTimeout(timer);
      editor.off("transaction", onTransaction);
    };
  }, [editor]);

  // Beside the page zone: its right edge, and whether it is wide enough to hold the outline.
  useEffect(() => {
    const column = wrapperRef.current?.closest(".page-column");
    if (!column) return;
    const measure = () => {
      const box = column.getBoundingClientRect();
      setPlace({
        right: Math.max(6, window.innerWidth - box.right + 8),
        roomy: box.width >= MIN_ZONE,
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [wrapperRef]);

  // The heading being read: the last one that has reached the reading line.
  useEffect(() => {
    let frame = 0;
    const spy = () => {
      frame = 0;
      let current = 0;
      headings.forEach((h, i) => {
        const dom = editor.view.nodeDOM(h.pos);
        if (!(dom instanceof HTMLElement) || dom.offsetParent === null) return;
        if (dom.getBoundingClientRect().top <= READING_LINE) current = i;
      });
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(spy);
    };
    schedule();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [editor, headings]);

  if (!place?.roomy || headings.length < 2) return null;

  const go = (heading: Heading) => {
    const at = editor.view.domAtPos(heading.pos + 1).node;
    const el = at instanceof Element ? at : at.parentElement;
    el?.closest("h1, h2, h3, h4")?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return createPortal(
    <nav className="page-outline" style={{ right: place.right }} aria-label="Índice de la página">
      <div className="page-outline-dashes" aria-hidden="true">
        {headings.map((h, i) => (
          <span
            key={h.pos}
            className="page-outline-dash"
            data-level={h.level}
            data-active={i === active || undefined}
          />
        ))}
      </div>
      <div className="page-outline-panel">
        {headings.map((h, i) => (
          <button
            key={h.pos}
            type="button"
            data-active={i === active || undefined}
            style={{ paddingLeft: 8 + (h.level - 1) * 14 }}
            onClick={() => go(h)}
          >
            {h.text}
          </button>
        ))}
      </div>
    </nav>,
    document.body,
  );
}
