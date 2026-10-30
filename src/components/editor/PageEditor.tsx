import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";
import { Placeholder } from "@tiptap/extensions";
import { contentExtensions } from "./editor-extensions";
import { SyncedBlock } from "./SyncedBlock";
import { Database } from "../database/Database";
import { DatabaseTable } from "../database/DatabaseTable";
import { RowProperties } from "../database/RowProperties";
import { RowPanelAnchor, setRowPanelContainer } from "../database/RowPanelAnchor";
import { databasePageExtensions } from "../database/database-page-extensions";
import { BlockSelect, EscapeSelectsBlock } from "./BlockSelect";
import { FindBar } from "./FindBar";
import { FIND_EVENT, PageSearch } from "./PageSearch";
import { ItemDrop } from "./ItemDrop";
import { MediaDrop } from "./MediaDrop";
import { TableControls } from "./TableControls";
import { EditorBridge } from "./EditorBridge";
import { EditorAppProvider } from "./EditorAppProvider";
import { ProtectedTitle } from "./ProtectedTitle";
import { SlashCommand } from "./slash-commands/SlashCommand";
import { AI_INLINE_EVENT, AiAssist, openAiAssist } from "./AiAssist";
import { BlockHandle } from "./BlockHandle";
import { SelectionToolbar } from "./SelectionToolbar";
import { AiInline } from "../ai/AiInline";
import {
  createDatabasePage,
  createPage,
  getPageContent,
  savePageContent,
} from "../../lib/db-client";
import { deriveTitleFromDoc } from "../../lib/title";
import { RENAME_EVENT, type RenameDetail } from "../../lib/rename";
import type { PageSummary } from "../../types";
import "katex/dist/katex.min.css";
import "./PageEditor.css";
import "./media.css";

const EMPTY_CONTENT: JSONContent = {
  type: "doc",
  content: [{ type: "heading", attrs: { level: 1 } }, { type: "paragraph" }],
};

// A database page's document is just its title (the table is drawn by the app).
const EMPTY_DATABASE_PAGE: JSONContent = {
  type: "doc",
  content: [{ type: "heading", attrs: { level: 1 } }],
};

const BODY_PLACEHOLDER =
  "Pulsa «Espacio» para activar la IA o escribe «/» para mostrar los comandos";

const SAVE_DEBOUNCE_MS = 800;
const SAVED_BADGE_DURATION_MS = 1500;
const NOTICE_DURATION_MS = 5000;

type SaveStatus = "idle" | "saving" | "saved";

interface PageEditorProps {
  pageId: string;
  pages: PageSummary[];
  onTitleChange?: (pageId: string, title: string) => void;
  onNavigate: (pageId: string) => void;
  onChildPageCreated: (page: PageSummary) => void;
  onPagesChanged: () => void;
  /** Set when this page is a database page: the editor is title-only and the table renders below. */
  ownDatabaseId?: string | null;
  /** Set when this page is a row of a database: its property panel renders under the title. */
  rowDatabaseId?: string | null;
}

export function PageEditor({
  pageId,
  pages,
  onTitleChange,
  onNavigate,
  onChildPageCreated,
  onPagesChanged,
  ownDatabaseId,
  rowDatabaseId,
}: PageEditorProps) {
  const loadedPageIdRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The doc a pending debounced save will write — so unmounting can still flush it.
  const pendingContent = useRef<JSONContent | null>(null);
  const savedBadgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  // Host element of a row's property panel (placed in the editor by RowPanelAnchor).
  const [panelHost] = useState(() => {
    const el = document.createElement("div");
    el.className = "row-panel-host";
    el.contentEditable = "false";
    return el;
  });

  const flushPendingSave = useCallback(
    (content: JSONContent) => {
      const targetPageId = loadedPageIdRef.current;
      if (!targetPageId) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      pendingContent.current = null;
      void savePageContent(targetPageId, content).catch((err) =>
        console.error("Failed to save page content", err),
      );
      onTitleChange?.(targetPageId, deriveTitleFromDoc(content));
    },
    [onTitleChange],
  );

  const scheduleSave = useCallback(
    (content: JSONContent) => {
      const targetPageId = loadedPageIdRef.current;
      if (!targetPageId) return;

      if (saveTimer.current) clearTimeout(saveTimer.current);
      pendingContent.current = content;
      saveTimer.current = setTimeout(() => {
        pendingContent.current = null;
        saveTimer.current = null;
        void savePageContent(targetPageId, content)
          .then(() => {
            setSaveStatus("saved");
            if (savedBadgeTimer.current) clearTimeout(savedBadgeTimer.current);
            savedBadgeTimer.current = setTimeout(
              () => setSaveStatus("idle"),
              SAVED_BADGE_DURATION_MS,
            );
          })
          .catch((err) => console.error("Failed to save page content", err));
        onTitleChange?.(targetPageId, deriveTitleFromDoc(content));
      }, SAVE_DEBOUNCE_MS);
    },
    [onTitleChange],
  );

  const editor = useEditor({
    extensions: ownDatabaseId
      ? databasePageExtensions
      : [
          ...contentExtensions,
          SyncedBlock,
          Database,
          RowPanelAnchor,
          MediaDrop,
          ItemDrop,
          BlockSelect,
          EscapeSelectsBlock,
          PageSearch,
          EditorBridge,
          ProtectedTitle,
          SlashCommand,
          AiAssist,
          // The title always shows its hint while empty; the body's only on the line the cursor is in.
          Placeholder.configure({
            showOnlyCurrent: false,
            placeholder: ({ pos, hasAnchor }) =>
              pos === 0 ? "Sin título" : hasAnchor ? BODY_PLACEHOLDER : "",
          }),
        ],
    content: ownDatabaseId ? EMPTY_DATABASE_PAGE : EMPTY_CONTENT,
    onUpdate: ({ editor }) => {
      setSaveStatus("saving");
      scheduleSave(editor.getJSON());
    },
  });

  useEffect(() => {
    if (!editor) return;

    // Switching pages: flush whatever was pending for the page we're leaving
    // before loading the new one, so no in-flight edit gets lost or misfiled.
    if (loadedPageIdRef.current && loadedPageIdRef.current !== pageId && saveTimer.current) {
      flushPendingSave(editor.getJSON());
    }
    loadedPageIdRef.current = null;

    let cancelled = false;
    void (async () => {
      const savedContent = await getPageContent(pageId);
      if (cancelled) return;

      editor.commands.setContent(
        savedContent ?? (ownDatabaseId ? EMPTY_DATABASE_PAGE : EMPTY_CONTENT),
        {
          emitUpdate: false,
        },
      );
      // A loaded page starts with an empty undo history. Otherwise Ctrl+Z undoes the load itself
      // (emptying the page, which then autosaves) or, since this editor is reused across pages,
      // replays the previous page's edits onto this one.
      const { doc, plugins } = editor.state;
      editor.view.updateState(EditorState.create({ doc, plugins }));
      loadedPageIdRef.current = pageId;
    })();

    return () => {
      cancelled = true;
    };
  }, [editor, pageId, flushPendingSave, ownDatabaseId]);

  // The unmount cleanup below runs once, so it reads the callback through a ref.
  const onTitleChangeRef = useRef(onTitleChange);
  useEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

  useEffect(() => {
    return () => {
      // Remounting (page <-> database page, or switching between Notes and the Gestor) must
      // not drop an edit still waiting on the debounce, nor leave the sidebar with the old title.
      if (saveTimer.current && loadedPageIdRef.current && pendingContent.current) {
        void savePageContent(loadedPageIdRef.current, pendingContent.current).catch((err) =>
          console.error("Failed to save page content", err),
        );
        onTitleChangeRef.current?.(
          loadedPageIdRef.current,
          deriveTitleFromDoc(pendingContent.current),
        );
      }
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (savedBadgeTimer.current) clearTimeout(savedBadgeTimer.current);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  // The "Página" slash command runs outside React (items.ts), so it reaches
  // these through editor.storage rather than the EditorAppContext below —
  // mutated in place to avoid recreating the editor on every page switch.
  useEffect(() => {
    if (!editor || ownDatabaseId) return;
    setRowPanelContainer(editor, rowDatabaseId ? panelHost : null);
  }, [editor, ownDatabaseId, rowDatabaseId, panelHost]);

  /* eslint-disable react-hooks/immutability -- Tiptap's own pattern for pushing fresh values into extension storage without recreating the editor. */
  useEffect(() => {
    if (!editor || ownDatabaseId) return; // a database page's editor has no bridge
    const bridge = editor.storage.editorBridge;
    bridge.currentPageId = pageId;
    bridge.createChildPage = async () => {
      const page = await createPage(pageId);
      onChildPageCreated(page);
      return page;
    };
    bridge.createDatabasePage = async () => {
      const page = await createDatabasePage();
      onChildPageCreated(page);
      return page;
    };
    bridge.notify = (message: string) => {
      setNotice(message);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
    };
  }, [editor, pageId, onChildPageCreated, ownDatabaseId]);
  /* eslint-enable react-hooks/immutability */

  // A rename from the sidebar edits the title here, so it autosaves with the rest and nothing overwrites it.
  useEffect(() => {
    if (!editor) return;
    const rename = (e: Event) => {
      const detail = (e as CustomEvent<RenameDetail>).detail;
      const first = editor.state.doc.firstChild;
      if (detail.handled || detail.pageId !== loadedPageIdRef.current || !first) return;
      detail.handled = true;
      const text = detail.title ? [editor.schema.text(detail.title)] : [];
      editor.view.dispatch(editor.state.tr.replaceWith(1, 1 + first.content.size, text));
    };
    window.addEventListener(RENAME_EVENT, rename);
    return () => window.removeEventListener(RENAME_EVENT, rename);
  }, [editor]);

  // Ctrl+F: the find bar of this page. Where two editors are on screen (a page and a task beside it), the one
  // with the cursor takes it, else the first to hear it. The bar hangs from the page's top bar when there is one.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [find, setFind] = useState<{ open: boolean; token: number; host: HTMLElement | null }>({
    open: false,
    token: 0,
    host: null,
  });
  useEffect(() => {
    if (!editor || ownDatabaseId) return;
    const onFind = (e: Event) => {
      const wrapper = wrapperRef.current;
      const focused = document.querySelector(".page-editor-wrapper:focus-within");
      if (!wrapper || e.defaultPrevented || (focused && focused !== wrapper)) return;
      e.preventDefault();
      const host =
        wrapper.closest(".container")?.querySelector<HTMLElement>(".page-topbar") ?? null;
      setFind((f) => ({ open: true, token: f.token + 1, host }));
    };
    window.addEventListener(FIND_EVENT, onFind);
    return () => window.removeEventListener(FIND_EVENT, onFind);
  }, [editor, ownDatabaseId]);
  const closeFind = useCallback(() => setFind((f) => ({ ...f, open: false })), []);

  // Ctrl+J with the cursor in this page opens the in-page AI (App routes the shortcut here).
  useEffect(() => {
    if (!editor || ownDatabaseId) return;
    const open = () => openAiAssist(editor);
    window.addEventListener(AI_INLINE_EVENT, open);
    return () => window.removeEventListener(AI_INLINE_EVENT, open);
  }, [editor, ownDatabaseId]);

  return (
    <EditorAppProvider value={{ pages, currentPageId: pageId, onNavigate, onPagesChanged }}>
      <div className="page-editor-wrapper" ref={wrapperRef}>
        {find.open &&
          editor &&
          (find.host ? (
            createPortal(
              <FindBar editor={editor} focusToken={find.token} onClose={closeFind} />,
              find.host,
            )
          ) : (
            <div className="find-anchor">
              <FindBar editor={editor} focusToken={find.token} onClose={closeFind} />
            </div>
          ))}
        {rowDatabaseId &&
          createPortal(
            <RowProperties key={pageId} pageId={pageId} databaseId={rowDatabaseId} />,
            panelHost,
          )}
        <EditorContent
          className={ownDatabaseId ? "page-editor page-editor--database" : "page-editor"}
          editor={editor}
        />
        {ownDatabaseId ? (
          // Same wrapper classes as the editor so the table keeps the styling the
          // block version gets inside ProseMirror (see DatabaseView.css).
          <div className="page-editor">
            <div className="ProseMirror db-page">
              <DatabaseTable databaseId={ownDatabaseId} />
            </div>
          </div>
        ) : (
          <>
            <TableControls editor={editor} />
            {editor && (
              <>
                <AiInline editor={editor} />
                <SelectionToolbar editor={editor} />
                <BlockHandle editor={editor} />
              </>
            )}
            <p className="markdown-hint">
              Atajos: <code># </code> título, <code>- </code> lista, <code>[] </code> checklist, o
              escribe <code>/</code> para ver todos los bloques
            </p>
          </>
        )}
        {notice && (
          <p className="editor-notice" role="alert">
            {notice}
          </p>
        )}
        <span className="save-indicator" data-visible={saveStatus !== "idle"}>
          {saveStatus === "saving" ? "Guardando…" : "Guardado"}
        </span>
      </div>
    </EditorAppProvider>
  );
}
