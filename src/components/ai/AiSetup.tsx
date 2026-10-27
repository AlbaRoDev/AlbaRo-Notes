import { useState } from "react";
import {
  LOCAL_MODEL_CHOICES,
  LOCAL_VISION_CHOICES,
  ONLINE_PROVIDERS,
  aiSetSettings,
  type AiMode,
  type AiProvider,
  type AiSettings,
  type AiStatus,
} from "../../lib/ai-client";

const MODES: { mode: AiMode; title: string; text: string }[] = [
  {
    mode: "off",
    title: "Desactivada",
    text: "No se ejecuta nada: ni modelo, ni tarjeta gráfica, ni red. La app funciona igual sin IA.",
  },
  {
    mode: "local",
    title: "En este equipo (Ollama)",
    text: "Privado: tus notas no salen del equipo. Hay que instalar Ollama (ollama.com) y descargar un modelo. Gasta memoria y, mientras responde, procesador o tarjeta gráfica; se libera a los 2 minutos.",
  },
  {
    mode: "online",
    title: "Online (gratis o de pago)",
    text: "Funciona en cualquier equipo, sin tarjeta gráfica. Usas tu propia clave de un servicio con plan gratuito (Groq, Gemini, OpenRouter) o de pago (Anthropic). El texto de las notas que la IA consulte se envía a ese servicio.",
  },
];

/**
 * Where the AI runs, chosen by the user (it is off until they do): not at all, on this machine
 * through Ollama, or online with their own key. The key goes to Rust and never comes back.
 */
/** Where the saved key really is, said plainly. */
function keyWhere(storage: AiSettings["keyStorage"]): string {
  if (storage === "system")
    return "La clave se guarda en el almacén de credenciales del sistema, no en la carpeta de datos de la app (así no viaja en una copia de las notas).";
  if (storage === "file")
    return "Este sistema no ofrece un almacén de credenciales: la clave se guarda en un fichero de la carpeta de datos de la app, visible solo para tu usuario, y viaja en cualquier copia de esa carpeta.";
  return "La clave se guardará en el almacén de credenciales del sistema si lo hay; si no, en un fichero de la carpeta de datos, visible solo para tu usuario.";
}

export function AiSetup({
  settings,
  status,
  onSaved,
  onCancel,
}: {
  settings: AiSettings;
  status: AiStatus | null;
  onSaved: (settings: AiSettings) => void;
  onCancel?: () => void;
}) {
  const [mode, setMode] = useState<AiMode>(settings.mode);
  const [localModel, setLocalModel] = useState(settings.localModel);
  const [cpuOnly, setCpuOnly] = useState(settings.localCpuOnly);
  const [provider, setProvider] = useState<AiProvider>(settings.onlineProvider);
  const [onlineModel, setOnlineModel] = useState(settings.onlineModel);
  const [localVision, setLocalVision] = useState(settings.localVisionModel);
  const [onlineVision, setOnlineVision] = useState(settings.onlineVisionModel);
  const [consent, setConsent] = useState(settings.onlineConsent);
  // undefined = keep the saved key; a string (even empty) replaces or removes it
  const [apiKey, setApiKey] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // the suggestions, plus whatever is installed in Ollama (and the model saved before)
  const installed =
    status?.mode === "local" ? status.models.filter((m) => !m.includes("embed")) : [];
  const localNames = [
    ...new Set([...LOCAL_MODEL_CHOICES.map((c) => c.name), ...installed, localModel]),
  ];
  const labelOf = (name: string) => LOCAL_MODEL_CHOICES.find((c) => c.name === name)?.label;

  const service = ONLINE_PROVIDERS.find((p) => p.id === provider) ?? ONLINE_PROVIDERS[0];
  // a key belongs to its service: with another one chosen the saved key doesn't count (Rust drops it)
  const sameProvider = provider === settings.onlineProvider;
  const keyShown = apiKey ?? "";
  const willHaveKey = apiKey === undefined ? settings.hasKey && sameProvider : apiKey.trim() !== "";

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await aiSetSettings({
          mode,
          localModel,
          localCpuOnly: cpuOnly,
          onlineProvider: provider,
          onlineModel,
          localVisionModel: localVision,
          onlineVisionModel: onlineVision,
          onlineConsent: consent,
          apiKey,
        }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="ai-setup"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2>Asistente de IA</h2>
      <p className="ai-fine">
        Es opcional y empieza desactivado. Elige dónde quieres que funcione; puedes cambiarlo cuando
        quieras con el engranaje del asistente.
      </p>

      {MODES.map((m) => (
        <label key={m.mode} className="ai-choice" data-selected={mode === m.mode}>
          <input
            type="radio"
            name="ai-mode"
            checked={mode === m.mode}
            onChange={() => setMode(m.mode)}
          />
          <span>
            <strong>{m.title}</strong>
            <span className="ai-choice-text">{m.text}</span>
          </span>
        </label>
      ))}

      {mode === "local" && (
        <div className="ai-setup-fields">
          <label>
            Modelo
            <select value={localModel} onChange={(e) => setLocalModel(e.target.value)}>
              {localNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                  {labelOf(name) ? ` — ${labelOf(name)}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Modelo para leer escritura a mano (lienzo)
            <input
              type="text"
              list="ai-local-vision"
              spellCheck={false}
              maxLength={100}
              value={localVision}
              onChange={(e) => setLocalVision(e.target.value.trim())}
            />
            <datalist id="ai-local-vision">
              {LOCAL_VISION_CHOICES.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.label}
                </option>
              ))}
            </datalist>
          </label>
          <p className="ai-fine">
            Los modelos que ven imágenes pesan mucho (<code>ollama pull {localVision}</code>): en un
            equipo modesto usa mejor un servicio online para la escritura a mano.
          </p>
          <label className="ai-check">
            <input
              type="checkbox"
              checked={cpuOnly}
              onChange={(e) => setCpuOnly(e.target.checked)}
            />
            Solo procesador (no usar la tarjeta gráfica; más lento)
          </label>
          <p className="ai-fine">
            Si falta, descárgalo con <code>ollama pull {localModel}</code>. La búsqueda por
            significado usa además <code>nomic-embed-text</code>, siempre en el procesador.
          </p>
        </div>
      )}

      {mode === "online" && (
        <div className="ai-setup-fields">
          <label>
            Servicio
            <select
              value={provider}
              onChange={(e) => {
                const next =
                  ONLINE_PROVIDERS.find((p) => p.id === e.target.value) ?? ONLINE_PROVIDERS[0];
                setProvider(next.id);
                setOnlineModel(next.model); // each service has its own models
                setOnlineVision(next.visionModel);
                setApiKey(undefined);
              }}
            >
              {ONLINE_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.free ? " · plan gratuito" : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="ai-fine">
            {service.note} Saca tu clave en <code>{service.keyUrl}</code>.
          </p>
          <label>
            Clave de API de {service.label}
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={keyShown}
              placeholder={
                settings.hasKey && sameProvider && apiKey === undefined
                  ? "Guardada · deja vacío para conservarla"
                  : "Pega aquí tu clave"
              }
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          {settings.hasKey && sameProvider && apiKey === undefined && (
            <button type="button" className="ai-link" onClick={() => setApiKey("")}>
              Quitar la clave guardada
            </button>
          )}
          <label>
            Modelo
            <input
              type="text"
              list="ai-online-models"
              spellCheck={false}
              maxLength={100}
              value={onlineModel}
              onChange={(e) => setOnlineModel(e.target.value.trim())}
            />
            <datalist id="ai-online-models">
              {service.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <label>
            Modelo para leer escritura a mano (lienzo)
            <input
              type="text"
              spellCheck={false}
              maxLength={100}
              value={onlineVision}
              onChange={(e) => setOnlineVision(e.target.value.trim())}
            />
          </label>
          <label className="ai-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Entiendo que el texto de mis notas que la IA consulte, el que le pida escribir o
            reescribir y las imágenes de escritura a mano que le envíe se mandan a {service.label}{" "}
            por internet.
          </label>
          <p className="ai-fine">
            {keyWhere(settings.keyStorage)} Nunca vuelve a la interfaz. Sin modelo local no hay
            búsqueda por significado: busca por palabras.
          </p>
          {!willHaveKey && <p className="ai-fine">Falta la clave.</p>}
        </div>
      )}

      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
      <div className="ai-setup-actions">
        <button
          type="submit"
          className="ai-apply"
          disabled={
            saving ||
            (mode === "online" && (!willHaveKey || !consent || !onlineModel || !onlineVision))
          }
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
