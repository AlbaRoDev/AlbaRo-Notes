# AlbaRo Notes

[English](README.md)

Una aplicación de escritorio libre y abierta para tus notas y tu organización personal: páginas con editor de
bloques, bases de datos con muchos tipos de vista, un gestor de tareas con calendario y tableros, y un asistente de
IA opcional. Todo se guarda en tu ordenador, sin cuentas, sin anuncios y sin telemetría.

![Una página con títulos, una lista de tareas, una lista, una cita y un destacado](screenshots/notes.png)

La interfaz está por ahora solo en español.

## Qué hace

- **Editor de bloques**: títulos, listas, listas de tareas, citas, destacados, desplegables, columnas, pestañas,
  tablas, código con resaltado de sintaxis, ecuaciones, imágenes, vídeo, audio, archivos, marcadores web y bloques
  sincronizados entre páginas. Escribe `/` para insertar cualquiera. Icono y portada de página, ruta de navegación,
  favoritos y `Ctrl+K` para buscar y ejecutar acciones.
- **Bases de datos**: una base de datos es una página propia, con propiedades tipadas (texto, número, fecha y rango
  de fechas, selección, selección múltiple, casilla, relación, lugar) y todas las vistas guardadas que quieras:
  tabla, lista, galería, tablero, calendario, cronograma, mapa, gráfico, panel de control y formulario. Filtra,
  ordena y agrupa cada vista.
- **Gestor personal**: lista de tareas, calendario (día, semana y mes, eventos repetidos, exportación a `.ics`),
  tableros al estilo Trello donde una tarjeta es una referencia a una tarea, y «familias» que agrupan las tareas por
  lo que tienen en común. Arrastra una tarea desde cualquiera de ellos al calendario o a un tablero.
- **Lienzo de escritura a mano**: dibuja o escribe sobre una hoja infinita, conserva la tinta tal cual, o conviértela
  en texto o en imagen cuando quieras.
- **Importa** archivos Markdown, Word y HTML, o una carpeta entera, como páginas.
- **Asistente de IA opcional**, apagado por defecto. Local con [Ollama](https://ollama.com/), u online con tu propia
  clave (Groq, Gemini y OpenRouter tienen plan gratuito; Anthropic es de pago). Busca en tus notas y escribe en tus
  páginas, pero nunca cambia tus datos por sí solo: cada cambio es una propuesta que tú aplicas o descartas.
- **Todo en local**: una base de datos SQLite en tu carpeta de usuario. Tema claro y oscuro, y una paleta que sigue
  las estaciones del año.

![Una semana en el calendario](screenshots/calendar.png)

![Un tablero cuyas tarjetas son tareas](screenshots/board.png)

Las capturas usan datos inventados.

## Instalar

Descarga el instalador de la [página de versiones](https://github.com/AlbaRoDev/AlbaRo-Notes/releases).

| Sistema       | Archivo           | Estado                |
| ------------- | ----------------- | --------------------- |
| Windows 10/11 | Instalador `.exe` | Plataforma principal  |
| Linux         |                   | Todavía no disponible |
| macOS         |                   | Todavía no disponible |

**Windows y SmartScreen.** El instalador aún no está firmado con un certificado de pago, así que SmartScreen puede
mostrar «Windows protegió su PC». Si lo has descargado de la página de versiones, pulsa _Más información_ y después
_Ejecutar de todas formas_. Cada versión publica el SHA-256 de su instalador: compáralo con el del archivo que has
descargado (`Get-FileHash <archivo>` en PowerShell) si quieres estar seguro de que no ha cambiado.

**Actualizaciones.** La app mira en GitHub si hay una versión nueva al arrancar y cada 12 horas. Solo te avisa: no
descarga ni instala nada hasta que pulsas el botón, y antes comprueba la firma de la actualización con la clave del
proyecto.

## Privacidad

Tus notas viven en una base de datos SQLite **en tu ordenador**. No hay cuentas, telemetría ni servidor propio. Lo
único que sale de tu equipo es lo que tú activas:

| Qué                                                                                                     | A dónde                                                           | Cuándo                                                                                      |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| El texto de las notas que la IA consulta o reescribe, y las imágenes de escritura a mano que conviertes | El servicio online elegido (Groq, Gemini, OpenRouter o Anthropic) | Solo con la IA en modo «online», con tu clave **y** tu consentimiento. Apagada por defecto  |
| Nada (todo queda en tu equipo)                                                                          | Ollama, en `127.0.0.1`                                            | Con la IA en modo «local»                                                                   |
| La dirección que escribes (el servidor ve tu IP y esa dirección, no tus notas)                          | Esa web                                                           | Solo cuando escribes una dirección en un bloque de imagen, vídeo, audio, archivo o marcador |
| Qué zonas del mapa miras                                                                                | OpenStreetMap                                                     | Al ver un mapa (las teselas se guardan en caché)                                            |
| El lugar que buscas                                                                                     | Nominatim (OpenStreetMap)                                         | Solo al pulsar «Buscar» en un lugar                                                         |
| Tu IP, para ver si hay una versión nueva                                                                | GitHub                                                            | Al arrancar y cada 12 horas (no se instala nada solo)                                       |
| La dirección de un enlace                                                                               | Tu navegador                                                      | Al abrirlo con Ctrl+clic                                                                    |

La clave de API del servicio de IA se guarda en el almacén de credenciales del sistema (Windows y macOS; en Linux,
un fichero que solo tú puedes leer) y la interfaz nunca la lee. El texto que borras se borra de verdad del fichero
de la base de datos.

## Seguridad

Para avisar de un problema, mira [SECURITY.md](SECURITY.md). En corto: la página no tiene acceso a internet, cada
comando valida de nuevo sus argumentos en Rust, la IA solo propone cambios que tú aplicas, y la CI revisa las
dependencias y las licencias en cada subida y cada semana.

## Desarrollo

Requisitos: Node.js LTS, Rust (rustup) y los [requisitos de Tauri 2](https://tauri.app/start/prerequisites/) para tu
sistema. El gestor de paquetes es **npm** (`package-lock.json`).

```bash
npm install
npm run tauri dev      # la app con recarga en caliente
```

| Comando                                                      | Qué hace                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| `npm run lint`                                               | ESLint                                                     |
| `npm run format`                                             | Prettier                                                   |
| `npm test`                                                   | tests de JavaScript (`tests/`)                             |
| `npx tsc --noEmit`                                           | comprobación de tipos                                      |
| `cargo test` (en `src-tauri/`)                               | tests de Rust (base de datos, validación, IA…)             |
| `cargo fmt` / `cargo clippy --all-targets` (en `src-tauri/`) | formato y lint de Rust                                     |
| `npm run notices`                                            | regenera `THIRD_PARTY_NOTICES.txt` al cambiar dependencias |
| `npm run tauri build`                                        | instalador de producción                                   |

La versión de la app vive en `package.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json`: súbela en los tres
a la vez.

## Licencia

[MIT](LICENSE). Las licencias de lo que incluye la app están en [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt),
generado con `npm run notices`.
