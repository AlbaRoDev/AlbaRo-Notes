import { Search } from "lucide-react";
import { t } from "../../lib/i18n.ts";

/** Opens the search box from the bar. Only drawn under touch (`hover: none`): the desktop has Ctrl+K. */
export function SearchButton({ onSearch }: { onSearch: () => void }) {
  return (
    <button
      type="button"
      className="ws-icon-button ws-touch-only"
      onClick={onSearch}
      title={t("Buscar")}
      aria-label={t("Buscar")}
    >
      <Search size={16} />
    </button>
  );
}
