import { CalendarCheck, FileText, type LucideIcon } from "lucide-react";
import type { Half } from "../../lib/workspace";
import { t } from "../../lib/i18n.ts";

export const HALVES: Record<Half, { label: string; blurb: string; Icon: LucideIcon; key: string }> =
  {
    notes: {
      label: t("Notas"),
      blurb: t("Páginas, bases de datos y la IA para tus apuntes"),
      Icon: FileText,
      key: "1",
    },
    manager: {
      label: t("Gestor"),
      blurb: t("Calendario, tareas, tableros y familias"),
      Icon: CalendarCheck,
      key: "2",
    },
  };
