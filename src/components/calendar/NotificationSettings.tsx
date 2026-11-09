import { useEffect, useRef, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import {
  NOTIFICATION_LEADS,
  getNotificationSettings,
  notificationPermission,
  setNotificationSettings,
  testNotification,
  type NotificationSettings as Settings,
} from "../../lib/db-client";
import { t } from "../../lib/i18n.ts";
import { isMobile } from "../../lib/viewport.ts";

const leadLabel = (m: number) =>
  m === 0 ? t("A la hora") : m === 60 ? t("1 hora antes") : t("{m} min antes", { m });

/**
 * The bell in the calendar's bar: turns the system notifications of the entries on or off, picks how early they come
 * and shows a sample. The watching itself is Rust's (`notifications.rs`); this only edits what it reads.
 */
export function NotificationSettings({ onError }: { onError: (message: string | null) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [open, setOpen] = useState(false);
  // a phone asks the person once (Android 13+); `false` = the system blocks the app's notices
  const [allowed, setAllowed] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getNotificationSettings()
      .then(setSettings)
      .catch((e) => onError(String(e)));
  }, [onError]);

  const enabled = settings?.enabled;
  useEffect(() => {
    if (!isMobile || !enabled) return;
    notificationPermission(true)
      .then(setAllowed)
      .catch(() => setAllowed(true));
  }, [enabled]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const change = (next: Settings) => {
    // Rust validates and answers with what it kept; a refusal leaves the screen as it was
    setNotificationSettings(next)
      .then((saved) => {
        setSettings(saved);
        onError(null);
      })
      .catch((e) => onError(String(e)));
  };

  if (!settings) return null;
  const Icon = settings.enabled ? Bell : BellOff;
  return (
    <div className="cal-notify" ref={rootRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={t("Avisos del calendario")}
        title={t("Avisos del sistema cuando llega la hora de una cita")}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="cal-notify-pop" role="dialog" aria-label={t("Avisos del calendario")}>
          <label className="cal-notify-row">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => change({ ...settings, enabled: e.target.checked })}
            />
            {t("Avisar de las citas con hora")}
          </label>
          <label className="cal-notify-row">
            {t("Cuándo")}
            <select
              value={settings.leadMinutes}
              disabled={!settings.enabled}
              onChange={(e) => change({ ...settings, leadMinutes: Number(e.target.value) })}
            >
              {NOTIFICATION_LEADS.map((m) => (
                <option key={m} value={m}>
                  {leadLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() =>
              testNotification()
                .then(() => onError(null))
                .catch((e) => onError(t("No se pudo mostrar el aviso: {n1}", { n1: String(e) })))
            }
          >
            {t("Probar un aviso")}
          </button>
          {settings.enabled && !allowed && (
            <p className="cal-notify-hint" role="alert">
              {t(
                "El sistema tiene bloqueados los avisos de esta app: actívalos en los ajustes del móvil (Aplicaciones → AlbaRo Notes → Notificaciones).",
              )}
            </p>
          )}
          <p className="cal-notify-hint">
            {isMobile
              ? t(
                  "Los avisos de las próximas dos semanas los programa el sistema y suenan aunque la app esté cerrada; se actualizan al abrirla. Pueden llegar unos minutos tarde con el ahorro de batería. Las citas de todo el día y las fechas límite no tienen hora, así que no avisan.",
                )
              : t(
                  "Solo se avisa con la aplicación abierta. Las citas de todo el día y las fechas límite no tienen hora, así que no avisan.",
                )}
          </p>
        </div>
      )}
    </div>
  );
}
