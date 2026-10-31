export interface EmojiEntry {
  char: string;
  hexcode: string;
  label: string;
  tags: string[];
  group: number;
}

export interface EmojiCategory {
  group: number;
  label: string;
}

/** emojibase's own group numbering — 2 ("component": skin tones, hair styles) is deliberately absent, they're modifiers, not standalone emoji. */
export const EMOJI_CATEGORIES: EmojiCategory[] = [
  { group: 0, label: "Caras" },
  { group: 1, label: "Personas" },
  { group: 3, label: "Animales" },
  { group: 4, label: "Comida" },
  { group: 5, label: "Viajes" },
  { group: 6, label: "Actividades" },
  { group: 7, label: "Objetos" },
  { group: 8, label: "Símbolos" },
  { group: 9, label: "Banderas" },
];

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Whether the emoji's name or tags have every word typed, without minding accents or capitals. */
export function matchesEmoji(emoji: EmojiEntry, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [emoji.label, ...emoji.tags].map(fold);
  return words.every((w) => haystack.some((h) => h.includes(w)));
}

const RECENT_KEY = "albaro-notes:recent-emoji";
const MAX_RECENT = 24;

/** Best-effort — a private window or blocked storage just means no recents row, not a broken picker. */
export function getRecentEmoji(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function addRecentEmoji(char: string): void {
  try {
    const current = getRecentEmoji().filter((c) => c !== char);
    localStorage.setItem(RECENT_KEY, JSON.stringify([char, ...current].slice(0, MAX_RECENT)));
  } catch {
    // ignore — storage unavailable
  }
}

interface CompactEmoji {
  unicode?: string;
  hexcode: string;
  label: string;
  tags?: string[];
  group?: number;
}

let cache: Promise<EmojiEntry[]> | null = null;

/**
 * The full Unicode dataset (emojibase-data, Spanish locale) loaded as its own
 * chunk on first use — dynamic import so it never lands in the main app
 * bundle, only fetched once the picker actually opens (and it's a bundled
 * local file either way, no network request; the app runs fully offline).
 */
export function loadEmojiData(): Promise<EmojiEntry[]> {
  if (!cache) {
    cache = import("emojibase-data/es/compact.json").then((mod) => {
      const raw = mod.default as unknown as CompactEmoji[];
      return raw
        .filter(
          (e): e is CompactEmoji & { unicode: string; group: number } =>
            e.unicode != null && e.group !== undefined && e.group !== 2,
        )
        .map((e) => ({
          char: e.unicode,
          hexcode: e.hexcode,
          label: e.label,
          tags: e.tags ?? [],
          group: e.group,
        }));
    });
  }
  return cache;
}
