import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { MARK_COLORS } from "../components/editor/ColorMarks";

/** Every icon of the library by name (`Rocket`, `ArrowRight`…). */
export type IconLibrary = Record<string, LucideIcon>;

/** The colours an icon can take (Notion's names; App.css has the figures as `--text-<name>`). */
export const ICON_COLORS = MARK_COLORS;

export type ParsedIcon =
  { kind: "emoji"; text: string } | { kind: "lucide"; name: string; color: string | null };

const LUCIDE = /^lucide:([A-Za-z0-9]+)(?::([a-z]+))?$/;

/**
 * What an icon string is: an emoji, or `lucide:Name` / `lucide:Name:colour` from the library. Columns saved a bare
 * `Name` before the library existed, so with `bare` a name like `Rocket` is an icon too (a page never had those).
 */
export function parseIcon(icon: string, bare = false): ParsedIcon {
  const m = LUCIDE.exec(icon);
  if (m) {
    const color = (ICON_COLORS as readonly string[]).includes(m[2]) ? m[2] : null;
    return { kind: "lucide", name: m[1], color };
  }
  if (bare && /^[A-Z][A-Za-z0-9]+$/.test(icon)) return { kind: "lucide", name: icon, color: null };
  return { kind: "emoji", text: icon };
}

export const formatIcon = (name: string, color: string | null) =>
  color ? `lucide:${name}:${color}` : `lucide:${name}`;

let library: Promise<IconLibrary> | null = null;

/**
 * The whole library (some 1,900 icons) is a chunk of its own, fetched the first time an icon from it has to be
 * drawn or the picker opens; the app's own few icons are in the main bundle and never wait for it.
 */
const loadIconLibrary = () =>
  (library ??= import("lucide-react/dist/esm/icons/index.mjs").then((m) => m as IconLibrary));

/** The library once it has arrived, else null. With `enabled` false it is not asked for. */
export function useIconLibrary(enabled = true): IconLibrary | null {
  const [lib, setLib] = useState<IconLibrary | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadIconLibrary().then((l) => !cancelled && setLib(l));
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return lib;
}

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** Spanish words people look icons up by, to the English words of the library's names (no accents). */
const ES_EN: Record<string, string[]> = {
  agua: ["droplet", "waves"],
  ajustes: ["settings", "sliders"],
  archivo: ["file"],
  arbol: ["tree"],
  auriculares: ["headphones"],
  avion: ["plane"],
  bandera: ["flag"],
  barco: ["ship", "sailboat"],
  bateria: ["battery"],
  bici: ["bike"],
  bombilla: ["lightbulb"],
  borrar: ["trash", "eraser"],
  buscar: ["search"],
  caja: ["box", "package"],
  cafe: ["coffee"],
  calendario: ["calendar"],
  camara: ["camera"],
  camion: ["truck"],
  campana: ["bell"],
  candado: ["lock"],
  carpeta: ["folder"],
  carrito: ["shopping-cart"],
  carta: ["mail"],
  casa: ["house", "home"],
  chincheta: ["pin"],
  cinta: ["tape", "ribbon"],
  coche: ["car"],
  codigo: ["code"],
  cohete: ["rocket"],
  compartir: ["share"],
  compra: ["shopping"],
  configuracion: ["settings"],
  corazon: ["heart"],
  correo: ["mail"],
  cuaderno: ["notebook"],
  datos: ["database"],
  descargar: ["download"],
  diana: ["target"],
  dinero: ["dollar", "coins", "banknote"],
  documento: ["file-text"],
  editar: ["pencil", "edit"],
  enlace: ["link"],
  escudo: ["shield"],
  escuela: ["school", "graduation-cap"],
  estrella: ["star"],
  estudio: ["graduation-cap", "book"],
  etiqueta: ["tag"],
  flecha: ["arrow"],
  flor: ["flower"],
  foto: ["camera", "image"],
  fruta: ["apple", "cherry"],
  fuego: ["flame"],
  gato: ["cat"],
  globo: ["globe"],
  gota: ["droplet"],
  grafico: ["chart"],
  guardar: ["save"],
  herramienta: ["wrench", "hammer"],
  hoja: ["leaf"],
  hora: ["clock"],
  idea: ["lightbulb"],
  imagen: ["image"],
  imprimir: ["printer"],
  juego: ["gamepad"],
  lapiz: ["pencil"],
  libro: ["book"],
  lista: ["list"],
  llave: ["key"],
  lluvia: ["cloud-rain"],
  lugar: ["map-pin"],
  luna: ["moon"],
  lupa: ["search"],
  maleta: ["briefcase", "luggage"],
  mano: ["hand"],
  mapa: ["map"],
  mas: ["plus"],
  menos: ["minus"],
  microfono: ["mic"],
  montana: ["mountain"],
  mundo: ["globe"],
  musica: ["music"],
  nieve: ["snowflake"],
  nota: ["sticky-note", "notebook"],
  nube: ["cloud"],
  objetivo: ["target"],
  ojo: ["eye"],
  ordenador: ["laptop", "monitor"],
  paquete: ["package"],
  papelera: ["trash"],
  pastel: ["cake"],
  pelicula: ["film", "clapperboard"],
  perro: ["dog"],
  persona: ["user"],
  personas: ["users"],
  planta: ["sprout", "leaf"],
  quitar: ["x", "minus"],
  rayo: ["zap"],
  regalo: ["gift"],
  reloj: ["clock", "watch"],
  risa: ["laugh", "smile"],
  salud: ["heart-pulse", "stethoscope"],
  seguridad: ["shield", "lock"],
  sol: ["sun"],
  sonido: ["volume", "audio"],
  subir: ["upload"],
  tabla: ["table"],
  tarea: ["check", "list-todo"],
  telefono: ["phone", "smartphone"],
  texto: ["text", "type"],
  tiempo: ["timer", "clock"],
  tren: ["train"],
  trabajo: ["briefcase"],
  triste: ["frown"],
  trofeo: ["trophy"],
  ubicacion: ["map-pin"],
  usuario: ["user"],
  video: ["video", "film"],
  viento: ["wind"],
  vino: ["wine"],
};

/** The icons whose name has every word typed (in English, or in Spanish through the table above). */
export function searchIcons(names: string[], query: string): string[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return names;
  const options = words.map((w) => [
    w,
    ...(w.length >= 3
      ? Object.entries(ES_EN)
          .filter(([es]) => es.startsWith(w))
          .flatMap(([, en]) => en)
      : []),
  ]);
  return names.filter((name) => {
    const key = kebab(name);
    return options.every((alts) => alts.some((a) => key.includes(a)));
  });
}
