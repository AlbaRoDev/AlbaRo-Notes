import { Database, FileText } from "lucide-react";
import { PageIcon } from "../PageIcon";
import type { PageSummary } from "../../types";

/** A page as a link shows it, Notion's way: its icon (its own, or the document or table one) and its title. */
export function PageRef({ page, size = 16 }: { page: PageSummary | undefined; size?: number }) {
  const Fallback = page?.kind === "database" ? Database : FileText;
  return (
    <>
      <span className="page-ref-icon" aria-hidden="true">
        {page?.icon ? (
          <PageIcon icon={page.icon} size={size} />
        ) : (
          <Fallback size={size} strokeWidth={1.75} />
        )}
      </span>
      <span className="page-ref-title">
        {page ? page.title || "Sin título" : "Página eliminada"}
      </span>
    </>
  );
}
