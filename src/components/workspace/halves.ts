import { CalendarCheck, FileText, type LucideIcon } from "lucide-react";
import type { Half } from "../../lib/workspace";

export const HALVES: Record<Half, { label: string; blurb: string; Icon: LucideIcon; key: string }> =
  {
    notes: {
      label: "Notas",
      blurb: "Páginas, bases de datos y la IA para tus apuntes",
      Icon: FileText,
      key: "1",
    },
    manager: {
      label: "Gestor",
      blurb: "Calendario, tareas, tableros y familias",
      Icon: CalendarCheck,
      key: "2",
    },
  };
