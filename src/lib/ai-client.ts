// the AI, through Rust: off by default, then either local (Ollama) or online (the
// user's own API key). The model only reaches the notes through Rust's tools; changes it wants
// to make come back as proposals the user applies or discards.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PropertyKind } from "../types";

export type AiMode = "off" | "local" | "online";

/** Models that read handwriting (they must accept images): bigger than the chat ones. */
export const LOCAL_VISION_CHOICES = [
  { name: "qwen2.5vl:7b", label: "~6 GB · el recomendado" },
  { name: "qwen2.5vl:3b", label: "~3 GB · más ligero, lee peor" },
  { name: "llama3.2-vision", label: "~8 GB" },
];

/** Models offered in the settings (Ollama can run others: the installed ones are listed too). */
export const LOCAL_MODEL_CHOICES = [
  { name: "qwen2.5:3b", label: "Ligero · ~2 GB · equipos modestos" },
  { name: "qwen2.5:7b", label: "Equilibrado · ~4,7 GB" },
  { name: "qwen2.5:14b", label: "Potente · ~9 GB · tarjeta gráfica potente" },
];
export type AiProvider = "groq" | "gemini" | "openrouter" | "anthropic";

/**
 * The online services (Rust's `ai::Provider`). Groq, Gemini and OpenRouter have free plans,
 * rate-limited per minute and per day; Anthropic is paid. `models` are suggestions: any model the
 * service offers can be typed.
 */
export const ONLINE_PROVIDERS: {
  id: AiProvider;
  label: string;
  free: boolean;
  /** Where the user gets a key. */
  keyUrl: string;
  model: string;
  models: string[];
  /** What to know about its data before sending notes there. */
  note: string;
  /** The model that reads handwriting (it must accept images). */
  visionModel: string;
}[] = [
  {
    id: "groq",
    label: "Groq",
    free: true,
    keyUrl: "console.groq.com/keys",
    model: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "qwen/qwen3-32b"],
    note: "Plan gratuito sin tarjeta, muy rápido; con límite de peticiones por minuto y por día.",
    visionModel: "meta-llama/llama-4-scout-17b-16e-instruct",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    free: true,
    keyUrl: "aistudio.google.com/apikey",
    model: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    note: "Plan gratuito con límites. Google puede usar lo que envíes en el plan gratuito para mejorar sus productos: no lo uses con notas privadas.",
    visionModel: "gemini-2.5-flash",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    free: true,
    keyUrl: "openrouter.ai/keys",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    models: ["meta-llama/llama-3.3-70b-instruct:free", "qwen/qwen3-32b:free"],
    note: "Modelos gratuitos (los que acaban en :free), con límites bajos; cada modelo tiene su propia política de datos.",
    visionModel: "openrouter/free",
  },
  {
    id: "anthropic",
    label: "Anthropic (de pago)",
    free: false,
    keyUrl: "console.anthropic.com",
    model: "claude-haiku-4-5-20251001",
    models: ["claude-haiku-4-5-20251001", "claude-sonnet-5-5"],
    note: "De pago por uso; por defecto Anthropic no entrena con los datos de su API.",
    visionModel: "claude-haiku-4-5-20251001",
  },
];

/** The saved settings; the API key itself never reaches the window, only whether there is one. */
export interface AiSettings {
  mode: AiMode;
  onlineProvider: AiProvider;
  localModel: string;
  localCpuOnly: boolean;
  onlineModel: string;
  /** The models that read a handwritten canvas. */
  localVisionModel: string;
  onlineVisionModel: string;
  hasKey: boolean;
  /** Where the key is kept: the system's credential store, a file (this system has no store) or nowhere. */
  keyStorage: "system" | "file" | "none";
  onlineConsent: boolean;
}

/** What the window sends to change them; `apiKey` undefined keeps the saved key, "" removes it. */
export type AiSettingsInput = Omit<AiSettings, "hasKey" | "keyStorage"> & { apiKey?: string };

export interface AiStatus {
  mode: AiMode;
  hasKey: boolean;
  running: boolean;
  version: string | null;
  models: string[];
  embedModel: string;
}

export type AiProposal =
  | {
      kind: "createPage";
      id: string;
      title: string;
      paragraphs: string[];
      parentId: string | null;
      parentTitle: string | null;
    }
  | {
      kind: "updateValue";
      id: string;
      rowId: string;
      rowTitle: string;
      databaseId: string;
      propertyId: string;
      propertyName: string;
      oldValue: unknown;
      newValue: unknown;
    }
  /** The same cell changed on several rows of one database («ponlas todas como completadas»). */
  | {
      kind: "updateValues";
      id: string;
      databaseId: string;
      databasePageId: string;
      databaseName: string;
      propertyId: string;
      propertyName: string;
      newValue: unknown;
      rows: { id: string; title: string; oldValue: unknown }[];
    }
  /** A column turned into another type; `marked` = the options that end up checked (selection → checkbox). */
  | {
      kind: "changeType";
      id: string;
      databaseId: string;
      databasePageId: string;
      databaseName: string;
      propertyId: string;
      propertyName: string;
      from: PropertyKind;
      to: PropertyKind;
      marked: string[];
      values: number;
    };

export interface AiReply {
  text: string;
  sources: { id: string; title: string }[];
  proposals: AiProposal[];
  steps: string[];
}

export interface AiApplied {
  pageId: string;
  databaseId: string | null;
}

export async function aiStatus(): Promise<AiStatus> {
  return invoke<AiStatus>("ai_status");
}

export async function aiGetSettings(): Promise<AiSettings> {
  return invoke<AiSettings>("ai_get_settings");
}

export async function aiSetSettings(settings: AiSettingsInput): Promise<AiSettings> {
  return invoke<AiSettings>("ai_set_settings", { settings });
}

/** Embeds the pages that changed (semantic search); resolves to how many. */
export async function aiIndex(): Promise<number> {
  return invoke<number>("ai_index");
}

/** One turn of conversation `chatId` (Rust keeps the conversation, tool calls included). */
export async function aiAsk(
  chatId: string,
  message: string,
  today: string,
  pageId: string | null,
): Promise<AiReply> {
  // `pageId`: the page the user has open, so «esta base de datos» means the one on it
  return invoke<AiReply>("ai_ask", { chatId, message, today, pageId });
}

/** Reads a handwritten canvas (a base64 PNG, no `data:` prefix) with the AI's vision model and returns its text. */
export async function aiReadHandwriting(image: string): Promise<string> {
  return invoke<string>("ai_read_handwriting", { image });
}

export async function aiApply(id: string): Promise<AiApplied> {
  return invoke<AiApplied>("ai_apply", { id });
}

export async function aiDiscard(id: string): Promise<void> {
  return invoke("ai_discard", { id });
}

/** Whether Ollama has a model, matching `name` with or without its `:latest` tag. */
export function hasModel(status: AiStatus, name: string): boolean {
  return status.models.some((m) => m === name || m === `${name}:latest`);
}

export interface WriteMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Writing for the page (Notion AI): the model's text streams in through `ai-write` events and
 * `onText` gets everything so far after each piece. `cancel` stops it («Detener»); `done`
 * resolves with the whole text (whatever arrived, if stopped).
 */
export function aiWrite(
  messages: WriteMessage[],
  onText: (text: string) => void,
): { done: Promise<string>; cancel: () => void } {
  const id = crypto.randomUUID();
  let text = "";
  const done = (async () => {
    const unlisten = await listen<{ id: string; chunk: string }>("ai-write", (event) => {
      if (event.payload.id !== id) return;
      text += event.payload.chunk;
      onText(text);
    });
    try {
      return await invoke<string>("ai_write", { id, messages });
    } finally {
      unlisten();
    }
  })();
  return { done, cancel: () => void invoke("ai_cancel", { id }) };
}
