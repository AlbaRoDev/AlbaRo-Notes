import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Check, FileText, Loader2, RotateCcw, Settings, Sparkles, X } from "lucide-react";
import {
  aiApply,
  aiAsk,
  aiDiscard,
  aiGetSettings,
  aiIndex,
  aiStatus,
  hasModel,
  ONLINE_PROVIDERS,
  type AiProposal,
  type AiReply,
  type AiSettings,
  type AiStatus,
} from "../../lib/ai-client";
import { AiSetup } from "./AiSetup";
import { emitDatabaseChange } from "../../lib/database-bus";
import { todayIso } from "../../lib/date-utils";
import { TYPE_LABELS } from "../database/property-types";
import "./AiPanel.css";
import { t } from "../../lib/i18n.ts";

type Turn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; reply?: AiReply; error?: string };

type ProposalState =
  | { state: "pending" }
  | { state: "applying" }
  | { state: "applied"; pageId: string }
  | { state: "discarded" }
  | { state: "error"; message: string };

// The AI writes changes to the database through Rust; views showing it reload on this token.
const AI_SOURCE = Symbol("ai");

/** Model replies are light markdown: keep the line breaks and render **bold**; everything stays text. */
function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = text
    .split(/\*\*(.+?)\*\*/g)
    .map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
  return <div className="ai-text">{parts}</div>;
}

function showValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return t("vacío");
  if (typeof value === "boolean") return value ? t("marcada") : t("sin marcar");
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return String((value as { name?: string }).name ?? "");
  return String(value);
}

/**
 * The AI assistant, like Notion AI's chat: ask about your notes, have it draft a page
 * or change a database value. It is off until the user turns it on (`AiSetup`), then runs on the
 * local Ollama or online; every change it wants to make shows up as a card to apply or discard —
 * nothing is written until you press «Aplicar».
 */
export function AiPanel({
  open,
  onClose,
  onOpenPage,
  onPagesChanged,
  currentPageId,
}: {
  open: boolean;
  /** The page open in the editor: «esta base de datos» means the one on it. */
  currentPageId: string | null;
  onClose: () => void;
  onOpenPage: (pageId: string) => void;
  onPagesChanged: () => void;
}) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  // Rust keeps the conversation under this id; «Nueva conversación» starts another.
  const [chatId, setChatId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [indexing, setIndexing] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Record<string, ProposalState>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const mode = status?.mode ?? "off";
  const model = settings?.localModel ?? "";
  const ready =
    !!status?.running && (mode === "online" || (mode === "local" && hasModel(status, model)));

  const refresh = useCallback(() => {
    setStatus(null);
    void aiGetSettings().then(setSettings);
    void aiStatus().then((s) => {
      setStatus(s);
      // only the local mode has a model to embed with (on the CPU, and only the pages that changed)
      if (s.mode !== "local" || !s.running || !hasModel(s, s.embedModel)) return;
      // Bring semantic search up to date in the background (only changed pages are embedded).
      setIndexing(t("Preparando la búsqueda por significado…"));
      void aiIndex()
        .then(() => setIndexing(null))
        .catch(() => setIndexing(null));
    });
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  // The box is disabled until Ollama answers, so it takes the focus once it's ready.
  useEffect(() => {
    if (open && ready) inputRef.current?.focus();
  }, [open, ready]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns, busy]);

  const send = async () => {
    const question = draft.trim();
    if (!question || busy || !ready) return;
    const history = [...turns, { role: "user" as const, content: question }];
    setTurns(history);
    setDraft("");
    setBusy(true);
    try {
      const reply = await aiAsk(chatId, question, todayIso(), currentPageId);
      setProposals((prev) => ({
        ...prev,
        ...Object.fromEntries(reply.proposals.map((p) => [p.id, { state: "pending" as const }])),
      }));
      setTurns([...history, { role: "assistant", content: reply.text, reply }]);
    } catch (e) {
      setTurns([...history, { role: "assistant", content: "", error: String(e) }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const apply = async (proposal: AiProposal) => {
    setProposals((prev) => ({ ...prev, [proposal.id]: { state: "applying" } }));
    try {
      const applied = await aiApply(proposal.id);
      setProposals((prev) => ({
        ...prev,
        [proposal.id]: { state: "applied", pageId: applied.pageId },
      }));
      if (applied.databaseId) emitDatabaseChange(applied.databaseId, AI_SOURCE);
      onPagesChanged();
    } catch (e) {
      setProposals((prev) => ({ ...prev, [proposal.id]: { state: "error", message: String(e) } }));
    } finally {
      // the button just pressed is gone: put the focus back where the conversation goes on
      inputRef.current?.focus();
    }
  };

  const discard = (proposal: AiProposal) => {
    void aiDiscard(proposal.id);
    setProposals((prev) => ({ ...prev, [proposal.id]: { state: "discarded" } }));
    inputRef.current?.focus();
  };

  const setup = status !== null && settings !== null && (mode === "off" || configuring);
  const onSaved = (saved: AiSettings) => {
    setSettings(saved);
    setConfiguring(false);
    refresh();
  };

  return (
    <aside
      className="ai-panel"
      data-open={open}
      aria-label={t("Asistente de IA")}
      aria-hidden={!open}
    >
      <header className="ai-head">
        <Sparkles size={16} aria-hidden="true" />
        <span className="ai-head-title">{t("Asistente")}</span>
        <span className="ai-mode-label">
          {mode === "local"
            ? model
            : mode === "online"
              ? (ONLINE_PROVIDERS.find((p) => p.id === settings?.onlineProvider)?.label ??
                t("Online"))
              : ""}
        </span>
        <button
          type="button"
          className="ai-icon"
          title={t("Ajustes de la IA")}
          aria-label={t("Ajustes de la IA")}
          disabled={busy}
          onClick={() => setConfiguring((c) => !c)}
        >
          <Settings size={15} />
        </button>
        <button
          type="button"
          className="ai-icon"
          title={t("Nueva conversación")}
          aria-label={t("Nueva conversación")}
          disabled={busy || turns.length === 0}
          onClick={() => {
            setTurns([]);
            setChatId(crypto.randomUUID());
          }}
        >
          <RotateCcw size={15} />
        </button>
        <button
          type="button"
          className="ai-icon"
          title={t("Cerrar (Esc)")}
          aria-label={t("Cerrar asistente")}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>

      <div className="ai-body" ref={listRef}>
        {setup && (
          <AiSetup
            // a new form each time it opens, so it starts from what is saved
            key={String(configuring) + settings.mode}
            settings={settings}
            status={status}
            onSaved={onSaved}
            onCancel={mode === "off" ? undefined : () => setConfiguring(false)}
          />
        )}
        {status === null && <p className="ai-note">{t("Cargando…")}</p>}
        {!setup && mode === "local" && status && !status.running && (
          <div className="ai-note ai-warning" role="alert">
            {t(
              "Ollama no está en marcha en este equipo. Ábrelo (menú Inicio → Ollama) y pulsa «Reintentar».",
            )}
            <button type="button" onClick={refresh}>
              {t("Reintentar")}
            </button>
          </div>
        )}
        {!setup && mode === "local" && status?.running && !hasModel(status, model) && (
          <div className="ai-note ai-warning" role="alert">
            {t("Falta el modelo «{model}». Descárgalo con", { model })}{" "}
            <code>ollama pull {model}</code> {t("o elige otro en los ajustes (el engranaje).")}
          </div>
        )}
        {!setup && mode === "local" && status?.running && !hasModel(status, status.embedModel) && (
          <p className="ai-note">
            {t("Sin")} <code>{status.embedModel}</code> {t("la búsqueda es solo por palabras (")}
            <code>ollama pull {status.embedModel}</code>{" "}
            {t("para buscar también por significado).")}
          </p>
        )}
        {!setup && mode === "online" && !status?.running && (
          <div className="ai-note ai-warning" role="alert">
            {t(
              "Falta la clave de API o tu consentimiento. Revísalo en los ajustes (el engranaje).",
            )}
          </div>
        )}
        {!setup && turns.length === 0 && ready && (
          <div className="ai-empty">
            <Sparkles size={22} aria-hidden="true" />
            <p>{t("Pregunta sobre tus notas o pídeme que prepare algo.")}</p>
            <ul>
              <li>{t("«¿Qué tareas tengo pendientes?»")}</li>
              <li>{t("«Resume la página de recetas»")}</li>
              <li>{t("«Marca “Desplegar” como completada»")}</li>
              <li>{t("«Crea una página con la lista de la compra»")}</li>
            </ul>
            <p className="ai-fine">
              {mode === "online"
                ? t(
                    "Online: el texto de las notas que consulto se envía al servicio que elegiste. ",
                  )
                : t("Funciona en tu equipo con Ollama. ")}
              {t("Nada se cambia sin que pulses «Aplicar».")}
            </p>
          </div>
        )}

        {/* while the settings are open the conversation waits (it is kept) */}
        {!setup &&
          turns.map((turn, i) =>
            turn.role === "user" ? (
              <div key={i} className="ai-user">
                {turn.content}
              </div>
            ) : (
              <div key={i} className="ai-assistant">
                {turn.reply && turn.reply.steps.length > 0 && (
                  <div className="ai-steps">{turn.reply.steps.join(" · ")}</div>
                )}
                {turn.error ? (
                  <p className="ai-error" role="alert">
                    {turn.error}
                  </p>
                ) : (
                  <RichText text={turn.content} />
                )}
                {turn.reply?.proposals.map((p) => {
                  const s = proposals[p.id] ?? { state: "pending" };
                  return (
                    <div key={p.id} className="ai-proposal" data-state={s.state}>
                      {p.kind === "updateValues" ? (
                        <>
                          <div className="ai-proposal-title">
                            {t("«{db}» · {prop} →", { db: p.databaseName, prop: p.propertyName })}{" "}
                            <strong>{showValue(p.newValue)}</strong>{" "}
                            {t(p.rows.length === 1 ? "en {n} fila" : "en {n} filas", {
                              n: p.rows.length,
                            })}
                          </div>
                          <div className="ai-proposal-preview">
                            {p.rows
                              .slice(0, 6)
                              .map(
                                (r) =>
                                  `${r.title || t("Sin título")}: ${
                                    typeof p.newValue === "boolean" && !r.oldValue
                                      ? t("sin marcar")
                                      : showValue(r.oldValue)
                                  } → ${showValue(p.newValue)}`,
                              )
                              .join("\n")}
                            {p.rows.length > 6 && t("\n…y {n1} más", { n1: p.rows.length - 6 })}
                          </div>
                        </>
                      ) : p.kind === "changeType" ? (
                        <>
                          <div className="ai-proposal-title">
                            {t("«{db}» · convertir «{prop}» de {from} a", {
                              db: p.databaseName,
                              prop: p.propertyName,
                              from: TYPE_LABELS[p.from],
                            })}{" "}
                            <strong>{TYPE_LABELS[p.to]}</strong>
                          </div>
                          <div className="ai-proposal-preview">
                            {p.marked.length > 0
                              ? t("Quedarán marcadas las filas con: {n1}. Las demás, sin marcar.", {
                                  n1: p.marked.join(", "),
                                })
                              : t(
                                  p.values === 1
                                    ? "Lo que no encaje en el tipo nuevo se vacía (ahora 1 fila tiene valor)."
                                    : "Lo que no encaje en el tipo nuevo se vacía (ahora {n} filas tienen valor).",
                                  { n: p.values },
                                )}
                          </div>
                        </>
                      ) : p.kind === "createPage" ? (
                        <>
                          <div className="ai-proposal-title">
                            {p.parentTitle
                              ? t("Crear la página «{title}» dentro de «{parent}»", {
                                  title: p.title,
                                  parent: p.parentTitle,
                                })
                              : t("Crear la página «{title}»", { title: p.title })}
                          </div>
                          {p.paragraphs.length > 0 && (
                            <div className="ai-proposal-preview">
                              {p.paragraphs.slice(0, 4).join("\n")}
                              {p.paragraphs.length > 4 && "\n…"}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="ai-proposal-title">
                          «{p.rowTitle}» · {p.propertyName}: <s>{showValue(p.oldValue)}</s> →{" "}
                          <strong>{showValue(p.newValue)}</strong>
                        </div>
                      )}
                      <div className="ai-proposal-actions">
                        {s.state === "pending" && (
                          <>
                            <button
                              type="button"
                              className="ai-apply"
                              onClick={() => void apply(p)}
                            >
                              {t("Aplicar")}
                            </button>
                            <button type="button" onClick={() => discard(p)}>
                              {t("Descartar")}
                            </button>
                          </>
                        )}
                        {s.state === "applying" && <span>{t("Aplicando…")}</span>}
                        {s.state === "applied" && (
                          <>
                            <span className="ai-done">
                              <Check size={14} aria-hidden="true" /> {t("Aplicado")}
                            </span>
                            <button type="button" onClick={() => onOpenPage(s.pageId)}>
                              {t("Abrir")}
                            </button>
                          </>
                        )}
                        {s.state === "discarded" && <span>{t("Descartado")}</span>}
                        {s.state === "error" && (
                          <span className="ai-error" role="alert">
                            {s.message}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {turn.reply && turn.reply.sources.length > 0 && (
                  <div className="ai-sources">
                    {turn.reply.sources.slice(0, 8).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => onOpenPage(s.id)}
                        title={t("Abrir")}
                      >
                        <FileText size={13} aria-hidden="true" />
                        {s.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
        {!setup && busy && (
          <div className="ai-thinking">
            <Loader2 size={15} className="ai-spin" aria-hidden="true" /> {t("Pensando…")}
            {mode === "local" && t(" (si hace rato que no lo usas, carga el modelo y tarda más)")}
          </div>
        )}
      </div>

      {indexing && <div className="ai-indexing">{indexing}</div>}
      <form
        className="ai-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          maxLength={8000}
          value={draft}
          placeholder={
            ready
              ? t("Pregunta o pide algo…")
              : mode === "off"
                ? t("La IA está desactivada")
                : t("El asistente no está disponible")
          }
          disabled={!ready}
          aria-label={t("Mensaje para el asistente")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
        />
        <button
          type="submit"
          className="ai-send"
          aria-label={t("Enviar")}
          disabled={!ready || busy || !draft.trim()}
        >
          <ArrowUp size={16} />
        </button>
      </form>
    </aside>
  );
}
