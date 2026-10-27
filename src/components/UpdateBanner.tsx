import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { getAppUpdate, installAppUpdate, onAppUpdateAvailable } from "../lib/app-update";
import "./update-banner.css";

/** Longer than the autosave waits (800 ms the page, 600 ms a synced block): whatever was being typed is written first. */
const SETTLE_MS = 1000;

/**
 * «Hay una versión nueva». Rust looks for it in the background and only tells; nothing is downloaded or installed
 * until the button is pressed. «Más tarde» hides it until the next start (the next check, hours later, shows it again).
 */
export function UpdateBanner() {
  const [version, setVersion] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getAppUpdate().then(
      (update) => alive && update && setVersion(update.version),
      console.error,
    );
    const unlisten = onAppUpdateAvailable((update) => alive && setVersion(update.version));
    return () => {
      alive = false;
      void unlisten.then((off) => off()).catch(console.error);
    };
  }, []);

  if (version === null || hidden) return null;

  const install = async () => {
    setInstalling(true);
    setFailure(null);
    try {
      // Installing closes the app. A field still being edited commits when it loses focus, and the
      // autosave of a page has its own wait (Known limit: a fixed pause; a longer debounce someday needs more).
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      // On success the app restarts and this never settles.
      await installAppUpdate();
    } catch (err) {
      setInstalling(false);
      setFailure(String(err));
    }
  };

  return (
    <div className="update-note" role="status">
      <Download size={16} aria-hidden className="update-icon" />
      <div className="update-text">
        <p>
          Hay una versión nueva: <strong>{version}</strong>. Se descarga, se comprueba su firma y se
          reinicia la app.
        </p>
        {failure !== null && <p className="update-error">{failure}</p>}
        <div className="update-actions">
          <button
            type="button"
            className="update-install"
            disabled={installing}
            onClick={() => void install()}
          >
            {installing ? "Instalando…" : "Instalar y reiniciar"}
          </button>
          <button
            type="button"
            className="update-later"
            disabled={installing}
            onClick={() => setHidden(true)}
          >
            Más tarde
          </button>
        </div>
      </div>
      <button
        type="button"
        className="update-close"
        aria-label="Cerrar el aviso"
        disabled={installing}
        onClick={() => setHidden(true)}
      >
        <X size={14} />
      </button>
    </div>
  );
}
