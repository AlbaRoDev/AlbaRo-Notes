import { SunMoon } from "lucide-react";
import { toggleTheme } from "../../lib/theme";

/** Light/dark from the places that have no sidebar (the start screen, the Gestor). */
export function ThemeToggle() {
  return (
    <button
      type="button"
      className="ws-icon-button"
      onClick={toggleTheme}
      title="Cambiar entre tema claro y oscuro (Ctrl+Shift+L)"
      aria-label="Cambiar entre tema claro y oscuro"
    >
      <SunMoon size={16} />
    </button>
  );
}
