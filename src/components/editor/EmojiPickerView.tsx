import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  Clock,
  Flag,
  Hash,
  Lightbulb,
  PawPrint,
  Plane,
  Smile,
  User,
  UtensilsCrossed,
  Volleyball,
  type LucideIcon,
} from "lucide-react";
import {
  EMOJI_CATEGORIES,
  addRecentEmoji,
  getRecentEmoji,
  loadEmojiData,
  matchesEmoji,
  type EmojiEntry,
} from "./emoji-data";

const RECENT_GROUP = -1;
const MAX_RESULTS = 200;

const GROUP_ICONS: Record<number, LucideIcon> = {
  [RECENT_GROUP]: Clock,
  0: Smile,
  1: User,
  3: PawPrint,
  4: UtensilsCrossed,
  5: Plane,
  6: Volleyball,
  7: Lightbulb,
  8: Hash,
  9: Flag,
};

export function EmojiPickerView({ node, getPos, editor }: NodeViewProps) {
  const [entries, setEntries] = useState<EmojiEntry[] | null>(null);
  // Read once on mount — this node gets deleted the moment a pick happens
  // (see `pick` below), so there's no later render where an updated list
  // would ever be shown from this same instance.
  const [recent] = useState<string[]>(() => getRecentEmoji());
  // `:smi` typed in the text opens the picker already searching for «smi»
  const [query, setQuery] = useState(() => String(node.attrs.query ?? ""));
  const [activeGroup, setActiveGroup] = useState(() =>
    getRecentEmoji().length > 0 ? RECENT_GROUP : 0,
  );

  useEffect(() => {
    let cancelled = false;
    void loadEmojiData().then((data) => {
      if (!cancelled) setEntries(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const byChar = useMemo(() => {
    const map = new Map<string, EmojiEntry>();
    for (const e of entries ?? []) map.set(e.char, e);
    return map;
  }, [entries]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!entries) return [];
    if (q) {
      return entries.filter((e) => matchesEmoji(e, q)).slice(0, MAX_RESULTS);
    }
    if (activeGroup === RECENT_GROUP) {
      return recent.map((c) => byChar.get(c)).filter((e): e is EmojiEntry => e != null);
    }
    return entries.filter((e) => e.group === activeGroup);
  }, [entries, q, activeGroup, recent, byChar]);

  const range = () => {
    const pos = getPos();
    return pos == null ? null : { from: pos, to: pos + node.nodeSize };
  };

  const pick = (char: string) => {
    const r = range();
    if (!r) return;
    addRecentEmoji(char);
    editor.chain().focus().deleteRange(r).insertContentAt(r.from, char).run();
  };

  const dismiss = () => {
    const r = range();
    if (!r) return;
    editor.chain().focus().deleteRange(r).run();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      dismiss();
    } else if (e.key === "Enter" && results[0]) {
      e.preventDefault();
      pick(results[0].char);
    }
  };

  const categories =
    recent.length > 0
      ? [{ group: RECENT_GROUP, label: "Recientes" }, ...EMOJI_CATEGORIES]
      : EMOJI_CATEGORIES;

  return (
    <NodeViewWrapper as="span" className="emoji-picker" contentEditable={false}>
      <input
        autoFocus
        type="text"
        placeholder="Buscar emoji…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="emoji-picker-popup" onMouseDown={(e) => e.preventDefault()}>
        {!q && (
          <div className="emoji-picker-tabs">
            {categories.map((c) => {
              const Icon = GROUP_ICONS[c.group];
              return (
                <button
                  key={c.group}
                  type="button"
                  title={c.label}
                  aria-label={c.label}
                  data-active={c.group === activeGroup}
                  onClick={() => setActiveGroup(c.group)}
                >
                  <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        )}
        <div className="emoji-picker-list">
          {!entries && <span className="emoji-picker-empty">Cargando…</span>}
          {entries &&
            results.map((e) => (
              <button key={e.hexcode} type="button" onClick={() => pick(e.char)} title={e.label}>
                {e.char}
              </button>
            ))}
          {entries && results.length === 0 && (
            <span className="emoji-picker-empty">Sin resultados</span>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}
