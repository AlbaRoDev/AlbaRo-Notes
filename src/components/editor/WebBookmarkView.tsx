import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Globe, X } from "lucide-react";
import { asHttpUrl, fetchLinkPreview } from "../../lib/attachments";
import { useAttachmentUrl } from "../../hooks/useAttachmentUrl";
import { focusLineAfterNode } from "./media-commands";

export function WebBookmarkView({
  node,
  updateAttributes,
  deleteNode,
  editor,
  getPos,
}: NodeViewProps) {
  const url = node.attrs.url as string | null;
  const title = node.attrs.title as string | null;
  const description = node.attrs.description as string | null;
  const siteName = node.attrs.siteName as string | null;
  const image = node.attrs.image as string | null;
  const imageSrc = useAttachmentUrl(image);

  // The URL field's own text — only a confirmed, valid URL reaches the node.
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const confirm = async () => {
    const valid = asHttpUrl(draft);
    if (!valid) {
      setError("Introduce una URL http o https válida");
      return;
    }
    setError(null);
    // Writing the url first means the card (as a plain link) is already
    // there if the fetch below fails, hangs until Rust's timeout, or the
    // machine is offline.
    updateAttributes({ url: valid });
    focusLineAfterNode(editor, getPos());
    setLoading(true);
    try {
      const preview = await fetchLinkPreview(valid);
      updateAttributes({
        title: preview.title,
        description: preview.description,
        siteName: preview.siteName,
        image: preview.image,
      });
    } catch {
      // Offline, timeout, HTTP error: stay a plain link, no error UI.
    } finally {
      setLoading(false);
    }
  };

  // Removing the node unmounts the focused input — hand focus back to the doc.
  const cancel = () => {
    deleteNode();
    editor.commands.focus();
  };

  if (!url) {
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void confirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    return (
      <NodeViewWrapper className="media-picker" contentEditable={false} data-kind="bookmark">
        <div className="media-picker-head">
          <Globe size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>Añadir miniatura web</span>
          <button
            type="button"
            className="media-picker-close"
            aria-label="Cancelar"
            onClick={cancel}
          >
            <X size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div className="media-picker-url">
          <input
            autoFocus
            type="text"
            inputMode="url"
            placeholder="Pega un enlace y pulsa Intro"
            aria-label="URL de la página"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="button" disabled={!draft.trim()} onClick={() => void confirm()}>
            Insertar
          </button>
        </div>
        {error && (
          <p className="media-picker-error" role="alert">
            {error}
          </p>
        )}
      </NodeViewWrapper>
    );
  }

  const open = (e: MouseEvent | KeyboardEvent) => {
    e.preventDefault();
    // Re-checked here: the href below is only ever http(s), but never rely on what was stored.
    const safe = asHttpUrl(url);
    if (safe) void openUrl(safe).catch((err) => console.error("Failed to open URL", err));
  };

  const hasCard = !!(title || description || image);
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();

  return (
    <NodeViewWrapper className="bookmark" contentEditable={false} data-kind="bookmark">
      <a
        className={hasCard ? "bookmark-card" : "bookmark-link"}
        href={asHttpUrl(url) ?? undefined}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === " ") open(e);
        }}
      >
        {hasCard ? (
          <>
            <span className="bookmark-text">
              <span className="bookmark-title">{title ?? url}</span>
              {description && <span className="bookmark-description">{description}</span>}
              <span className="bookmark-host">
                <Globe size={12} strokeWidth={1.75} aria-hidden="true" />
                {siteName ?? host}
              </span>
            </span>
            {imageSrc && <img className="bookmark-image" src={imageSrc} alt="" />}
          </>
        ) : (
          <>
            <Globe size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>{url}</span>
            {loading && <span className="bookmark-loading">Cargando vista previa…</span>}
          </>
        )}
      </a>
    </NodeViewWrapper>
  );
}
