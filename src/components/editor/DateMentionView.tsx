import { useState, type KeyboardEvent } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { CalendarClock } from "lucide-react";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function DateMentionView({ node, updateAttributes, getPos, editor }: NodeViewProps) {
  const date = node.attrs.date as string | null;
  const [editing, setEditing] = useState(!date);
  // The input's own value while editing, kept as plain local React state —
  // never round-tripped through updateAttributes() until it's a complete,
  // valid date. A native <input type="date"> fires onChange per keystroke,
  // including mid-entry states (day typed, month/year still empty); writing
  // each of those back into node.attrs re-renders this NodeView with a new
  // `value` prop, and re-assigning a native date input's `.value` — even to
  // a "reasonable" intermediate string — resets its internal per-segment
  // typing buffer. That's what made a second keystroke start a fresh segment
  // instead of extending the first (typing "1" then "2" in the day gave
  // "02", not "12"): the write-back from the first digit's onChange clobbered
  // the buffer before the second digit landed. Keeping this local avoids
  // that entirely — the DOM node is never told a value it didn't just report.
  const [draft, setDraft] = useState(date ?? "");

  const returnFocusAfterSelf = () => {
    const pos = getPos();
    if (pos != null)
      editor
        .chain()
        .focus()
        .setTextSelection(pos + node.nodeSize)
        .run();
  };

  // Commits only a complete, well-formed date — an incomplete or invalid
  // draft is simply not saved (matching "nunca guardes valores intermedios";
  // Rust re-validates it's a real calendar date regardless).
  const commit = (): boolean => {
    if (!ISO_DATE.test(draft)) return false;
    updateAttributes({ date: draft });
    return true;
  };

  // Guard on `date` too, not just `editing` state: an out-of-sync `editing`
  // could otherwise leave formatDate() looking at a null date, which crashes
  // the whole editor (no error boundary above this tree).
  if (editing || !date) {
    return (
      <NodeViewWrapper as="span" className="date-mention-picker" contentEditable={false}>
        <input
          autoFocus
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (commit()) {
                setEditing(false);
                returnFocusAfterSelf();
              }
            }
          }}
          onBlur={() => {
            if (commit()) setEditing(false);
          }}
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      className="date-mention"
      contentEditable={false}
      role="button"
      tabIndex={0}
      onClick={() => {
        setDraft(date);
        setEditing(true);
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setDraft(date);
          setEditing(true);
        }
      }}
    >
      <CalendarClock size={14} strokeWidth={1.75} aria-hidden="true" />
      <span>{formatDate(date as string)}</span>
    </NodeViewWrapper>
  );
}

/** Builds the Date from local y/m/d parts — `new Date(isoString)` parses as UTC midnight and can display the previous day in negative-UTC-offset zones. */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(new Date(y, m - 1, d));
}
