import { useEffect } from "react";
import type { Scope } from "../../types";

/** «Editar / borrar un evento que se repite»: asks how far the change reaches, as Notion Calendar does. */
export function ScopeDialog({
  verb,
  onPick,
  onCancel,
}: {
  verb: "update" | "delete";
  onPick: (scope: Scope) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="cal-dialog-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="cal-dialog" role="dialog" aria-label="Evento recurrente">
        <h3>
          {verb === "delete" ? "Borrar un evento recurrente" : "Cambiar un evento recurrente"}
        </h3>
        <button type="button" autoFocus onClick={() => onPick("this")}>
          Solo este evento
        </button>
        <button type="button" onClick={() => onPick("following")}>
          Este y los siguientes
        </button>
        <button type="button" onClick={() => onPick("all")}>
          Todos los eventos
        </button>
        <button type="button" className="cal-dialog-cancel" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
