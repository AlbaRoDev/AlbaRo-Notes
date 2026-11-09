import { useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import { isMobile } from "../lib/viewport.ts";
import { MIN_WEBVIEW, outdatedWebview } from "../lib/webview-version.ts";
import { t } from "../lib/i18n.ts";
import "./update-banner.css";

/** On a phone whose system WebView is older than the app supports: what to update. Closing it hides it until the next start. */
export function WebviewNotice() {
  const [hidden, setHidden] = useState(false);
  const version = isMobile ? outdatedWebview(navigator.userAgent) : null;
  if (version === null || hidden) return null;
  return (
    <div className="update-note" role="status">
      <TriangleAlert size={16} aria-hidden className="update-icon" />
      <div className="update-text">
        <p>
          {t(
            "El WebView de tu sistema (Chrome {version}) es antiguo y parte de la app puede fallar. Actualiza «Android System WebView» en Google Play (hace falta la versión {min} o posterior).",
            { version, min: MIN_WEBVIEW },
          )}
        </p>
      </div>
      <button
        type="button"
        className="update-close"
        aria-label={t("Cerrar el aviso")}
        onClick={() => setHidden(true)}
      >
        <X size={14} />
      </button>
    </div>
  );
}
