import { useEffect, useSyncExternalStore } from "react";
import { answerConfirm, pendingQuestion, subscribeConfirm } from "../lib/confirm";
import "./confirm-host.css";

/** The dialog behind `askConfirm`. Enter confirms (the button has the focus), Esc or a click outside cancels. */
export function ConfirmHost() {
  const question = useSyncExternalStore(subscribeConfirm, pendingQuestion);

  useEffect(() => {
    if (!question) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && answerConfirm(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [question]);

  if (!question) return null;
  return (
    <div
      className="confirm-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && answerConfirm(false)}
    >
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={question.title}
      >
        <h3>{question.title}</h3>
        {question.detail && <p>{question.detail}</p>}
        <div className="confirm-actions">
          <button type="button" onClick={() => answerConfirm(false)}>
            Cancelar
          </button>
          <button
            type="button"
            className="confirm-danger"
            autoFocus
            onClick={() => answerConfirm(true)}
          >
            {question.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
