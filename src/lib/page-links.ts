import type { PageSummary } from "../types";

/** Pages that can be linked or mentioned from a note: not the task database nor its rows (those are the Gestor's). */
export function linkablePages(pages: PageSummary[]): PageSummary[] {
  const tasksBase = pages.find((p) => p.role === "tasks");
  return pages.filter(
    (p) =>
      p.role !== "tasks" && !(tasksBase?.ownDatabaseId && p.databaseId === tasksBase.ownDatabaseId),
  );
}

/** How many pages hang from this one at any depth: its sub-pages, or the rows of a database and what hangs from them. */
export function countBelow(pages: PageSummary[], id: string): number {
  return pages
    .filter((p) => p.parentId === id)
    .reduce((n, child) => n + 1 + countBelow(pages, child.id), 0);
}

// The «@» menu runs inside ProseMirror, outside React, so the page list reaches it through here
// (EditorAppProvider keeps it current).
let known: PageSummary[] = [];
export const setKnownPages = (pages: PageSummary[]) => {
  known = pages;
};
export const getKnownPages = () => known;

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** The linkable pages whose title has the query (accents and capitals aside), the ones that start with it first. */
export function searchPages(pages: PageSummary[], query: string, limit = 10): PageSummary[] {
  const q = fold(query.trim());
  const found = linkablePages(pages).filter((p) => fold(p.title).includes(q));
  found.sort((a, b) => Number(!fold(a.title).startsWith(q)) - Number(!fold(b.title).startsWith(q)));
  return found.slice(0, limit);
}
