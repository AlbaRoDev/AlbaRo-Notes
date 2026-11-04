// the actions of the in-page AI, as in Notion AI's menu.
import {
  AlignLeft,
  ArrowRightLeft,
  BookOpen,
  CheckSquare,
  Feather,
  Languages,
  Lightbulb,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Mail,
  Minimize2,
  Maximize2,
  MessageCircle,
  PenLine,
  Scale,
  SpellCheck,
  Table,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { t } from "../../lib/i18n.ts";

/** What the AI works on: the selection (as Markdown) or, with nothing selected, the page around the cursor. */
export interface AiContext {
  title: string;
  /** The selected blocks as Markdown, or null with nothing selected. */
  selection: string | null;
  /** The whole page as Markdown (trimmed to a size the model handles). */
  page: string;
  /** The page up to the cursor (for «Continuar escribiendo»). */
  before: string;
}

export interface AiAction {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  keywords?: string;
  /** Only with text selected / only with nothing selected. */
  scope: "selection" | "page";
  /** What the result usually does: replace the selection, or go below it. */
  primary: "replace" | "insert";
  /** The instruction for the model; absent for templates that need the user to finish the sentence. */
  instruction?: string;
  /** A template: fills the box («Lluvia de ideas sobre ») for the user to complete. */
  fill?: string;
}

const MAX_CONTEXT = 12_000;
const clip = (s: string) => (s.length > MAX_CONTEXT ? `${s.slice(0, MAX_CONTEXT)}\n…` : s);
const quoted = (s: string) => `"""\n${clip(s)}\n"""`;

const tone = (id: string, label: string, how: string): AiAction => ({
  id: `tone-${id}`,
  label,
  group: t("Cambiar el tono"),
  icon: MessageCircle,
  keywords: t("tono"),
  scope: "selection",
  primary: "replace",
  instruction: t("Reescribe el texto con un tono {how}, conservando el significado y el formato.", {
    how,
  }),
});

const translate = (scope: "selection" | "page", lang: string, name: string): AiAction => ({
  id: `translate-${scope}-${lang}`,
  label:
    scope === "selection"
      ? t("Traducir al {name}", { name })
      : t("Traducir la página al {name}", { name }),
  group: scope === "selection" ? t("Traducir") : t("Traducir la página"),
  icon: Languages,
  keywords: t("traducir idioma"),
  scope,
  primary: scope === "selection" ? "replace" : "insert",
  instruction: t("Traduce el texto al {name}. Conserva el formato.", { name }),
});

const LANGS: [string, string][] = [
  ["en", t("inglés")],
  ["es", t("español")],
  ["fr", t("francés")],
  ["de", t("alemán")],
  ["it", t("italiano")],
  ["pt", t("portugués")],
  ["ca", t("catalán")],
];

const AI_ACTIONS: AiAction[] = [
  // with text selected
  {
    id: "improve",
    label: t("Mejorar la redacción"),
    group: t("Editar o revisar"),
    icon: Wand2,
    scope: "selection",
    primary: "replace",
    instruction: t(
      "Mejora la redacción del texto: más claro, preciso y fluido, con el mismo significado y formato.",
    ),
  },
  {
    id: "fix",
    label: t("Corregir ortografía y gramática"),
    group: t("Editar o revisar"),
    icon: SpellCheck,
    keywords: t("faltas errores"),
    scope: "selection",
    primary: "replace",
    instruction: t(
      "Corrige la ortografía, la gramática y la puntuación del texto. No cambies nada más.",
    ),
  },
  {
    id: "shorter",
    label: t("Acortar"),
    group: t("Editar o revisar"),
    icon: Minimize2,
    keywords: t("resumir breve"),
    scope: "selection",
    primary: "replace",
    instruction: t("Acorta el texto a más o menos la mitad, conservando lo esencial y el formato."),
  },
  {
    id: "longer",
    label: t("Alargar"),
    group: t("Editar o revisar"),
    icon: Maximize2,
    keywords: t("ampliar extender"),
    scope: "selection",
    primary: "replace",
    instruction: t(
      "Amplía el texto con más detalle y explicación, manteniendo el tono y sin inventar datos.",
    ),
  },
  {
    id: "simplify",
    label: t("Simplificar el lenguaje"),
    group: t("Editar o revisar"),
    icon: Feather,
    keywords: t("sencillo claro"),
    scope: "selection",
    primary: "replace",
    instruction: t(
      "Reescribe el texto con un lenguaje sencillo y frases cortas, sin perder información.",
    ),
  },
  tone("professional", t("Profesional"), t("profesional")),
  tone("casual", t("Informal"), t("informal y cercano")),
  tone("direct", t("Directo"), t("directo y conciso")),
  tone("confident", t("Seguro"), t("seguro y convincente")),
  tone("friendly", t("Amable"), t("amable y cálido")),
  ...LANGS.map(([code, name]) => translate("selection", code, name)),
  {
    id: "summarize",
    label: t("Resumir"),
    group: t("Generar a partir de la selección"),
    icon: AlignLeft,
    scope: "selection",
    primary: "insert",
    instruction: t("Resume el texto en pocas frases o en una lista breve de puntos clave."),
  },
  {
    id: "explain",
    label: t("Explicar"),
    group: t("Generar a partir de la selección"),
    icon: BookOpen,
    keywords: t("qué significa"),
    scope: "selection",
    primary: "insert",
    instruction: t("Explica de forma sencilla qué quiere decir el texto."),
  },
  {
    id: "action-items",
    label: t("Buscar tareas pendientes"),
    group: t("Generar a partir de la selección"),
    icon: ListChecks,
    keywords: t("acciones to do"),
    scope: "selection",
    primary: "insert",
    instruction: t(
      "Extrae las tareas o acciones pendientes del texto como lista de tareas Markdown (- [ ] …). Si no hay ninguna, dilo en una sola línea.",
    ),
  },
  {
    id: "to-checklist",
    label: t("Convertir en checklist"),
    group: t("Convertir"),
    icon: CheckSquare,
    keywords: t("lista de tareas casillas"),
    scope: "selection",
    primary: "replace",
    instruction: t(
      "Convierte el texto en una lista de tareas Markdown (- [ ] …): un elemento por idea, con las mismas palabras y sin añadir nada.",
    ),
  },
  {
    id: "to-bullets",
    label: t("Convertir en lista con viñetas"),
    group: t("Convertir"),
    icon: List,
    scope: "selection",
    primary: "replace",
    instruction: t(
      "Convierte el texto en una lista con viñetas Markdown (- …): un elemento por idea, sin añadir nada.",
    ),
  },
  {
    id: "to-numbered",
    label: t("Convertir en lista numerada"),
    group: t("Convertir"),
    icon: ListOrdered,
    scope: "selection",
    primary: "replace",
    instruction: t(
      "Convierte el texto en una lista numerada Markdown (1. …): un elemento por idea, en orden, sin añadir nada.",
    ),
  },
  {
    id: "to-table",
    label: t("Convertir en tabla"),
    group: t("Convertir"),
    icon: Table,
    scope: "selection",
    primary: "replace",
    instruction: t(
      "Convierte el texto en una tabla Markdown con encabezados que tengan sentido. No añadas datos que no estén en el texto.",
    ),
  },
  {
    id: "to-paragraph",
    label: t("Convertir en texto corrido"),
    group: t("Convertir"),
    icon: ArrowRightLeft,
    keywords: t("párrafo prosa"),
    scope: "selection",
    primary: "replace",
    instruction: t(
      "Convierte el texto (listas, tablas…) en uno o varios párrafos de texto corrido, sin perder información.",
    ),
  },

  // with nothing selected: the page and the cursor
  {
    id: "continue",
    label: t("Continuar escribiendo"),
    group: t("Escribir"),
    icon: PenLine,
    keywords: t("seguir"),
    scope: "page",
    primary: "insert",
    instruction: t(
      "Continúa el texto de forma natural, con uno o dos párrafos que sigan su estilo y su tema. Escribe solo la continuación.",
    ),
  },
  {
    id: "page-summary",
    label: t("Resumir la página"),
    group: t("Generar a partir de la página"),
    icon: AlignLeft,
    scope: "page",
    primary: "insert",
    instruction: t(
      "Escribe un resumen de la página: un párrafo breve y, si ayuda, una lista de puntos clave.",
    ),
  },
  {
    id: "page-actions",
    label: t("Buscar tareas pendientes en la página"),
    group: t("Generar a partir de la página"),
    icon: ListChecks,
    keywords: t("acciones to do"),
    scope: "page",
    primary: "insert",
    instruction: t(
      "Extrae las tareas o acciones pendientes de la página como lista de tareas Markdown (- [ ] …). Si no hay ninguna, dilo en una sola línea.",
    ),
  },
  {
    id: "page-outline",
    label: t("Índice de la página"),
    group: t("Generar a partir de la página"),
    icon: ListTree,
    keywords: t("esquema estructura"),
    scope: "page",
    primary: "insert",
    instruction: t("Escribe un esquema de la página como lista anidada con sus ideas principales."),
  },
  ...LANGS.map(([code, name]) => translate("page", code, name)),
  {
    id: "brainstorm",
    label: t("Lluvia de ideas…"),
    group: t("Borrador"),
    icon: Lightbulb,
    keywords: t("ideas"),
    scope: "page",
    primary: "insert",
    fill: t("Lluvia de ideas sobre "),
  },
  {
    id: "outline",
    label: t("Esquema…"),
    group: t("Borrador"),
    icon: ListTree,
    keywords: t("índice estructura"),
    scope: "page",
    primary: "insert",
    fill: t("Esquema para "),
  },
  {
    id: "email",
    label: t("Email…"),
    group: t("Borrador"),
    icon: Mail,
    keywords: t("correo"),
    scope: "page",
    primary: "insert",
    fill: t("Email para "),
  },
  {
    id: "pros-cons",
    label: t("Pros y contras…"),
    group: t("Borrador"),
    icon: Scale,
    keywords: t("ventajas inconvenientes"),
    scope: "page",
    primary: "insert",
    fill: t("Pros y contras de "),
  },
  {
    id: "write-about",
    label: t("Escribir sobre…"),
    group: t("Borrador"),
    icon: PenLine,
    keywords: t("redactar"),
    scope: "page",
    primary: "insert",
    fill: t("Escribe sobre "),
  },
];

/** The user message for an action or a free instruction, with the text it works on. */
export function buildPrompt(instruction: string, ctx: AiContext, actionId?: string): string {
  if (ctx.selection !== null) return `${instruction}\n\n${t("Texto:")}\n${quoted(ctx.selection)}`;
  if (actionId === "continue")
    return `${instruction}\n\n${t("Texto hasta ahora:")}\n${quoted(ctx.before || ctx.title)}`;
  const page = ctx.page.trim()
    ? t("\n\nPágina «{title}»:\n{n2}", { title: ctx.title, n2: quoted(ctx.page) })
    : "";
  if (actionId?.startsWith("translate-page") || actionId?.startsWith("page-"))
    return `${instruction}${page}`;
  // a free instruction or a draft: the page is context, not the thing to transform
  return `${instruction}${page ? t("\n\nContexto (la página donde se escribirá):{page}", { page }) : ""}`;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The actions for this situation that match what the user typed (no accents, any case). */
export function matchingActions(hasSelection: boolean, query: string): AiAction[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return AI_ACTIONS.filter(
    (a) =>
      a.scope === (hasSelection ? "selection" : "page") &&
      words.every((w) => fold(`${a.label} ${a.group} ${a.keywords ?? ""}`).includes(w)),
  );
}
