import { SunMoon } from "lucide-react";
import { toggleTheme } from "../../lib/theme";
import { t } from "../../lib/i18n.ts";

/** Light/dark from the places that have no sidebar (the start screen, the Gestor). */
export function ThemeToggle() {
  return (
    <button
      type="button"
      className="ws-icon-button"
      onClick={toggleTheme}
      title={t("Cambiar entre tema claro y oscuro (Ctrl+Shift+L)")}
      aria-label={t("Cambiar entre tema claro y oscuro")}
    >
      <SunMoon size={16} />
    </button>
  );
}
