import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import type { PageSummary } from "../../types";
import { PageIcon } from "../PageIcon";
import { PageRef } from "./PageRef";
import { linkablePages } from "../../lib/page-links";

/** How long the pointer rests on a step before its list opens, and how long the list waits before closing when it leaves. */
const OPEN_MS = 150;
const CLOSE_MS = 250;
const MENU_WIDTH = 260;

/** The page's icon and title, as a step of the path shows them. */
function Crumb({ page }: { page: PageSummary }) {
  return (
    <>
      {page.icon && (
        <span aria-hidden="true">
          <PageIcon icon={page.icon} size={14} />
        </span>
      )}
      <span className="page-crumb-title">{page.title || "Sin título"}</span>
    </>
  );
}

/** The pages under `parentId` (the root ones for null), never a database's rows or the tasks. */
function pagesUnder(parentId: string | null, pages: PageSummary[]): PageSummary[] {
  return linkablePages(pages).filter((p) => !p.databaseId && p.parentId === parentId);
}

/**
 * One step of the path. Resting the pointer on it opens the list of the pages beside it (the one you are on
 * marked; an arrow on those that hold pages, which open to the side), pressing it goes there. From the keyboard,
 * Enter opens the list instead. A page with no siblings to list (a row of a database, the tasks) has no list.
 */
export function CrumbStep({
  page,
  pages,
  current,
  onOpen,
}: {
  page: PageSummary;
  pages: PageSummary[];
  current: boolean;
  onOpen: (pageId: string) => void;
}) {
  const [menu, setMenu] = useState<{ rect: DOMRect; keyboard: boolean } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const siblings = pagesUnder(page.parentId, pages);
  const listed = siblings.some((p) => p.id === page.id);

  const stopTimer = useCallback(() => window.clearTimeout(timer.current), []);
  const closeSoon = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMenu(null), CLOSE_MS);
  }, []);
  useEffect(() => stopTimer, [stopTimer]);

  // Esc or a press outside both the step and its lists closes them; Esc from the keyboard gives the focus back.
  useEffect(() => {
    if (!menu) return;
    const down = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest(".crumb-menu") && !button.current?.contains(target)) setMenu(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu(null);
      if (menu.keyboard) button.current?.focus();
    };
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [menu]);

  const go = (pageId: string) => {
    stopTimer();
    setMenu(null);
    onOpen(pageId);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup={listed ? "menu" : undefined}
        aria-expanded={listed ? menu !== null : undefined}
        aria-current={current ? "page" : undefined}
        onClick={(e) => {
          if (e.detail === 0 && listed && button.current) {
            // Enter or Space: there is no pointer to rest, so it opens the list
            setMenu({ rect: button.current.getBoundingClientRect(), keyboard: true });
          } else if (!current) go(page.id);
        }}
        onMouseEnter={() => {
          if (!listed) return;
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => {
            if (button.current)
              setMenu({ rect: button.current.getBoundingClientRect(), keyboard: false });
          }, OPEN_MS);
        }}
        onMouseLeave={closeSoon}
      >
        <Crumb page={page} />
      </button>
      {menu && (
        <PageMenu
          anchor={{ left: menu.rect.left, top: menu.rect.bottom + 4 }}
          items={siblings}
          pages={pages}
          markedId={page.id}
          focus={menu.keyboard}
          onPick={go}
          onPointer={(inside) => (inside ? stopTimer() : closeSoon())}
        />
      )}
    </>
  );
}

/**
 * A list of pages floating at `anchor`: arrows move, Enter goes, → opens the pages of the one under the cursor
 * (resting the pointer on it does the same) and ← closes them. Those lists are PageMenus themselves, so they nest.
 */
function PageMenu({
  anchor,
  items,
  pages,
  markedId,
  focus,
  onPick,
  onPointer,
  onBack,
}: {
  anchor: { left: number; top: number };
  items: PageSummary[];
  pages: PageSummary[];
  markedId?: string;
  focus: boolean;
  onPick: (pageId: string) => void;
  /** Only for the first list: the pointer is over (true) or has left (false) it and its sub-lists. */
  onPointer?: (inside: boolean) => void;
  /** Only for sub-lists: close this one and give the focus back to its row. */
  onBack?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [child, setChild] = useState<{ id: string; rect: DOMRect; keyboard: boolean } | null>(null);

  useEffect(() => {
    if (!focus) return;
    const rows = box.current?.querySelectorAll<HTMLElement>(":scope > [role=menuitem]");
    (box.current?.querySelector<HTMLElement>(":scope > [aria-current]") ?? rows?.[0])?.focus();
  }, [focus]);

  const open = (page: PageSummary, row: HTMLElement, keyboard: boolean) => {
    const hasPages = pagesUnder(page.id, pages).length > 0;
    setChild(hasPages ? { id: page.id, rect: row.getBoundingClientRect(), keyboard } : null);
  };

  const flip = anchor.left + MENU_WIDTH > window.innerWidth;

  return createPortal(
    <div
      ref={box}
      className="crumb-menu"
      role="menu"
      aria-label="Páginas de este nivel"
      style={{ left: anchor.left, top: anchor.top, width: MENU_WIDTH }}
      onMouseEnter={() => onPointer?.(true)}
      onMouseLeave={() => onPointer?.(false)}
      onKeyDown={(e) => {
        // keys of a sub-list also reach this one through the React tree: only those from its own rows count
        if (!box.current?.contains(e.target as Node)) return;
        const rows = [
          ...(box.current?.querySelectorAll<HTMLElement>(":scope > [role=menuitem]") ?? []),
        ];
        const at = rows.indexOf(document.activeElement as HTMLElement);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const step = e.key === "ArrowDown" ? 1 : -1;
          rows[(at + step + rows.length) % rows.length]?.focus();
        } else if (e.key === "ArrowRight" && at >= 0) {
          const page = items[at];
          if (page) {
            e.preventDefault();
            open(page, rows[at], true);
          }
        } else if (e.key === "ArrowLeft" && onBack) {
          e.preventDefault();
          e.stopPropagation();
          onBack();
        }
      }}
    >
      {items.map((p) => {
        const hasPages = pagesUnder(p.id, pages).length > 0;
        return (
          <button
            key={p.id}
            type="button"
            role="menuitem"
            aria-current={p.id === markedId ? "true" : undefined}
            aria-haspopup={hasPages ? "menu" : undefined}
            aria-expanded={hasPages ? child?.id === p.id : undefined}
            onClick={() => onPick(p.id)}
            onMouseEnter={(e) => open(p, e.currentTarget, false)}
          >
            <PageRef page={p} />
            {hasPages && <ChevronRight className="crumb-menu-arrow" size={14} aria-hidden="true" />}
          </button>
        );
      })}
      {child && (
        <PageMenu
          key={child.id}
          anchor={{
            left: flip ? anchor.left - MENU_WIDTH - 2 : child.rect.right + 2,
            top: child.rect.top - 6,
          }}
          items={pagesUnder(child.id, pages)}
          pages={pages}
          focus={child.keyboard}
          onPick={onPick}
          onBack={() => {
            setChild(null);
            box.current?.querySelector<HTMLElement>(`:scope > [aria-expanded="true"]`)?.focus();
          }}
        />
      )}
    </div>,
    document.body,
  );
}
