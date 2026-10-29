import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Captions,
  ClipboardCopy,
  Copy,
  Crop,
  Download,
  FileText,
  Maximize2,
  RefreshCw,
  RotateCcw,
  Trash2,
  Type,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  errorMessage,
  MAX_IMAGE_TEXT,
  MAX_IMAGE_WIDTH,
  MIN_IMAGE_WIDTH,
  saveAttachmentAs,
  storeAttachment,
  type ImageAlign,
} from "../../lib/attachments";
import { useAttachmentUrl } from "../../hooks/useAttachmentUrl";
import { focusLineAfterNode } from "./media-commands";
import { cropMime, imageBlob, type CropRect } from "../../lib/image-edit";
import { ImageCrop } from "./ImageCrop";
import { MediaPicker } from "./MediaView";

const ALIGNS: { value: ImageAlign; label: string; Icon: LucideIcon }[] = [
  { value: "left", label: "Alinear a la izquierda", Icon: AlignLeft },
  { value: "center", label: "Centrar", Icon: AlignCenter },
  { value: "right", label: "Alinear a la derecha", Icon: AlignRight },
];

const KEY_STEP = 16;

const clampWidth = (w: number, max: number) =>
  Math.round(
    Math.max(MIN_IMAGE_WIDTH, Math.min(w, MAX_IMAGE_WIDTH, Math.max(max, MIN_IMAGE_WIDTH))),
  );

/**
 * A handle must not start the block's own drag-and-drop: ProseMirror listens on
 * an ancestor, so the native listener on the handle stops the event first.
 */
function noDrag(el: HTMLElement | null) {
  el?.addEventListener("dragstart", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
}

type Resize = { startX: number; start: number; sign: 1 | -1; factor: 1 | 2; max: number };

export function ImageView(props: NodeViewProps) {
  const { node, updateAttributes, deleteNode, editor, getPos, selected } = props;
  const file = node.attrs.file as string;
  const name = (node.attrs.name as string | null) ?? "Imagen";
  const width = node.attrs.width as number | null;
  const align = (node.attrs.align as ImageAlign | null) ?? "left";
  const caption = (node.attrs.caption as string | null) ?? "";
  const alt = (node.attrs.alt as string | null) ?? "";
  const src = useAttachmentUrl(file);

  // The file that failed to load; a replaced file is a different one, so it clears itself.
  const [brokenFile, setBrokenFile] = useState<string | null>(null);
  const broken = brokenFile === file;
  const [replacing, setReplacing] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [busy, setBusy] = useState(false); // a crop is being written
  // Which text field is open. Its draft is local and only reaches the node on
  // Enter / blur — never per keystroke (same rule as every other field).
  const [editing, setEditing] = useState<"caption" | "alt" | null>(null);
  const [draft, setDraft] = useState("");
  // Width while a handle is being dragged: one write to the node, on release.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const shown = dragWidth ?? width;
  const frameRef = useRef<HTMLDivElement>(null);
  const resize = useRef<Resize | null>(null);
  const field = useRef<"caption" | "alt" | null>(null); // also a guard: unmounting the input can blur it again
  const cancelled = useRef(false);

  if (replacing) {
    return <MediaPicker {...props} kind="image" onClose={() => setReplacing(false)} />;
  }

  const startResize = (sign: 1 | -1) => (e: PointerEvent<HTMLElement>) => {
    const frame = frameRef.current;
    if (e.button !== 0 || !frame) return;
    e.preventDefault(); // the editor must never see a click on a handle
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // throws if the pointer is no longer active; the drag then simply doesn't track
    }
    resize.current = {
      startX: e.clientX,
      start: frame.getBoundingClientRect().width,
      sign,
      factor: align === "center" ? 2 : 1, // centred: both edges move
      max: frame.parentElement?.clientWidth ?? MAX_IMAGE_WIDTH,
    };
  };

  const widthAt = (e: PointerEvent) => {
    const r = resize.current;
    return r && clampWidth(r.start + r.sign * (e.clientX - r.startX) * r.factor, r.max);
  };

  const moveResize = (e: PointerEvent) => {
    const w = widthAt(e);
    if (w != null) setDragWidth(w);
  };

  const endResize = (e: PointerEvent) => {
    const w = widthAt(e);
    resize.current = null;
    setDragWidth(null);
    if (w != null && w !== width) updateAttributes({ width: w });
  };

  const onHandleKey = (e: KeyboardEvent) => {
    const dir =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? -1
          : 0;
    if (!dir || !frameRef.current) return;
    e.preventDefault();
    const now = frameRef.current.getBoundingClientRect().width;
    const max = frameRef.current.parentElement?.clientWidth ?? MAX_IMAGE_WIDTH;
    updateAttributes({ width: clampWidth(now + dir * KEY_STEP * (e.shiftKey ? 4 : 1), max) });
  };

  const handle = (sign: 1 | -1, side: "left" | "right") => (
    <div
      ref={noDrag}
      className="image-handle"
      data-side={side}
      role="slider"
      tabIndex={0}
      aria-label="Ancho de la imagen (flechas para cambiarlo, doble clic para restablecerlo)"
      aria-valuemin={MIN_IMAGE_WIDTH}
      aria-valuemax={MAX_IMAGE_WIDTH}
      aria-valuenow={shown ? Math.round(shown) : undefined}
      onPointerDown={startResize(sign)}
      onPointerMove={moveResize}
      onPointerUp={endResize}
      onPointerCancel={endResize}
      onKeyDown={onHandleKey}
      onDoubleClick={() => updateAttributes({ width: null })}
    />
  );

  const open = (which: "caption" | "alt") => {
    cancelled.current = false;
    field.current = which;
    setDraft(which === "caption" ? caption : alt);
    setEditing(which);
  };

  const finishEdit = () => {
    const which = field.current;
    if (!which) return;
    field.current = null;
    if (!cancelled.current) {
      const next = draft.trim().slice(0, MAX_IMAGE_TEXT);
      if (next !== (which === "caption" ? caption : alt))
        updateAttributes({ [which]: next || null });
    }
    setEditing(null);
  };

  const onEditKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      cancelled.current = e.key === "Escape";
      finishEdit();
      focusLineAfterNode(editor, getPos());
    }
  };

  const duplicate = () => {
    const pos = getPos();
    if (pos != null)
      editor
        .chain()
        .insertContentAt(pos + node.nodeSize, node.toJSON())
        .run();
  };

  const notify = (message: string) => editor.storage.editorBridge.notify(message);

  // The crop is written as a NEW attachment and the node points at it, so one
  // undo restores the original (its file stays until the next startup sweep).
  const applyCrop = async (rect: CropRect) => {
    const mime = cropMime(file);
    if (!src || !mime || busy) return;
    setBusy(true);
    try {
      const blob = await imageBlob(src, mime, rect);
      const stored = await storeAttachment(new File([blob], name, { type: mime }));
      updateAttributes({ file: stored.file, size: stored.size });
      setCropping(false);
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const copyImage = async () => {
    if (!src) return;
    try {
      const blob = await imageBlob(src, "image/png");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      notify("Imagen copiada");
    } catch (e) {
      notify(`No se pudo copiar la imagen: ${errorMessage(e)}`);
    }
  };

  const download = () =>
    void saveAttachmentAs(file, name).catch((e) =>
      editor.storage.editorBridge.notify(errorMessage(e)),
    );

  return (
    <NodeViewWrapper
      className="media-block image-block"
      contentEditable={false}
      data-kind="image"
      data-align={align}
    >
      {broken ? (
        <p className="media-broken" role="alert">
          <FileText size={16} strokeWidth={1.75} aria-hidden="true" />
          No se pudo cargar «{name}» (¿se movió o se borró el archivo?)
          <button type="button" className="image-broken-actions" onClick={() => setReplacing(true)}>
            Reemplazar
          </button>
        </p>
      ) : (
        src && (
          <div
            ref={frameRef}
            className="image-frame"
            data-selected={selected || undefined}
            data-resizing={dragWidth != null || undefined}
            data-cropping={cropping || undefined}
            style={shown ? { width: shown } : undefined}
          >
            <div className="image-media">
              <img
                src={src}
                alt={alt || name}
                data-sized={shown ? "" : undefined}
                draggable={false}
                onError={() => setBrokenFile(file)}
                onDoubleClick={() => setViewing(true)}
              />
              {handle(-1, "left")}
              {handle(1, "right")}
              <div className="image-toolbar" role="toolbar" aria-label="Opciones de la imagen">
                {editing === "alt" ? (
                  <input
                    autoFocus
                    type="text"
                    className="image-toolbar-input"
                    maxLength={MAX_IMAGE_TEXT}
                    placeholder="Texto alternativo…"
                    aria-label="Texto alternativo"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onEditKey}
                    onBlur={finishEdit}
                  />
                ) : (
                  <>
                    {ALIGNS.map(({ value, label, Icon }) => (
                      <ToolButton
                        key={value}
                        label={label}
                        Icon={Icon}
                        pressed={align === value}
                        onClick={() => updateAttributes({ align: value })}
                      />
                    ))}
                    <span className="image-toolbar-sep" />
                    <ToolButton
                      label="Pie de foto"
                      Icon={Captions}
                      pressed={!!caption}
                      onClick={() => open("caption")}
                    />
                    <ToolButton
                      label="Texto alternativo"
                      Icon={Type}
                      pressed={!!alt}
                      onClick={() => open("alt")}
                    />
                    <span className="image-toolbar-sep" />
                    <ToolButton
                      label="Reemplazar"
                      Icon={RefreshCw}
                      onClick={() => setReplacing(true)}
                    />
                    <ToolButton
                      label="Ver en grande"
                      Icon={Maximize2}
                      onClick={() => setViewing(true)}
                    />
                    {cropMime(file) && (
                      <ToolButton label="Recortar" Icon={Crop} onClick={() => setCropping(true)} />
                    )}
                    <ToolButton
                      label="Copiar imagen"
                      Icon={ClipboardCopy}
                      onClick={() => void copyImage()}
                    />
                    <ToolButton label="Descargar" Icon={Download} onClick={download} />
                    <ToolButton label="Duplicar" Icon={Copy} onClick={duplicate} />
                    {width != null && (
                      <ToolButton
                        label="Tamaño original"
                        Icon={RotateCcw}
                        onClick={() => updateAttributes({ width: null })}
                      />
                    )}
                    <ToolButton
                      label="Borrar"
                      Icon={Trash2}
                      onClick={() => {
                        deleteNode();
                        editor.commands.focus();
                      }}
                    />
                  </>
                )}
              </div>
              {cropping && (
                <ImageCrop onApply={(r) => void applyCrop(r)} onCancel={() => setCropping(false)} />
              )}
            </div>
            {editing === "caption" ? (
              <input
                autoFocus
                type="text"
                className="image-caption image-caption-input"
                maxLength={MAX_IMAGE_TEXT}
                placeholder="Escribe un pie de foto…"
                aria-label="Pie de foto"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onEditKey}
                onBlur={finishEdit}
              />
            ) : (
              caption && (
                <p
                  className="image-caption"
                  onClick={() => open("caption")}
                  title="Clic para editar"
                >
                  {caption}
                </p>
              )
            )}
          </div>
        )
      )}
      {viewing && src && <Lightbox src={src} alt={alt || name} onClose={() => setViewing(false)} />}
    </NodeViewWrapper>
  );
}

/** A button must not take focus from the editor, or the node selection (and with it the toolbar) is lost. */
function ToolButton({
  label,
  Icon,
  onClick,
  pressed,
}: {
  label: string;
  Icon: LucideIcon;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

/** Full-size view over the whole window (Esc, a click anywhere or × closes it). Portal: the editor would clip and re-handle it. */
function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
    >
      <button
        type="button"
        className="image-lightbox-close"
        aria-label="Cerrar"
        autoFocus
        onClick={onClose}
      >
        <X size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <img src={src} alt={alt} />
    </div>,
    document.body,
  );
}
