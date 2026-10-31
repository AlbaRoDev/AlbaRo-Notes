import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PageEditor } from "./components/editor/PageEditor";
import { Sidebar } from "./components/sidebar/Sidebar";
import { SearchModal, type PaletteCommand } from "./components/search/SearchModal";
import {
  CalendarCheck,
  Circle,
  Database,
  Download,
  FileDown,
  FilePlus,
  FileText,
  FolderInput,
  House,
  Leaf,
  Monitor,
  Moon,
  MousePointer,
  MousePointer2,
  Sparkles,
  Sun,
} from "lucide-react";
import { AiPanel } from "./components/ai/AiPanel";
import { AI_INLINE_EVENT } from "./components/editor/AiAssist";
import { OPEN_LINK_EVENT } from "./components/editor/NotionShortcuts";
import { FIND_EVENT } from "./components/editor/PageSearch";
import { loadEmojiData } from "./components/editor/emoji-data";
import { PageHeader } from "./components/editor/PageHeader";
import { PageTopBar } from "./components/editor/PageTopBar";
import {
  IMPORT_FILES_EVENT,
  IMPORT_FOLDER_EVENT,
  ImportHost,
} from "./components/import/ImportHost";
import { RelatedTasks } from "./components/editor/RelatedTasks";
import { Home } from "./components/workspace/Home";
import { ManagerCompanion, ManagerMain } from "./components/workspace/Manager";
import { TaskPeek } from "./components/workspace/TaskPeek";
import type { TaskHost } from "./components/workspace/Tasks";
import { useLayout } from "./components/workspace/use-layout";
import { Workspace } from "./components/workspace/Workspace";
import { setCursorPref, setStylePref, setThemePref, toggleTheme } from "./lib/theme";
import { createDatabasePage, createPage, deletePage, dbPing, listPages } from "./lib/db-client";
import { AppMenu } from "./components/AppMenu";
import { UpdateBanner } from "./components/UpdateBanner";
import { requestUpdateCheck } from "./lib/app-update";
import { renamePage } from "./lib/rename";
import type { PageSummary } from "./types";
import "./App.css";

function App() {
  // The database check only says something when it fails; its schema version goes in the tooltip of the app version.
  const [dbSchema, setDbSchema] = useState<number | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);

  useEffect(() => {
    dbPing()
      .then(setDbSchema)
      .catch((err) => setDbError(`No se puede abrir la base de datos: ${err}`));
    // the version comes from tauri.conf.json, so there is no second copy in the interface to forget
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
    // the emoji list is a 570 KB chunk: fetched right after the first paint, so the picker does not wait for it
    const warm = window.setTimeout(() => void loadEmojiData(), 200);
    return () => window.clearTimeout(warm);
  }, []);

  const bootstrapped = useRef(false);

  useEffect(() => {
    // Guard against React StrictMode's double-invoke of effects in dev,
    // which would otherwise race two "create if empty" calls into two pages.
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    void (async () => {
      let existing = await listPages();
      if (existing.length === 0) {
        const created = await createPage();
        existing = [created];
      }
      setPages(existing);
      setSelectedPageId(existing[0].id);
    })();
  }, []);

  const { layout, enter, promote, setSplit, goHome } = useLayout();

  // A row of a database (a task…) opens in the side peek, over the page that shows it, as in Notion; any other
  // page replaces the open one. Read through a ref so the callback stays the same one when titles change.
  const [peekId, setPeekId] = useState<string | null>(null);
  const pagesRef = useRef(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  const navigate = useCallback((pageId: string) => {
    if (pagesRef.current.find((p) => p.id === pageId)?.databaseId) setPeekId(pageId);
    else {
      setPeekId(null);
      setSelectedPageId(pageId);
    }
  }, []);
  const closePeek = useCallback(() => setPeekId(null), []);

  // Opening a page from anywhere (search, the AI, the Notes companion) brings Notes to the main zone.
  const openPage = useCallback(
    (pageId: string) => {
      setSelectedPageId(pageId);
      setPeekId(null);
      promote("notes");
    },
    [promote],
  );

  // Documents brought in (dropped or picked) arrive as pages: the list is read again and the first one opens.
  const handleImported = useCallback(
    (created: PageSummary[]) => {
      void listPages().then((all) => {
        setPages(all);
        if (created[0]) openPage(created[0].id);
      });
    },
    [openPage],
  );

  const handleCreate = useCallback(
    (kind: PageSummary["kind"]) => {
      void (kind === "database" ? createDatabasePage() : createPage()).then((page) => {
        setPages((prev) => [...prev, page]);
        openPage(page.id);
      });
    },
    [openPage],
  );

  const handleDelete = (pageId: string) => {
    void deletePage(pageId).then(async () => {
      // Re-read instead of filtering: deleting a page cascades to its sub-pages,
      // and a database page also takes its rows with it.
      const all = await listPages();
      const visible = all.filter((p) => !p.databaseId);

      if (visible.length === 0) {
        const created = await createPage();
        setPages([...all, created]);
        setSelectedPageId(created.id);
        return;
      }

      setPages(all);
      if (!all.some((p) => p.id === selectedPageId)) {
        setSelectedPageId(visible[0].id);
      }
    });
  };

  // useCallback here isn't a performance nicety — PageEditor's content-loading
  // effect depends (transitively, via flushPendingSave) on this reference. An
  // unstable one made that effect re-run on every debounced save, re-fetching
  // from SQLite and resetting the editor's selection mid-keystroke: the exact
  // "cursor jumps while typing" bug in toggle/columns.
  const handleTitleChange = useCallback((pageId: string, title: string) => {
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, title } : p)));
  }, []);

  // The sidebar's rename; the open page's title also comes back through its editor's autosave.
  const handleRename = useCallback(async (pageId: string, title: string) => {
    await renamePage(pageId, title);
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, title } : p)));
  }, []);

  // Inserting a "Página" block creates a sub-page but keeps editing the current
  // one — unlike handleCreate, it must not steal focus by navigating away.
  const handleChildPageCreated = useCallback((page: PageSummary) => {
    setPages((prev) => [...prev, page]);
  }, []);

  // Database rows are created/deleted inside the editor (DatabaseView), which
  // can't patch `pages` itself — re-read the list instead of mirroring SQLite.
  const refreshPages = useCallback(() => {
    void listPages().then(setPages);
  }, []);

  const selectedPage = pages.find((p) => p.id === selectedPageId);
  const peekPage = pages.find((p) => p.id === peekId);

  // The mouse's «back» button goes up to the page's parent (a row's database, a sub-page's parent): the app has
  // no history to walk, and the webview's own would leave the page.
  const parentId = layout.main === "notes" ? (selectedPage?.parentId ?? null) : null;
  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      if (e.type === "mouseup" && e.button === 3 && parentId) openPage(parentId);
    };
    // Notion's keys for the same: Ctrl+Shift+U (go to the parent page) and Ctrl+[ (back)
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const up = e.shiftKey && !e.altKey && key === "u";
      if (!(e.ctrlKey || e.metaKey) || !(up || (!e.shiftKey && !e.altKey && key === "["))) return;
      e.preventDefault();
      if (parentId) openPage(parentId);
    };
    const types = ["mousedown", "mouseup", "auxclick"] as const;
    for (const t of types) window.addEventListener(t, onMouse, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      types.forEach((t) => window.removeEventListener(t, onMouse, true));
      window.removeEventListener("keydown", onKey, true);
    };
  }, [parentId, openPage]);

  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // The AI assistant: stays mounted so closing it keeps the conversation.
  const [aiOpen, setAiOpen] = useState(false);
  const openAi = useCallback(() => setAiOpen(true), []);
  const closeAi = useCallback(() => setAiOpen(false), []);

  // Ctrl+K (or Ctrl+P, as in Notion; Cmd on macOS) opens the palette from anywhere — the editor,
  // a table cell, with the sidebar closed. Capture phase, so no field or editor keymap sees it first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const selected = getSelection();
      const textSelected =
        !!selected &&
        !selected.isCollapsed &&
        !!selected.anchorNode?.parentElement?.closest(".page-editor .ProseMirror");
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "k" && textSelected) {
        // Ctrl+K on selected text makes a link, as in Notion (the toolbar opens its box); without a selection it searches.
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new Event(OPEN_LINK_EVENT));
      } else if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (key === "k" || key === "p")
      ) {
        e.preventDefault(); // Ctrl+P would otherwise open the print dialog
        e.stopPropagation();
        setSearchOpen((open) => !open);
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "f") {
        // Ctrl+F: find in the page. Always cancelled: the webview's own find box would search the whole window.
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new Event(FIND_EVENT, { cancelable: true }));
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "n") {
        // Ctrl+N: a new page, as in Notion (the webview would open another window)
        e.preventDefault();
        e.stopPropagation();
        handleCreate("page");
      } else if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (key === "1" || key === "2")
      ) {
        // Ctrl+1 / Ctrl+2: Notes / Gestor
        e.preventDefault();
        e.stopPropagation();
        enter(key === "1" ? "notes" : "manager");
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && key === "l") {
        // Ctrl+Shift+L, as Notion's. Here, not in the sidebar: the start screen and the Gestor have none.
        e.preventDefault();
        toggleTheme();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "j") {
        // Ctrl+J, as Notion AI's: with the cursor in a page it opens the in-page AI (PageEditor
        // listens); anywhere else it opens and closes the side assistant. Inside the in-page box
        // itself it does nothing (Esc closes that one).
        e.preventDefault();
        e.stopPropagation();
        const from = e.target instanceof Element ? e.target : null;
        if (from?.closest(".ai-inline")) return;
        if (from?.closest(".page-editor .ProseMirror"))
          window.dispatchEvent(new Event(AI_INLINE_EVENT));
        else setAiOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enter, handleCreate]);

  const commands: PaletteCommand[] = [
    {
      id: "go-notes",
      label: "Ir a Notas",
      keywords: "páginas apuntes documentos",
      icon: FileText,
      hint: "Ctrl+1",
      run: () => enter("notes"),
    },
    {
      id: "go-manager",
      label: "Ir al Gestor",
      keywords: "calendario tareas tableros familias agenda",
      icon: CalendarCheck,
      hint: "Ctrl+2",
      run: () => enter("manager"),
    },
    {
      id: "go-home",
      label: "Pantalla de inicio",
      keywords: "inicio portada elegir",
      icon: House,
      run: goHome,
    },
    {
      id: "ask-ai",
      label: "Preguntar a la IA",
      keywords: "asistente inteligencia artificial ollama chat",
      icon: Sparkles,
      hint: "Ctrl+J",
      run: openAi,
    },
    {
      id: "new-page",
      label: "Nueva página",
      keywords: "crear añadir nota documento",
      icon: FilePlus,
      run: () => handleCreate("page"),
    },
    {
      id: "import-files",
      label: "Importar documentos…",
      keywords: "abrir markdown md docx word html texto archivos páginas",
      icon: FileDown,
      run: () => window.dispatchEvent(new Event(IMPORT_FILES_EVENT)),
    },
    {
      id: "import-folder",
      label: "Importar una carpeta…",
      keywords: "abrir markdown md notas obsidian directorio páginas",
      icon: FolderInput,
      run: () => window.dispatchEvent(new Event(IMPORT_FOLDER_EVENT)),
    },
    {
      id: "new-database",
      label: "Nueva base de datos",
      keywords: "crear añadir tabla",
      icon: Database,
      run: () => handleCreate("database"),
    },
    {
      id: "theme-light",
      label: "Tema claro",
      keywords: "modo apariencia día",
      icon: Sun,
      run: () => setThemePref("light"),
    },
    {
      id: "theme-dark",
      label: "Tema oscuro",
      keywords: "modo apariencia noche",
      icon: Moon,
      hint: "Ctrl+Shift+L",
      run: () => setThemePref("dark"),
    },
    {
      id: "style-themed",
      label: "Estilo de estaciones",
      keywords: "colores paleta primavera verano otoño invierno navidad temporada",
      icon: Leaf,
      run: () => setStylePref("themed"),
    },
    {
      id: "style-sober",
      label: "Estilo sobrio",
      keywords: "colores paleta notion clásico",
      icon: Circle,
      run: () => setStylePref("sober"),
    },
    {
      id: "cursor-minimal",
      label: "Puntero minimalista",
      keywords: "ratón cursor flecha mano apariencia fino sin color",
      icon: MousePointer2,
      run: () => setCursorPref("minimal"),
    },
    {
      id: "cursor-system",
      label: "Puntero del sistema",
      keywords: "ratón cursor flecha mano apariencia",
      icon: MousePointer,
      run: () => setCursorPref("system"),
    },
    {
      id: "check-updates",
      label: "Buscar actualizaciones",
      keywords: "versión nueva actualizar update instalar",
      icon: Download,
      run: requestUpdateCheck,
    },
    {
      id: "theme-system",
      label: "Tema del sistema",
      keywords: "modo apariencia automático",
      icon: Monitor,
      run: () => setThemePref("system"),
    },
  ];

  // The same sidebar on the left of both halves; choosing a page in it brings Notes to the main zone.
  const sidebar = (
    <Sidebar
      pages={pages}
      selectedPageId={selectedPageId}
      onSelect={openPage}
      onCreate={handleCreate}
      onDelete={handleDelete}
      onRename={handleRename}
      onSearch={openSearch}
      onAskAi={openAi}
    />
  );
  const appMenu = (
    <AppMenu
      commands={commands}
      hasSidebar={layout.main !== null}
      version={version}
      dbSchema={dbSchema}
      onSearch={openSearch}
    />
  );
  const taskHost: TaskHost = {
    pages,
    onTitleChange: handleTitleChange,
    onChildPageCreated: handleChildPageCreated,
    onPagesChanged: refreshPages,
    onOpenPage: openPage,
    onDelete: handleDelete,
    onOpenAi: openAi,
  };
  const notesMain = (
    <div className="app-layout">
      {sidebar}
      {/* Like Notion, a database page uses the full width; text pages keep a readable column. */}
      <div className="page-column">
        <main className={selectedPage?.ownDatabaseId ? "container container--wide" : "container"}>
          {selectedPage && (
            <PageTopBar
              page={selectedPage}
              pages={pages}
              onOpen={openPage}
              onChanged={refreshPages}
              onDelete={handleDelete}
              onAskAi={openAi}
            />
          )}
          {selectedPage && (
            <PageHeader
              key={`header-${selectedPage.id}`}
              page={selectedPage}
              onChanged={refreshPages}
            />
          )}
          {selectedPageId && (
            // Keyed by page so a page that fails to draw does not stop the next one from opening. Siblings need
            // different keys: with the same one React duplicated the header of every page visited.
            <ErrorBoundary key={`editor-${selectedPageId}`} what="la página">
              <PageEditor
                // A database page's editor is title-only, so it needs its own editor instance.
                key={selectedPage?.ownDatabaseId ? "database" : "page"}
                ownDatabaseId={selectedPage?.ownDatabaseId ?? null}
                rowDatabaseId={selectedPage?.databaseId ?? null}
                pageId={selectedPageId}
                pages={pages}
                onTitleChange={handleTitleChange}
                onNavigate={navigate}
                onChildPageCreated={handleChildPageCreated}
                onPagesChanged={refreshPages}
              />
            </ErrorBoundary>
          )}
          {peekPage && (
            <TaskPeek page={peekPage} host={taskHost} onClose={closePeek}>
              <PageEditor
                key={peekPage.id}
                pageId={peekPage.id}
                rowDatabaseId={peekPage.databaseId}
                pages={pages}
                onTitleChange={handleTitleChange}
                onNavigate={navigate}
                onChildPageCreated={handleChildPageCreated}
                onPagesChanged={refreshPages}
              />
            </TaskPeek>
          )}
          {selectedPage?.kind === "page" && !selectedPage.databaseId && (
            <RelatedTasks pageId={selectedPage.id} pages={pages} onOpen={openPage} />
          )}
          {dbError && (
            <p className="app-footer app-footer--error" role="alert">
              {dbError}
            </p>
          )}
          {version && (
            <p
              className="app-footer"
              title={dbSchema === null ? undefined : `Base de datos: esquema v${dbSchema}`}
            >
              AlbaRo Notes v{version}
            </p>
          )}
        </main>
      </div>
    </div>
  );

  return (
    <>
      {layout.main === null ? (
        <Home onEnter={enter} version={version} menu={appMenu} />
      ) : (
        <Workspace
          layout={{ ...layout, main: layout.main }}
          main={
            layout.main === "notes" ? (
              notesMain
            ) : (
              <div className="app-layout">
                {sidebar}
                <ManagerMain host={taskHost} />
              </div>
            )
          }
          companion={
            layout.main === "notes" ? (
              <ManagerCompanion pages={pages} onOpenPage={openPage} />
            ) : null
          }
          onEnter={enter}
          onSplit={setSplit}
          onHome={goHome}
          menu={appMenu}
        />
      )}
      <AiPanel
        open={aiOpen}
        currentPageId={selectedPageId}
        onClose={closeAi}
        onOpenPage={openPage}
        onPagesChanged={refreshPages}
      />
      {searchOpen && <SearchModal commands={commands} onOpen={openPage} onClose={closeSearch} />}
      <ImportHost onDone={handleImported} />
      <UpdateBanner />
    </>
  );
}

export default App;
