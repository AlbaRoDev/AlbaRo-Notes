import { useRef, useState, type KeyboardEvent } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  Download,
  ExternalLink,
  FileText,
  ImageIcon,
  Music,
  Paperclip,
  Upload,
  Video,
  X,
} from "lucide-react";
import {
  asHttpUrl,
  downloadAttachment,
  errorMessage,
  formatSize,
  nameFromUrl,
  openAttachment,
  saveAttachmentAs,
  storeAttachment,
  type MediaKind,
} from "../../lib/attachments";
import { useAttachmentUrl } from "../../hooks/useAttachmentUrl";
import { focusLineAfterNode } from "./media-commands";

const KIND_LABEL: Record<MediaKind, { noun: string; Icon: typeof ImageIcon; accept?: string }> = {
  image: { noun: "imagen", Icon: ImageIcon, accept: "image/*" },
  video: { noun: "vídeo", Icon: Video, accept: "video/*" },
  audio: { noun: "audio", Icon: Music, accept: "audio/*" },
  file: { noun: "archivo", Icon: Paperclip },
};

export function MediaView(props: NodeViewProps) {
  // Node names ("image", "video", "audio", "fileBlock") map 1:1 onto kinds.
  const kind: MediaKind =
    props.node.type.name === "fileBlock" ? "file" : (props.node.type.name as MediaKind);
  return props.node.attrs.file ? (
    <MediaResolved {...props} kind={kind} />
  ) : (
    <MediaPicker {...props} kind={kind} />
  );
}

type Props = NodeViewProps & { kind: MediaKind };

function MediaPicker({ kind, updateAttributes, deleteNode, editor, getPos }: Props) {
  const { noun, Icon, accept } = KIND_LABEL[kind];
  // The URL field's own text. Only a *finished* download writes to the node;
  // nothing typed here ever reaches Tiptap or SQLite.
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (
    label: string,
    task: () => Promise<{ file: string; size: number; name: string }>,
  ) => {
    setBusy(label);
    setError(null);
    try {
      const { file, size, name } = await task();
      updateAttributes({ file, size, name });
      // The picker's input is about to unmount, which would drop focus to
      // <body>; hand it back to the document, caret on the line after the
      // block (see focusLineAfterNode), so typing can continue.
      focusLineAfterNode(editor, getPos());
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  // Removing the node unmounts the focused input — hand focus back to the doc.
  const cancel = () => {
    deleteNode();
    editor.commands.focus();
  };

  const onFile = (file: File | undefined) => {
    if (file)
      void run("Subiendo…", async () => ({ ...(await storeAttachment(file)), name: file.name }));
  };

  const submitUrl = () => {
    const valid = asHttpUrl(url);
    if (!valid) {
      setError("Introduce una URL http o https válida");
      return;
    }
    void run("Descargando…", async () => ({
      ...(await downloadAttachment(valid, kind)),
      name: nameFromUrl(valid),
    }));
  };

  const onUrlKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!busy) submitUrl();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  return (
    <NodeViewWrapper className="media-picker" contentEditable={false} data-kind={kind}>
      <div className="media-picker-head">
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>Añadir {noun}</span>
        <button type="button" className="media-picker-close" aria-label="Cancelar" onClick={cancel}>
          <X size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <label className="media-picker-upload" aria-disabled={!!busy}>
        <input
          type="file"
          accept={accept}
          disabled={!!busy}
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Upload size={14} strokeWidth={1.75} aria-hidden="true" />
        Subir archivo
      </label>
      <div className="media-picker-url">
        <input
          autoFocus
          type="text"
          inputMode="url"
          placeholder="…o pega un enlace y pulsa Intro"
          aria-label={`URL de ${noun}`}
          value={url}
          // readOnly, not disabled: a disabled input drops focus, so after a failed
          // attempt the user would have to click back in before retrying.
          readOnly={!!busy}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={onUrlKeyDown}
        />
        <button type="button" disabled={!!busy || !url.trim()} onClick={submitUrl}>
          Insertar
        </button>
      </div>
      <p className="media-picker-hint">
        También puedes arrastrar o pegar archivos en el documento.
      </p>
      {busy && (
        <p className="media-picker-status" role="status">
          {busy}
        </p>
      )}
      {error && (
        <p className="media-picker-error" role="alert">
          {error}
        </p>
      )}
    </NodeViewWrapper>
  );
}

function MediaResolved({ kind, node, updateAttributes, editor, getPos }: Props) {
  const file = node.attrs.file as string;
  const name = (node.attrs.name as string | null) ?? "Archivo";
  const size = node.attrs.size as number | null;
  const src = useAttachmentUrl(file);
  const [broken, setBroken] = useState(false);

  if (kind === "file") {
    return (
      <FileCard
        file={file}
        name={name}
        size={size}
        updateAttributes={updateAttributes}
        editor={editor}
        getPos={getPos}
      />
    );
  }

  return (
    <NodeViewWrapper className="media-block" contentEditable={false} data-kind={kind}>
      {broken ? (
        <p className="media-broken" role="alert">
          <FileText size={16} strokeWidth={1.75} aria-hidden="true" />
          No se pudo cargar «{name}» (¿se movió o se borró el archivo?)
        </p>
      ) : (
        src &&
        (kind === "image" ? (
          <img src={src} alt={name} onError={() => setBroken(true)} />
        ) : kind === "video" ? (
          <video src={src} controls preload="metadata" onError={() => setBroken(true)} />
        ) : (
          <audio src={src} controls preload="metadata" onError={() => setBroken(true)} />
        ))
      )}
    </NodeViewWrapper>
  );
}

function FileCard({
  file,
  name,
  size,
  updateAttributes,
  editor,
  getPos,
}: {
  file: string;
  name: string;
  size: number | null;
  updateAttributes: NodeViewProps["updateAttributes"];
  editor: NodeViewProps["editor"];
  getPos: NodeViewProps["getPos"];
}) {
  const [editing, setEditing] = useState(false);
  // The name field's own text while renaming — committed to the node only on
  // Enter or blur, never per keystroke.
  const [draft, setDraft] = useState(name);
  const [message, setMessage] = useState<string | null>(null);
  const cancelled = useRef(false);

  const finishRename = () => {
    if (cancelled.current) {
      cancelled.current = false;
    } else {
      const next = draft.trim();
      if (next && next !== name) updateAttributes({ name: next });
    }
    setEditing(false);
  };

  const act = async (task: () => Promise<string | null>) => {
    setMessage(null);
    try {
      setMessage(await task());
    } catch (e) {
      setMessage(errorMessage(e));
    }
  };

  return (
    <NodeViewWrapper className="file-card" contentEditable={false} data-kind="file">
      <Paperclip size={18} strokeWidth={1.75} aria-hidden="true" />
      <div className="file-card-info">
        {editing ? (
          <input
            autoFocus
            type="text"
            maxLength={200}
            aria-label="Nombre del archivo"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                finishRename();
                focusLineAfterNode(editor, getPos());
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelled.current = true;
                setEditing(false);
                focusLineAfterNode(editor, getPos());
              }
            }}
            onBlur={finishRename}
          />
        ) : (
          <button
            type="button"
            className="file-card-name"
            title="Clic para renombrar"
            onClick={() => {
              setDraft(name);
              setEditing(true);
            }}
          >
            {name}
          </button>
        )}
        <span className="file-card-size">{formatSize(size ?? 0)}</span>
      </div>
      <button
        type="button"
        onClick={() => void act(async () => (await openAttachment(file), null))}
      >
        <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
        Abrir
      </button>
      <button
        type="button"
        onClick={() =>
          void act(async () => ((await saveAttachmentAs(file, name)) ? "Guardado" : null))
        }
      >
        <Download size={14} strokeWidth={1.75} aria-hidden="true" />
        Guardar como…
      </button>
      {message && (
        <p className="file-card-message" role="status">
          {message}
        </p>
      )}
    </NodeViewWrapper>
  );
}
