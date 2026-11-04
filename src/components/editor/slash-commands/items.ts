import type { Editor, JSONContent, Range } from "@tiptap/react";
import type { PageSummary } from "../../../types";
import { insertBlockWithLineAfter } from "../media-commands";
import {
  AtSign,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  ChartNoAxesGantt,
  CheckSquare,
  ChevronRight,
  Code,
  Columns2,
  Database as DatabaseIcon,
  FileText,
  Globe,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  ImageIcon,
  Lightbulb,
  Link2,
  List,
  ListCollapse,
  Map as MapIcon,
  ListOrdered,
  Milestone,
  MousePointerClick,
  PenTool,
  Minus,
  Music,
  Paperclip,
  PanelTop,
  Pilcrow,
  Quote,
  RefreshCw,
  Sigma,
  Smile,
  Table as TableIcon,
  TableOfContents as TableOfContentsIcon,
  Video,
  type LucideIcon,
} from "lucide-react";
import { t } from "../../../lib/i18n.ts";

type SlashCommandCategory = string;

export interface SlashCommandItem {
  title: string;
  category: SlashCommandCategory;
  keywords: string[];
  /** Hidden in editors whose schema lacks this node (the editor inside a synced block has no `syncedBlock`). */
  requires?: string;
  icon: LucideIcon;
  run: (editor: Editor, range: Range) => void;
}

/**
 * Inserts a toggle and places the cursor in its (empty) summary line.
 * insertContent leaves the selection at the end of the inserted content —
 * inside the content paragraph — and a precomputed offset from `range.from`
 * doesn't reach the summary reliably, because inserting a block node mid-line
 * splits the surrounding paragraph first, shifting positions. Walking up
 * from wherever the selection actually landed to find the enclosing
 * `toggle` node, then descending into its first child, works regardless.
 */
function insertToggle(editor: Editor, range: Range, headingLevel: number | null) {
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent({
      type: "toggle",
      attrs: { open: true, headingLevel },
      content: [
        { type: "toggleSummary" },
        { type: "toggleContent", content: [{ type: "paragraph" }] },
      ],
    })
    .command(({ tr, commands }) => {
      const { $from } = tr.selection;
      for (let depth = $from.depth; depth >= 0; depth--) {
        if ($from.node(depth).type.name === "toggle") {
          return commands.setTextSelection($from.before(depth) + 2);
        }
      }
      return true;
    })
    .run();
}

/**
 * Media blocks open straight into their picker (an autoFocus input), so like
 * the inline items below they skip `.focus()` — Tiptap's deferred
 * requestAnimationFrame focus would otherwise steal it back from the picker.
 */
function insertMedia(editor: Editor, range: Range, node: JSONContent) {
  editor.chain().deleteRange(range).command(insertBlockWithLineAfter(node)).run();
}

/** Header row + body rows of empty cells, in the JSON shape the table extension saves. */
function tableNode(rows: number, cols: number): JSONContent {
  const cell = (type: string): JSONContent => ({ type, content: [{ type: "paragraph" }] });
  return {
    type: "table",
    content: Array.from({ length: rows }, (_, r) => ({
      type: "tableRow",
      content: Array.from({ length: cols }, () => cell(r === 0 ? "tableHeader" : "tableCell")),
    })),
  };
}

function tabNode(title: string): JSONContent {
  return { type: "tab", attrs: { title }, content: [{ type: "paragraph" }] };
}

const SLASH_COMMAND_ITEMS: SlashCommandItem[] = [
  // Básicos
  {
    title: t("Texto"),
    category: t("Básicos"),
    keywords: ["paragraph", "text", "p", "parrafo", "párrafo"],
    icon: Pilcrow,
    run: (editor, range) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    title: t("Encabezado 1"),
    category: t("Básicos"),
    keywords: ["heading", "head", "h1", "titulo", "título"],
    icon: Heading1,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
  },
  {
    title: t("Encabezado 2"),
    category: t("Básicos"),
    keywords: ["heading", "head", "h2", "titulo", "título"],
    icon: Heading2,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
  },
  {
    title: t("Encabezado 3"),
    category: t("Básicos"),
    keywords: ["heading", "head", "h3", "titulo", "título"],
    icon: Heading3,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
  },
  {
    title: t("Encabezado 4"),
    category: t("Básicos"),
    keywords: ["heading", "head", "h4", "titulo", "título"],
    icon: Heading4,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 4 }).run(),
  },
  // Listas
  {
    title: t("Lista con viñetas"),
    category: t("Listas"),
    keywords: ["bullet", "list", "ul", "lista", "viñetas"],
    icon: List,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: t("Lista numerada"),
    category: t("Listas"),
    keywords: ["ordered", "number", "ol", "numerada"],
    icon: ListOrdered,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: t("Checklist"),
    category: t("Listas"),
    keywords: ["task", "todo", "checkbox", "check", "tarea"],
    icon: CheckSquare,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: t("Lista desplegable"),
    category: t("Listas"),
    keywords: ["toggle", "desplegable", "collapse", "lista desplegable"],
    icon: ChevronRight,
    run: (editor, range) => insertToggle(editor, range, null),
  },
  {
    title: t("Encabezado desplegable"),
    category: t("Listas"),
    keywords: ["toggle heading", "encabezado desplegable"],
    icon: ListCollapse,
    run: (editor, range) => insertToggle(editor, range, 1),
  },
  // Bloques de contenido
  {
    title: t("Cita"),
    category: t("Bloques de contenido"),
    keywords: ["blockquote", "quote", "cita"],
    icon: Quote,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: t("Destacado"),
    category: t("Bloques de contenido"),
    keywords: ["callout", "highlight", "destacado", "nota"],
    icon: Lightbulb,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleWrap("callout").run(),
  },
  {
    title: t("Divisor"),
    category: t("Bloques de contenido"),
    keywords: ["divider", "hr", "horizontal", "rule", "separador"],
    icon: Minus,
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: t("Bloque de código"),
    category: t("Bloques de contenido"),
    keywords: ["code", "codeblock", "monospace"],
    icon: Code,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: t("Tabla"),
    category: t("Bloques de contenido"),
    keywords: ["table", "tabla", "grid", "cuadricula", "cuadrícula", "filas"],
    icon: TableIcon,
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .command(insertBlockWithLineAfter(tableNode(3, 3), "inside"))
        .run(),
  },
  {
    title: t("Ecuación de bloque"),
    category: t("Bloques de contenido"),
    keywords: ["equation", "ecuacion", "latex", "math", "formula", "fórmula", "bloque", "display"],
    icon: Sigma,
    run: (editor, range) =>
      insertMedia(editor, range, { type: "equationBlock", attrs: { latex: "" } }),
  },
  // Multimedia
  {
    title: t("Imagen"),
    category: t("Multimedia"),
    keywords: ["image", "imagen", "foto", "picture", "photo"],
    icon: ImageIcon,
    run: (editor, range) => insertMedia(editor, range, { type: "image" }),
  },
  {
    title: t("Vídeo"),
    category: t("Multimedia"),
    keywords: ["video", "vídeo", "movie", "mp4"],
    icon: Video,
    run: (editor, range) => insertMedia(editor, range, { type: "video" }),
  },
  {
    title: t("Audio"),
    category: t("Multimedia"),
    keywords: ["audio", "sonido", "music", "música", "musica", "mp3"],
    icon: Music,
    run: (editor, range) => insertMedia(editor, range, { type: "audio" }),
  },
  {
    title: t("Archivo"),
    category: t("Multimedia"),
    keywords: ["file", "archivo", "adjunto", "attachment", "pdf", "documento"],
    icon: Paperclip,
    run: (editor, range) => insertMedia(editor, range, { type: "fileBlock" }),
  },
  {
    title: t("Miniatura web"),
    category: t("Multimedia"),
    keywords: ["bookmark", "marcador", "web", "link", "enlace", "miniatura", "url"],
    icon: Globe,
    run: (editor, range) => insertMedia(editor, range, { type: "webBookmark" }),
  },
  // En línea
  //
  // These four skip the usual .focus() before insertContent — the inserted
  // NodeView mounts its own autoFocus input immediately (search box, date
  // input, latex input), and Tiptap's focus command schedules a *second*,
  // requestAnimationFrame-deferred view.focus() call that fires a beat later
  // and steals focus straight back to the main doc, right as a fast typist
  // starts searching. Dropping .focus() here removes the competing claim;
  // deleteRange/insertContent don't depend on DOM focus to apply.
  {
    title: t("Emoji"),
    category: t("En línea"),
    keywords: ["emoji", "emoticon", "icono"],
    icon: Smile,
    run: (editor, range) =>
      editor.chain().deleteRange(range).insertContent({ type: "emojiPicker" }).run(),
  },
  {
    title: t("Fecha o recordatorio"),
    category: t("En línea"),
    keywords: ["date", "fecha", "recordatorio", "reminder", "calendario"],
    icon: CalendarClock,
    run: (editor, range) =>
      editor
        .chain()
        .deleteRange(range)
        .insertContent({ type: "dateMention", attrs: { date: null } })
        .run(),
  },
  {
    title: t("Mención de página"),
    category: t("En línea"),
    keywords: ["mention", "mencion", "mención", "pagina", "página", "@"],
    icon: AtSign,
    // writes the «@», which opens the same list as typing it
    run: (editor, range) => editor.chain().focus().deleteRange(range).insertContent("@").run(),
  },
  {
    title: t("Ecuación integrada"),
    category: t("En línea"),
    keywords: ["equation", "ecuacion", "ecuación", "latex", "math", "formula", "fórmula"],
    icon: Sigma,
    run: (editor, range) =>
      editor
        .chain()
        .deleteRange(range)
        .insertContent({ type: "equationInline", attrs: { latex: "" } })
        .run(),
  },
  // Avanzado
  {
    title: t("Columnas"),
    category: t("Avanzado"),
    keywords: ["columns", "columnas", "layout"],
    icon: Columns2,
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "columnList",
          content: [
            { type: "column", content: [{ type: "paragraph" }] },
            { type: "column", content: [{ type: "paragraph" }] },
          ],
        })
        .run(),
  },
  {
    title: t("Pestañas"),
    category: t("Avanzado"),
    keywords: ["tabs", "pestañas", "pestanas", "pestaña"],
    icon: PanelTop,
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .command(
          insertBlockWithLineAfter(
            {
              type: "tabs",
              attrs: { active: 0 },
              content: [tabNode(t("Pestaña 1")), tabNode(t("Pestaña 2"))],
            },
            "inside",
          ),
        )
        .run(),
  },
  {
    title: t("Botón"),
    category: t("Avanzado"),
    keywords: ["button", "boton", "botón", "accion", "acción"],
    icon: MousePointerClick,
    run: (editor, range) => insertMedia(editor, range, { type: "buttonBlock" }),
  },
  {
    title: t("Bloque sincronizado"),
    category: t("Avanzado"),
    keywords: ["synced", "sync", "sincronizado", "sincronizar", "compartido"],
    requires: "syncedBlock",
    icon: RefreshCw,
    run: (editor, range) =>
      insertMedia(editor, range, { type: "syncedBlock", attrs: { syncId: crypto.randomUUID() } }),
  },
  {
    // Creates the database as its own root-level page and leaves a view of it here.
    title: t("Base de datos"),
    category: t("Avanzado"),
    keywords: [
      "database",
      "base de datos",
      "tabla de datos",
      "propiedades",
      "properties",
      "registros",
      "nueva",
    ],
    requires: "database",
    icon: DatabaseIcon,
    run: (editor, range) => {
      void editor.storage.editorBridge.createDatabasePage().then((page: PageSummary) => {
        if (!page.ownDatabaseId) return; // a database page always has one
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .command(
            insertBlockWithLineAfter({
              type: "database",
              attrs: { databaseId: page.ownDatabaseId },
            }),
          )
          .run();
      });
    },
  },
  {
    title: t("Vista de base de datos"),
    category: t("Avanzado"),
    keywords: ["database view", "vista", "base de datos existente", "enlazada", "linked"],
    requires: "database",
    icon: DatabaseIcon,
    run: (editor, range) =>
      insertMedia(editor, range, { type: "database", attrs: { databaseId: null } }),
  },
  // Standalone views: single-purpose blocks with their own entries, unrelated to any database.
  {
    title: t("Vista de calendario"),
    category: t("Avanzado"),
    keywords: ["calendar view", "calendario", "agenda", "eventos", "meses", "fechas"],
    icon: CalendarDays,
    run: (editor, range) =>
      insertMedia(editor, range, { type: "calendarView", attrs: { events: [] } }),
  },
  {
    title: t("Vista de cronograma"),
    category: t("Avanzado"),
    keywords: [
      "timeline view",
      "cronograma",
      "gantt",
      "linea de tiempo",
      "línea de tiempo",
      "planificacion",
    ],
    icon: ChartNoAxesGantt,
    run: (editor, range) =>
      insertMedia(editor, range, { type: "timelineView", attrs: { events: [] } }),
  },
  {
    title: t("Vista de mapa"),
    category: t("Avanzado"),
    keywords: [
      "map view",
      "mapa",
      "pins",
      "lugares",
      "sitios",
      "coordenadas",
      "ubicacion",
      "ubicación",
    ],
    icon: MapIcon,
    run: (editor, range) => insertMedia(editor, range, { type: "mapView", attrs: { pins: [] } }),
  },
  {
    title: t("Lienzo"),
    category: t("Avanzado"),
    keywords: [
      "canvas",
      "dibujo",
      "dibujar",
      "pizarra",
      "escritura a mano",
      "manuscrito",
      "apuntes a mano",
      "boli",
      "lapiz",
      "lápiz",
    ],
    icon: PenTool,
    run: (editor, range) =>
      insertMedia(editor, range, { type: "canvasBlock", attrs: { strokes: [], height: 360 } }),
  },
  {
    title: t("Vista de gráfico"),
    category: t("Avanzado"),
    keywords: [
      "chart view",
      "grafico",
      "gráfico",
      "barras",
      "lineas",
      "líneas",
      "anillos",
      "donut",
      "estadisticas",
      "estadísticas",
      "numero",
      "número",
    ],
    icon: ChartColumn,
    run: (editor, range) =>
      insertMedia(editor, range, { type: "chartView", attrs: { chartType: "bar", entries: [] } }),
  },
  {
    title: t("Página"),
    category: t("Avanzado"),
    keywords: ["page", "subpagina", "subpágina", "pagina", "página"],
    icon: FileText,
    // Deletes the "/página" text immediately for a responsive feel, then
    // resolves the async page-creation call and inserts the link at the
    // spot it just cleared — see EditorBridge.ts for why this goes through
    // editor.storage rather than a React callback.
    run: (editor, range) => {
      const insertPos = range.from;
      editor.chain().focus().deleteRange(range).run();
      void editor.storage.editorBridge.createChildPage().then((page: { id: string }) => {
        editor
          .chain()
          .insertContentAt(insertPos, { type: "pageLink", attrs: { pageId: page.id } })
          .run();
      });
    },
  },
  {
    title: t("Página enlazada"),
    category: t("Avanzado"),
    keywords: ["linked page", "link", "pagina enlazada", "página enlazada", "enlace"],
    icon: Link2,
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "pageLink", attrs: { pageId: null } })
        .run(),
  },
  {
    title: t("Ruta de navegación"),
    category: t("Avanzado"),
    keywords: ["breadcrumb", "ruta", "navegacion", "navegación"],
    icon: Milestone,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: "breadcrumb" }).run(),
  },
  {
    title: t("Índice"),
    category: t("Avanzado"),
    keywords: ["toc", "table of contents", "indice", "índice"],
    icon: TableOfContentsIcon,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: "tableOfContents" }).run(),
  },
];

export function filterSlashCommandItems(query: string): SlashCommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMAND_ITEMS;
  const byTitle = SLASH_COMMAND_ITEMS.filter((item) => item.title.toLowerCase().includes(q));
  // A title match beats a keyword match: «/calendario» + Enter must give «Vista de calendario», not
  // «Fecha o recordatorio» just because that one lists «calendario» as a keyword and sits earlier.
  const byKeyword = SLASH_COMMAND_ITEMS.filter(
    (item) => !byTitle.includes(item) && item.keywords.some((k) => k.includes(q)),
  );
  return [...byTitle, ...byKeyword];
}
