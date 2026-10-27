import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  Eraser,
  Hand,
  ImagePlus,
  Loader2,
  Pencil,
  Redo2,
  Trash2,
  Type,
  Undo2,
  Scan,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { aiReadHandwriting } from "../../lib/ai-client";
import { errorMessage, storeAttachment } from "../../lib/attachments";
import {
  CANVAS_COLORS,
  CANVAS_WIDTH,
  COORD_LIMIT,
  FULL_VIEW,
  MAX_CANVAS_COORDS,
  MAX_HEIGHT,
  MAX_STROKES,
  MAX_STROKE_COORDS,
  MIN_HEIGHT,
  MIN_ZOOM,
  PEN_WIDTHS,
  clamp,
  cleanHeight,
  clampView,
  fitView,
  grownHeight,
  rasterize,
  rasterizeBlob,
  round1,
  strokeHit,
  strokePath,
  totalCoords,
  viewBoxOf,
  zoomAt,
  type CanvasColor,
  type Stroke,
  type View,
} from "./canvas-strokes";
import "./canvas.css";

type Tool = "pen" | "eraser" | "hand";
type Phase = "canvas" | "reading" | "review" | "imaging";
/** A stroke being drawn: kept as a path string, so a long stroke isn't copied on every move. */
type Live = { color: CanvasColor; width: number; d: string };

const ERASER_RADIUS = 14;
/** Points closer than this (in the 1000-wide space) to the last one add nothing to a stroke. */
const MIN_STEP = 0.8;
const ZOOM_STEP = 1.5;
const RESIZE_STEP = 40;

/**
 * The canvas block: one canvas that always keeps its ink (like an iPad notes app), to take
 * handwritten notes (it grows as you write) or sketch diagrams (zoom and pan). The ink can be
 * converted whenever the user wants — to text, read by the AI's vision model and shown for
 * correction first, or to an image block — and the drawing stays unless they replace it.
 */
export function CanvasBlockView({
  node,
  updateAttributes,
  deleteNode,
  editor,
  getPos,
}: NodeViewProps) {
  const strokes = node.attrs.strokes as Stroke[];
  const height = cleanHeight(node.attrs.height);

  const [tool, setTool] = useState<Tool>("pen");
  const [spaceDown, setSpaceDown] = useState(false);
  const [focused, setFocused] = useState(false); // while focused, the wheel moves around the sheet
  const [color, setColor] = useState<CanvasColor>("ink");
  const [penWidth, setPenWidth] = useState(PEN_WIDTHS[0].width);
  const [view, setView] = useState<View>(FULL_VIEW);
  const [live, setLive] = useState<Live | null>(null);
  const [hidden, setHidden] = useState<Set<number>>(new Set()); // strokes the eraser has touched, until the drag ends
  const [dragHeight, setDragHeight] = useState<number | null>(null); // while the resize handle is dragged
  const [history, setHistory] = useState<{ undo: Stroke[][]; redo: Stroke[][] }>({
    undo: [],
    redo: [],
  });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("canvas");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const drawing = useRef<{ points: number[]; color: CanvasColor; width: number } | null>(null);
  const erasing = useRef<Set<number> | null>(null);
  const panning = useRef<{ x: number; y: number; view: View } | null>(null);
  const readToken = useRef(0);
  // what the native wheel listener needs (it is attached once, outside React's render)
  const current = useRef({ view, height });
  useEffect(() => {
    current.current = { view, height };
  });

  const shownHeight = dragHeight ?? height;
  const panMode = tool === "hand" || spaceDown;
  const canvasReady = phase === "canvas";

  const remove = () => {
    deleteNode();
    editor.commands.focus();
  };

  // ---- every change to the drawing is one write to the node (never one per point)
  const commit = (next: Stroke[], extra?: { height?: number }) => {
    setHistory((h) => ({ undo: [...h.undo.slice(-99), strokes], redo: [] }));
    updateAttributes({ strokes: next, ...extra });
  };
  const undo = () => {
    const previous = history.undo[history.undo.length - 1];
    if (!previous) return;
    setHistory((h) => ({ undo: h.undo.slice(0, -1), redo: [...h.redo, strokes] }));
    updateAttributes({ strokes: previous });
  };
  const redo = () => {
    const next = history.redo[history.redo.length - 1];
    if (!next) return;
    setHistory((h) => ({ undo: [...h.undo, strokes], redo: h.redo.slice(0, -1) }));
    updateAttributes({ strokes: next });
  };

  // ---- the view: zoom (Ctrl+wheel / pinch / buttons) and pan (hand, Space, middle button, wheel when zoomed)
  const zoomBy = (factor: number) =>
    setView((v) =>
      zoomAt(v, factor, v.x + CANVAS_WIDTH / v.zoom / 2, v.y + height / v.zoom / 2, height),
    );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      // only with the focus: the wheel is for moving around the sheet once the user is working
      // on it, and scrolls the page as usual otherwise (Esc, or clicking elsewhere, gives it back)
      if (document.activeElement !== svg) return;
      const { view: v, height: h } = current.current;
      const rect = svg.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+wheel and a trackpad pinch (which browsers send as Ctrl+wheel)
        e.preventDefault();
        const px = v.x + ((e.clientX - rect.left) / rect.width) * (CANVAS_WIDTH / v.zoom);
        const py = v.y + ((e.clientY - rect.top) / rect.height) * (h / v.zoom);
        setView((cur) => zoomAt(cur, Math.exp(-e.deltaY * 0.01), px, py, h));
      } else {
        // the wheel moves around the sheet (Shift: sideways), which has no edges to run into
        e.preventDefault();
        const perPx = CANVAS_WIDTH / v.zoom / rect.width;
        setView((cur) =>
          clampView(
            {
              ...cur,
              x: cur.x + (e.shiftKey ? e.deltaY : e.deltaX) * perPx,
              y: cur.y + (e.shiftKey ? 0 : e.deltaY) * perPx,
            },
            h,
          ),
        );
      }
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [phase]);

  /** Where the pointer is on the sheet, in drawing units (the visible part is `view`). */
  const toPage = (e: { clientX: number; clientY: number }): [number, number] => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = view.x + ((e.clientX - rect.left) / rect.width) * (CANVAS_WIDTH / view.zoom);
    const y = view.y + ((e.clientY - rect.top) / rect.height) * (shownHeight / view.zoom);
    return [
      round1(clamp(x, -COORD_LIMIT, COORD_LIMIT)),
      round1(clamp(y, -COORD_LIMIT, COORD_LIMIT)),
    ];
  };

  const eraseAt = (x: number, y: number) => {
    const set = erasing.current;
    if (!set) return;
    const before = set.size;
    strokes.forEach((s, i) => {
      if (!set.has(i) && strokeHit(s, x, y, ERASER_RADIUS / view.zoom)) set.add(i);
    });
    if (set.size !== before) setHidden(new Set(set));
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!canvasReady) return;
    const middle = e.pointerType === "mouse" && e.button === 1;
    if (e.pointerType === "mouse" && e.button !== 0 && !middle) return;
    e.preventDefault(); // no mouse events after this: the editor never sees a click inside the canvas
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // keeps the stroke going outside the canvas
    } catch {
      /* the pointer is no longer active: the stroke still works inside the canvas */
    }
    e.currentTarget.focus();
    setError(null); // a failed reading is old news once the user is writing again
    if (panMode || middle) {
      panning.current = { x: e.clientX, y: e.clientY, view };
      return;
    }
    const [x, y] = toPage(e);
    if (tool === "eraser") {
      erasing.current = new Set();
      eraseAt(x, y);
      return;
    }
    if (strokes.length >= MAX_STROKES || totalCoords(strokes) + 2 > MAX_CANVAS_COORDS) {
      setNote("El lienzo está lleno: borra algo para seguir.");
      return;
    }
    setNote(null);
    drawing.current = { points: [x, y], color, width: penWidth };
    setLive({ color, width: penWidth, d: strokePath([x, y]) });
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const pan = panning.current;
    if (pan) {
      const rect = svgRef.current!.getBoundingClientRect();
      const perPx = CANVAS_WIDTH / pan.view.zoom / rect.width;
      setView(
        clampView(
          {
            ...pan.view,
            x: pan.view.x - (e.clientX - pan.x) * perPx,
            y: pan.view.y - (e.clientY - pan.y) * perPx,
          },
          height,
        ),
      );
      return;
    }
    const pen = drawing.current;
    if (!pen && !erasing.current) return;
    // coalesced events keep fast handwriting smooth
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of events.length > 0 ? events : [e.nativeEvent]) {
      const [x, y] = toPage(ev);
      if (erasing.current) {
        eraseAt(x, y);
      } else if (pen && pen.points.length < MAX_STROKE_COORDS - 2) {
        const [lx, ly] = [pen.points[pen.points.length - 2], pen.points[pen.points.length - 1]];
        if (Math.hypot(x - lx, y - ly) >= MIN_STEP / view.zoom) pen.points.push(x, y);
      }
    }
    if (pen) setLive({ color: pen.color, width: pen.width, d: strokePath(pen.points) });
  };

  const onPointerUp = () => {
    panning.current = null;
    const pen = drawing.current;
    drawing.current = null;
    setLive(null);
    if (pen) {
      // the window grows when the stroke ends near its bottom edge, so notes never run out of room
      const grown = grownHeight(height, pen.points, view);
      commit(
        [...strokes, { color: pen.color, width: pen.width, points: pen.points }],
        grown !== height ? { height: grown } : undefined,
      );
    }
    const erased = erasing.current;
    erasing.current = null;
    setHidden(new Set());
    if (erased && erased.size > 0) commit(strokes.filter((_, i) => !erased.has(i)));
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "Escape") {
      e.currentTarget.blur(); // gives the wheel back to the page
      return;
    }
    if (e.key === " " && !e.ctrlKey && !e.metaKey) {
      setSpaceDown(true); // hold Space and drag to move around, as in most drawing apps
      e.preventDefault();
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) undo();
    else if (key === "y" || (key === "z" && e.shiftKey)) redo();
    else if (key === "+" || key === "=") zoomBy(ZOOM_STEP);
    else if (key === "-") zoomBy(1 / ZOOM_STEP);
    else if (key === "0") zoomBy(1 / view.zoom);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  // ---- the block's height: dragging the handle, or ↑/↓ with it focused
  const setHeight = (next: number) =>
    updateAttributes({ height: clamp(Math.round(next), MIN_HEIGHT, MAX_HEIGHT) });
  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    const [startY, startHeight, perPx] = [e.clientY, height, CANVAS_WIDTH / rect.width];
    const handle = e.currentTarget;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is no longer active: the drag still works over the handle */
    }
    const move = (ev: PointerEvent) =>
      setDragHeight(
        clamp(Math.round(startHeight + (ev.clientY - startY) * perPx), MIN_HEIGHT, MAX_HEIGHT),
      );
    const up = (ev: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setDragHeight(null);
      setHeight(startHeight + (ev.clientY - startY) * perPx);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  const onHandleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? RESIZE_STEP * 3 : RESIZE_STEP;
    if (e.key === "ArrowDown") setHeight(height + step);
    else if (e.key === "ArrowUp") setHeight(height - step);
    else return;
    e.preventDefault();
  };

  // ---- converting the ink
  const toText = () => {
    if (strokes.length === 0) {
      setNote("Escribe algo primero.");
      return;
    }
    setError(null);
    setNote(null);
    setPhase("reading");
    const token = ++readToken.current;
    let image: string;
    try {
      image = rasterize(strokes).split(",")[1];
    } catch (e) {
      setError(errorMessage(e));
      setPhase("canvas");
      return;
    }
    aiReadHandwriting(image).then(
      (recognised) => {
        if (token !== readToken.current) return;
        setText(recognised);
        setPhase("review");
      },
      (e) => {
        if (token !== readToken.current) return;
        setError(errorMessage(e));
        setPhase("canvas");
      },
    );
  };

  const backToCanvas = () => {
    readToken.current++; // an answer still on its way is ignored
    setPhase("canvas");
  };

  const paragraphs = () =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 200)
      .map((line) => ({
        type: "paragraph",
        content: [{ type: "text", text: line.slice(0, 2000) }],
      }));

  /** Puts the recognised text below the canvas (which stays) or in its place. */
  const insertText = (replace: boolean) => {
    const pos = getPos();
    const content = paragraphs();
    if (typeof pos !== "number" || content.length === 0) return;
    const end = pos + node.nodeSize;
    editor
      .chain()
      .focus()
      .insertContentAt(replace ? { from: pos, to: end } : end, content)
      .run();
    if (!replace) backToCanvas();
  };

  /** The ink as an image block below the canvas (the drawing stays). */
  const toImage = async () => {
    if (strokes.length === 0) {
      setNote("Dibuja algo primero.");
      return;
    }
    const pos = getPos();
    if (typeof pos !== "number") return;
    setError(null);
    setNote(null);
    setPhase("imaging");
    try {
      const blob = await rasterizeBlob(strokes);
      const file = new File([blob], "Dibujo.png", { type: "image/png" });
      const stored = await storeAttachment(file);
      const end = pos + node.nodeSize;
      // a line after the image keeps the cursor from being stranded when the canvas was the last block
      const closing = editor.state.doc.nodeAt(end) ? [] : [{ type: "paragraph" }];
      editor
        .chain()
        .focus()
        .insertContentAt(end, [
          { type: "image", attrs: { file: stored.file, name: file.name, size: stored.size } },
          ...closing,
        ])
        .run();
      setNote("Imagen insertada debajo.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPhase("canvas");
    }
  };

  const busy = phase === "reading" || phase === "imaging";
  const zoomLabel = `${Math.round(view.zoom * 100)} %`;
  // zoomed far out, ink never gets thinner than a visible hairline (what is saved is unchanged)
  const minShown = 2.5 / view.zoom;

  return (
    <NodeViewWrapper className="canvas-block" contentEditable={false}>
      <div className="canvas-bar" role="toolbar" aria-label="Lienzo">
        <span className="canvas-title">Lienzo</span>
        <button
          type="button"
          aria-pressed={tool === "pen" && !spaceDown}
          title="Lápiz"
          aria-label="Lápiz"
          disabled={!canvasReady}
          onClick={() => setTool("pen")}
        >
          <Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-pressed={tool === "eraser"}
          title="Goma (quita el trazo entero)"
          aria-label="Goma"
          disabled={!canvasReady}
          onClick={() => setTool("eraser")}
        >
          <Eraser size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-pressed={tool === "hand"}
          title="Mano: mover el lienzo (o mantén Espacio)"
          aria-label="Mano"
          disabled={!canvasReady}
          onClick={() => setTool("hand")}
        >
          <Hand size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {(Object.keys(CANVAS_COLORS) as CanvasColor[]).map((c) => (
          <button
            key={c}
            type="button"
            className="canvas-swatch"
            style={{ color: CANVAS_COLORS[c].css }}
            aria-pressed={tool === "pen" && color === c}
            title={CANVAS_COLORS[c].label}
            aria-label={`Color: ${CANVAS_COLORS[c].label}`}
            disabled={!canvasReady}
            onClick={() => {
              setColor(c);
              setTool("pen");
            }}
          />
        ))}
        {PEN_WIDTHS.map(({ width, label }) => (
          <button
            key={width}
            type="button"
            className="canvas-width"
            aria-pressed={tool === "pen" && penWidth === width}
            title={`Trazo ${label.toLowerCase()}`}
            aria-label={`Trazo ${label.toLowerCase()}`}
            disabled={!canvasReady}
            onClick={() => {
              setPenWidth(width);
              setTool("pen");
            }}
          >
            <span style={{ width: width + 2, height: width + 2 }} />
          </button>
        ))}
        <button
          type="button"
          title="Deshacer (Ctrl+Z)"
          aria-label="Deshacer"
          disabled={!canvasReady || history.undo.length === 0}
          onClick={undo}
        >
          <Undo2 size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          title="Rehacer (Ctrl+Mayús+Z)"
          aria-label="Rehacer"
          disabled={!canvasReady || history.redo.length === 0}
          onClick={redo}
        >
          <Redo2 size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          title="Borrar todo"
          aria-label="Borrar todo"
          disabled={!canvasReady || strokes.length === 0}
          onClick={() => commit([])}
        >
          <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          title="Alejar (Ctrl+−)"
          aria-label="Alejar"
          disabled={!canvasReady || view.zoom <= MIN_ZOOM}
          onClick={() => zoomBy(1 / ZOOM_STEP)}
        >
          <ZoomOut size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="canvas-zoom"
          title="Volver al 100 % (Ctrl+0)"
          aria-label={`Zoom ${zoomLabel}: volver al 100 %`}
          disabled={!canvasReady || view.zoom === 1}
          onClick={() => zoomBy(1 / view.zoom)}
        >
          {zoomLabel}
        </button>
        <button
          type="button"
          title="Acercar (Ctrl++, o Ctrl+rueda)"
          aria-label="Acercar"
          disabled={!canvasReady}
          onClick={() => zoomBy(ZOOM_STEP)}
        >
          <ZoomIn size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          title="Ver todo lo dibujado"
          aria-label="Ver todo"
          disabled={!canvasReady || strokes.length === 0}
          onClick={() => setView(fitView(strokes, height))}
        >
          <Scan size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <span className="canvas-bar-end">
          <button
            type="button"
            className="canvas-convert"
            title="Leer la escritura con la IA y pasarla a texto"
            disabled={!canvasReady}
            onClick={toText}
          >
            <Type size={15} strokeWidth={1.75} aria-hidden="true" /> A texto
          </button>
          <button
            type="button"
            className="canvas-convert"
            title="Insertar el dibujo como imagen debajo"
            disabled={!canvasReady}
            onClick={() => void toImage()}
          >
            <ImagePlus size={15} strokeWidth={1.75} aria-hidden="true" /> A imagen
          </button>
          {confirmRemove ? (
            <>
              <span>¿Quitar{strokes.length > 0 ? " (se pierde lo dibujado)" : ""}?</span>
              <button type="button" onClick={remove}>
                Sí, quitar
              </button>
              <button type="button" onClick={() => setConfirmRemove(false)}>
                No
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => (strokes.length > 0 ? setConfirmRemove(true) : remove())}
            >
              Quitar
            </button>
          )}
        </span>
      </div>

      {phase === "review" ? (
        <div className="canvas-review">
          <p>Esto es lo que he leído. Corrígelo si hace falta antes de usarlo.</p>
          <textarea
            autoFocus
            rows={Math.min(12, Math.max(4, text.split("\n").length + 1))}
            maxLength={20_000}
            value={text}
            aria-label="Texto reconocido"
            onChange={(e) => setText(e.target.value)}
          />
          <div className="canvas-review-actions">
            <button
              type="button"
              className="canvas-done"
              disabled={!text.trim()}
              onClick={() => insertText(false)}
            >
              Insertar debajo (conservar el dibujo)
            </button>
            <button type="button" disabled={!text.trim()} onClick={() => insertText(true)}>
              Reemplazar el dibujo por el texto
            </button>
            <button type="button" onClick={backToCanvas}>
              Volver al lienzo
            </button>
          </div>
        </div>
      ) : (
        <div className="canvas-stage" data-busy={busy || undefined}>
          <svg
            ref={svgRef}
            className="canvas-surface"
            data-tool={panMode ? "hand" : tool}
            viewBox={viewBoxOf(view, shownHeight)}
            style={{ aspectRatio: `${CANVAS_WIDTH} / ${shownHeight}` }}
            tabIndex={0}
            role="img"
            aria-label="Lienzo"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
            onKeyUp={(e) => e.key === " " && setSpaceDown(false)}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setSpaceDown(false);
              setFocused(false);
            }}
            // the middle button drags the sheet: without this the browser starts its auto-scroll
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            onAuxClick={(e) => e.preventDefault()}
          >
            {strokes.map((s, i) =>
              hidden.has(i) ? null : (
                <path
                  key={i}
                  d={strokePath(s.points)}
                  fill="none"
                  stroke={CANVAS_COLORS[s.color].css}
                  strokeWidth={Math.max(s.width, minShown)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ),
            )}
            {live && (
              <path
                d={live.d}
                fill="none"
                stroke={CANVAS_COLORS[live.color].css}
                strokeWidth={Math.max(live.width, minShown)}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>
          {focused && !busy && (
            <p className="canvas-hint">
              Rueda: moverse · Ctrl+rueda: zoom · Botón central o Espacio: arrastrar · Esc: soltar
              el foco
            </p>
          )}
          {busy && (
            <div className="canvas-reading" role="status">
              <Loader2 size={16} className="canvas-spin" aria-hidden="true" />
              {phase === "reading" ? " Leyendo tu letra…" : " Preparando la imagen…"}
              {phase === "reading" && (
                <button type="button" onClick={backToCanvas}>
                  Cancelar
                </button>
              )}
            </div>
          )}
          <div
            className="canvas-resize"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Altura del lienzo"
            aria-valuemin={MIN_HEIGHT}
            aria-valuemax={MAX_HEIGHT}
            aria-valuenow={shownHeight}
            tabIndex={0}
            title="Arrastra para cambiar la altura (o usa ↑ ↓)"
            onPointerDown={onHandleDown}
            onKeyDown={onHandleKey}
          />
        </div>
      )}
      {note && <p className="canvas-note">{note}</p>}
      {error && (
        <p className="canvas-note canvas-error" role="alert">
          {error}
        </p>
      )}
    </NodeViewWrapper>
  );
}
