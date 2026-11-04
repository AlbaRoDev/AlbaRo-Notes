import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { t } from "../../lib/i18n.ts";

/**
 * Minimize, maximize and close, at the right end of the top bar: the window has no frame of its own
 * (`decorations: false`), so the bar is its title bar. The empty parts of the bar drag it (`data-tauri-drag-region`).
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let alive = true;
    const sync = () => void win.isMaximized().then((m) => alive && setMaximized(m));
    sync();
    const unlisten = win.onResized(sync);
    return () => {
      alive = false;
      void unlisten.then((off) => off());
    };
  }, []);

  const win = () => getCurrentWindow();
  return (
    <div className="window-controls">
      <button
        type="button"
        onClick={() => void win().minimize()}
        title={t("Minimizar")}
        aria-label={t("Minimizar")}
      >
        <Minus size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => void win().toggleMaximize()}
        title={maximized ? t("Restaurar") : t("Maximizar")}
        aria-label={maximized ? t("Restaurar") : t("Maximizar")}
      >
        {maximized ? (
          <Copy size={13} aria-hidden="true" />
        ) : (
          <Square size={13} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        data-close
        onClick={() => void win().close()}
        title={t("Cerrar")}
        aria-label={t("Cerrar")}
      >
        <X size={17} aria-hidden="true" />
      </button>
    </div>
  );
}
