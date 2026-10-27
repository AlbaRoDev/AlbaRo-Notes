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
  group: "Cambiar el tono",
  icon: MessageCircle,
  keywords: "tono",
  scope: "selection",
  primary: "replace",
  instruction: `Reescribe el texto con un tono ${how}, conservando el significado y el formato.`,
});

const translate = (scope: "selection" | "page", lang: string, name: string): AiAction => ({
  id: `translate-${scope}-${lang}`,
  label: scope === "selection" ? `Traducir al ${name}` : `Traducir la página al ${name}`,
  group: scope === "selection" ? "Traducir" : "Traducir la página",
  icon: Languages,
  keywords: "traducir idioma",
  scope,
  primary: scope === "selection" ? "replace" : "insert",
  instruction: `Traduce el texto al ${name}. Conserva el formato.`,
});

const LANGS: [string, string][] = [
  ["en", "inglés"],
  ["es", "español"],
  ["fr", "francés"],
  ["de", "alemán"],
  ["it", "italiano"],
  ["pt", "portugués"],
  ["ca", "catalán"],
];

const AI_ACTIONS: AiAction[] = [
  // with text selected
  {
    id: "improve",
    label: "Mejorar la redacción",
    group: "Editar o revisar",
    icon: Wand2,
    scope: "selection",
    primary: "replace",
    instruction:
      "Mejora la redacción del texto: más claro, preciso y fluido, con el mismo significado y formato.",
  },
  {
    id: "fix",
    label: "Corregir ortografía y gramática",
    group: "Editar o revisar",
    icon: SpellCheck,
    keywords: "faltas errores",
    scope: "selection",
    primary: "replace",
    instruction:
      "Corrige la ortografía, la gramática y la puntuación del texto. No cambies nada más.",
  },
  {
    id: "shorter",
    label: "Acortar",
    group: "Editar o revisar",
    icon: Minimize2,
    keywords: "resumir breve",
    scope: "selection",
    primary: "replace",
    instruction: "Acorta el texto a más o menos la mitad, conservando lo esencial y el formato.",
  },
  {
    id: "longer",
    label: "Alargar",
    group: "Editar o revisar",
    icon: Maximize2,
    keywords: "ampliar extender",
    scope: "selection",
    primary: "replace",
    instruction:
      "Amplía el texto con más detalle y explicación, manteniendo el tono y sin inventar datos.",
  },
  {
    id: "simplify",
    label: "Simplificar el lenguaje",
    group: "Editar o revisar",
    icon: Feather,
    keywords: "sencillo claro",
    scope: "selection",
    primary: "replace",
    instruction:
      "Reescribe el texto con un lenguaje sencillo y frases cortas, sin perder información.",
  },
  tone("professional", "Profesional", "profesional"),
  tone("casual", "Informal", "informal y cercano"),
  tone("direct", "Directo", "directo y conciso"),
  tone("confident", "Seguro", "seguro y convincente"),
  tone("friendly", "Amable", "amable y cálido"),
  ...LANGS.map(([code, name]) => translate("selection", code, name)),
  {
    id: "summarize",
    label: "Resumir",
    group: "Generar a partir de la selección",
    icon: AlignLeft,
    scope: "selection",
    primary: "insert",
    instruction: "Resume el texto en pocas frases o en una lista breve de puntos clave.",
  },
  {
    id: "explain",
    label: "Explicar",
    group: "Generar a partir de la selección",
    icon: BookOpen,
    keywords: "qué significa",
    scope: "selection",
    primary: "insert",
    instruction: "Explica de forma sencilla qué quiere decir el texto.",
  },
  {
    id: "action-items",
    label: "Buscar tareas pendientes",
    group: "Generar a partir de la selección",
    icon: ListChecks,
    keywords: "acciones to do",
    scope: "selection",
    primary: "insert",
    instruction:
      "Extrae las tareas o acciones pendientes del texto como lista de tareas Markdown (- [ ] …). Si no hay ninguna, dilo en una sola línea.",
  },
  {
    id: "to-checklist",
    label: "Convertir en checklist",
    group: "Convertir",
    icon: CheckSquare,
    keywords: "lista de tareas casillas",
    scope: "selection",
    primary: "replace",
    instruction:
      "Convierte el texto en una lista de tareas Markdown (- [ ] …): un elemento por idea, con las mismas palabras y sin añadir nada.",
  },
  {
    id: "to-bullets",
    label: "Convertir en lista con viñetas",
    group: "Convertir",
    icon: List,
    scope: "selection",
    primary: "replace",
    instruction:
      "Convierte el texto en una lista con viñetas Markdown (- …): un elemento por idea, sin añadir nada.",
  },
  {
    id: "to-numbered",
    label: "Convertir en lista numerada",
    group: "Convertir",
    icon: ListOrdered,
    scope: "selection",
    primary: "replace",
    instruction:
      "Convierte el texto en una lista numerada Markdown (1. …): un elemento por idea, en orden, sin añadir nada.",
  },
  {
    id: "to-table",
    label: "Convertir en tabla",
    group: "Convertir",
    icon: Table,
    scope: "selection",
    primary: "replace",
    instruction:
      "Convierte el texto en una tabla Markdown con encabezados que tengan sentido. No añadas datos que no estén en el texto.",
  },
  {
    id: "to-paragraph",
    label: "Convertir en texto corrido",
    group: "Convertir",
    icon: ArrowRightLeft,
    keywords: "párrafo prosa",
    scope: "selection",
    primary: "replace",
    instruction:
      "Convierte el texto (listas, tablas…) en uno o varios párrafos de texto corrido, sin perder información.",
  },

  // with nothing selected: the page and the cursor
  {
    id: "continue",
    label: "Continuar escribiendo",
    group: "Escribir",
    icon: PenLine,
    keywords: "seguir",
    scope: "page",
    primary: "insert",
    instruction:
      "Continúa el texto de forma natural, con uno o dos párrafos que sigan su estilo y su tema. Escribe solo la continuación.",
  },
  {
    id: "page-summary",
    label: "Resumir la página",
    group: "Generar a partir de la página",
    icon: AlignLeft,
    scope: "page",
    primary: "insert",
    instruction:
      "Escribe un resumen de la página: un párrafo breve y, si ayuda, una lista de puntos clave.",
  },
  {
    id: "page-actions",
    label: "Buscar tareas pendientes en la página",
    group: "Generar a partir de la página",
    icon: ListChecks,
    keywords: "acciones to do",
    scope: "page",
    primary: "insert",
    instruction:
      "Extrae las tareas o acciones pendientes de la página como lista de tareas Markdown (- [ ] …). Si no hay ninguna, dilo en una sola línea.",
  },
  {
    id: "page-outline",
    label: "Índice de la página",
    group: "Generar a partir de la página",
    icon: ListTree,
    keywords: "esquema estructura",
    scope: "page",
    primary: "insert",
    instruction: "Escribe un esquema de la página como lista anidada con sus ideas principales.",
  },
  ...LANGS.map(([code, name]) => translate("page", code, name)),
  {
    id: "brainstorm",
    label: "Lluvia de ideas…",
    group: "Borrador",
    icon: Lightbulb,
    keywords: "ideas",
    scope: "page",
    primary: "insert",
    fill: "Lluvia de ideas sobre ",
  },
  {
    id: "outline",
    label: "Esquema…",
    group: "Borrador",
    icon: ListTree,
    keywords: "índice estructura",
    scope: "page",
    primary: "insert",
    fill: "Esquema para ",
  },
  {
    id: "email",
    label: "Email…",
    group: "Borrador",
    icon: Mail,
    keywords: "correo",
    scope: "page",
    primary: "insert",
    fill: "Email para ",
  },
  {
    id: "pros-cons",
    label: "Pros y contras…",
    group: "Borrador",
    icon: Scale,
    keywords: "ventajas inconvenientes",
    scope: "page",
    primary: "insert",
    fill: "Pros y contras de ",
  },
  {
    id: "write-about",
    label: "Escribir sobre…",
    group: "Borrador",
    icon: PenLine,
    keywords: "redactar",
    scope: "page",
    primary: "insert",
    fill: "Escribe sobre ",
  },
];

/** The user message for an action or a free instruction, with the text it works on. */
export function buildPrompt(instruction: string, ctx: AiContext, actionId?: string): string {
  if (ctx.selection !== null) return `${instruction}\n\nTexto:\n${quoted(ctx.selection)}`;
  if (actionId === "continue")
    return `${instruction}\n\nTexto hasta ahora:\n${quoted(ctx.before || ctx.title)}`;
  const page = ctx.page.trim() ? `\n\nPágina «${ctx.title}»:\n${quoted(ctx.page)}` : "";
  if (actionId?.startsWith("translate-page") || actionId?.startsWith("page-"))
    return `${instruction}${page}`;
  // a free instruction or a draft: the page is context, not the thing to transform
  return `${instruction}${page ? `\n\nContexto (la página donde se escribirá):${page}` : ""}`;
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
