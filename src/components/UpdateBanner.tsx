import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import {
  type AppUpdate,
  checkAppUpdate,
  getAppUpdate,
  installAppUpdate,
  onAppUpdateAvailable,
  onUpdateCheckRequested,
} from "../lib/app-update";
import "./update-banner.css";
import { t } from "../lib/i18n.ts";

/** Longer than the autosave waits (800 ms the page, 600 ms a synced block): whatever was being typed is written first. */
const SETTLE_MS = 1000;
/** How long «Ya tienes la última versión» stays up. */
const UP_TO_DATE_MS = 4000;

/**
 * «Hay una versión nueva». Rust looks for it in the background and only tells; nothing is downloaded or installed
 * until the button is pressed. «Más tarde» hides it until the next start (the next check, hours later, shows it again).
 */
export function UpdateBanner() {
  const [version, setVersion] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** The outcome of a manual «Buscar actualizaciones» while there is no new version to offer. */
  const [check, setCheck] = useState<{
    text: string;
    busy: boolean;
    error?: boolean;
    /** Stays until closed (it tells what to do next). */
    keep?: boolean;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    const offer = (update: AppUpdate) => {
      setVersion(update.version);
      setManual(update.manual);
    };
    void getAppUpdate().then((update) => alive && update && offer(update), console.error);
    const unlisten = onAppUpdateAvailable((update) => alive && offer(update));
    const offCheck = onUpdateCheckRequested(() => {
      setHidden(false);
      setCheck({ text: t("Buscando actualizaciones…"), busy: true });
      checkAppUpdate().then(
        (update) => {
          if (!alive) return;
          if (update) {
            offer(update);
            setCheck(null);
          } else {
            setCheck({ text: t("Ya tienes la última versión."), busy: false });
          }
        },
        (err) =>
          alive &&
          setCheck({ text: t("No se pudo comprobar: {err}", { err }), busy: false, error: true }),
      );
    });
    return () => {
      alive = false;
      offCheck();
      void unlisten.then((off) => off()).catch(console.error);
    };
  }, []);

  // «Ya tienes la última versión» fades by itself; an error stays until it is closed.
  useEffect(() => {
    if (check === null || check.busy || check.error || check.keep) return;
    const timer = setTimeout(() => setCheck(null), UP_TO_DATE_MS);
    return () => clearTimeout(timer);
  }, [check]);

  if ((version === null || hidden) && check !== null) {
    return (
      <div className="update-note" role="status">
        <Download size={16} aria-hidden className="update-icon" />
        <div className="update-text">
          <p className={check.error ? "update-error" : undefined}>{check.text}</p>
        </div>
        {!check.busy && (
          <button
            type="button"
            className="update-close"
            aria-label={t("Cerrar el aviso")}
            onClick={() => setCheck(null)}
          >
            <X size={14} />
          </button>
        )}
      </div>
    );
  }

  if (version === null || hidden) return null;

  const install = async () => {
    setInstalling(true);
    setFailure(null);
    try {
      // Installing closes the app. A field still being edited commits when it loses focus, and the
      // autosave of a page has its own wait (Known limit: a fixed pause; a longer debounce someday needs more).
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      if (!manual) await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      // On success the app restarts and this never settles; on the phone it settles once the download is opened.
      await installAppUpdate();
      setInstalling(false);
      setHidden(true);
      setCheck({
        text: t(
          "Se abre la descarga en el navegador. Cuando termine, ábrela para instalar la nueva versión.",
        ),
        busy: false,
        keep: true,
      });
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
          {t("Hay una versión nueva:")} <strong>{version}</strong>
          {manual
            ? t(". Se descarga desde GitHub y la instalas tú, sin cables.")
            : t(". Se descarga, se comprueba su firma y se reinicia la app.")}
        </p>
        {failure !== null && <p className="update-error">{failure}</p>}
        <div className="update-actions">
          <button
            type="button"
            className="update-install"
            disabled={installing}
            onClick={() => void install()}
          >
            {installing ? t("Instalando…") : manual ? t("Descargar") : t("Instalar y reiniciar")}
          </button>
          <button
            type="button"
            className="update-later"
            disabled={installing}
            onClick={() => setHidden(true)}
          >
            {t("Más tarde")}
          </button>
        </div>
      </div>
      <button
        type="button"
        className="update-close"
        aria-label={t("Cerrar el aviso")}
        disabled={installing}
        onClick={() => setHidden(true)}
      >
        <X size={14} />
      </button>
    </div>
  );
}
