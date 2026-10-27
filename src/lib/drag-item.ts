/**
 * One drag-and-drop language for the whole app (HTML5 drag and drop, `dragDropEnabled: false` in the Tauri config):
 * every source says what it carries and every target reads it the same way. Pointer-event versions will be needed on mobile.
 */
const ITEM_MIME = "application/x-albaro-item";

export interface DragItem {
  kind: "page" | "task";
  id: string;
}

export function startItemDrag(e: React.DragEvent, item: DragItem): void {
  e.dataTransfer.setData(ITEM_MIME, JSON.stringify(item));
  e.dataTransfer.effectAllowed = "copyLink";
}

/** During a drag the payload can't be read, only its types: enough to decide whether to accept a drop. */
export function hasDragItem(e: { dataTransfer: DataTransfer | null }): boolean {
  return e.dataTransfer?.types.includes(ITEM_MIME) ?? false;
}

/** The payload of a drop, or `null` when it isn't one of ours or is malformed. */
export function readDragItem(e: { dataTransfer: DataTransfer | null }): DragItem | null {
  try {
    const raw = e.dataTransfer?.getData(ITEM_MIME);
    if (!raw) return null;
    const item = JSON.parse(raw) as Partial<DragItem>;
    return (item.kind === "page" || item.kind === "task") && typeof item.id === "string"
      ? { kind: item.kind, id: item.id }
      : null;
  } catch {
    return null;
  }
}

/* Boards: a card also carries its own id, so a board can tell «move this card» from «add this task». */
const CARD_MIME = "application/x-albaro-card";
const LIST_MIME = "application/x-albaro-list";

/** A card drags as its task (it can be dropped on the calendar or into a note) and as a card of its board. */
export function startCardDrag(e: React.DragEvent, card: { id: string; taskId: string }): void {
  startItemDrag(e, { kind: "task", id: card.taskId });
  e.dataTransfer.setData(CARD_MIME, card.id);
  e.dataTransfer.effectAllowed = "all";
}

export const hasCardDrag = (e: { dataTransfer: DataTransfer | null }): boolean =>
  e.dataTransfer?.types.includes(CARD_MIME) ?? false;

export const readCardDrag = (e: { dataTransfer: DataTransfer | null }): string | null =>
  e.dataTransfer?.getData(CARD_MIME) || null;

export function startListDrag(e: React.DragEvent, listId: string): void {
  e.dataTransfer.setData(LIST_MIME, listId);
  e.dataTransfer.effectAllowed = "move";
}

export const hasListDrag = (e: { dataTransfer: DataTransfer | null }): boolean =>
  e.dataTransfer?.types.includes(LIST_MIME) ?? false;

export const readListDrag = (e: { dataTransfer: DataTransfer | null }): string | null =>
  e.dataTransfer?.getData(LIST_MIME) || null;
