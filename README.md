# AlbaRo Notes

App de notas estilo Notion para escritorio (Windows, Linux y macOS; móviles más adelante): páginas con editor de bloques, bases de datos con vistas (tabla, lista, galería, tablero, calendario, cronograma, mapa, formulario, gráficos y panel de control), lienzo para dibujar y escribir a mano, búsqueda, y un asistente de IA **opcional** (apagado por defecto; local con Ollama u online con tu propia clave). Todo se guarda en una base de datos SQLite en tu equipo.

## Desarrollo

Requisitos: Node.js LTS, Rust (rustup) y los requisitos de [Tauri 2](https://tauri.app/start/prerequisites/) para tu sistema. El gestor de paquetes es **npm** (`package-lock.json`; el campo `packageManager` hace que pnpm se niegue a ejecutarse aquí).

```bash
npm install
npm run tauri dev      # la app con recarga en caliente
```

| Comando                                                      | Qué hace                                       |
| ------------------------------------------------------------ | ---------------------------------------------- |
| `npm run lint`                                               | ESLint                                         |
| `npm run format`                                             | Prettier                                       |
| `npm test`                                                   | tests de JavaScript (`tests/`)                 |
| `npx tsc --noEmit`                                           | comprobación de tipos                          |
| `cargo test` (en `src-tauri/`)                               | tests de Rust (base de datos, validación, IA…) |
| `cargo fmt` / `cargo clippy --all-targets` (en `src-tauri/`) | formato y lint de Rust                         |
| `npm run tauri build`                                        | instalador de producción                       |

La versión de la app vive en `package.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json`: súbela en los tres a la vez.

Editor recomendado: [VS Code](https://code.visualstudio.com/) con las extensiones de Tauri y rust-analyzer.

## Privacidad

Tus notas viven en una base de datos SQLite **en tu equipo**. No hay cuentas, telemetría ni servidor propio. Lo único que sale de la máquina es lo que tú activas:

| Qué                                                                                                     | A dónde                                                           | Cuándo                                                                                      |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| El texto de las notas que la IA consulta o reescribe, y las imágenes de escritura a mano que conviertes | El servicio online elegido (Groq, Gemini, OpenRouter o Anthropic) | Solo con la IA en modo «online», con tu clave **y** tu consentimiento. Apagada por defecto  |
| Nada (todo queda en tu equipo)                                                                          | Ollama, en `127.0.0.1`                                            | Con la IA en modo «local»                                                                   |
| La dirección que escribes (el servidor ve tu IP y esa dirección, no tus notas)                          | Esa web                                                           | Solo cuando escribes una dirección en un bloque de imagen, vídeo, audio, archivo o marcador |
| Qué zonas del mapa miras                                                                                | OpenStreetMap                                                     | Al ver un mapa (las teselas se guardan en caché)                                            |
| El lugar que buscas                                                                                     | Nominatim (OpenStreetMap)                                         | Solo al pulsar «Buscar» en un lugar                                                         |
| Tu IP, al ver si hay una versión nueva                                                                  | GitHub                                                            | Al arrancar y cada 12 horas (no se instala sola)                                            |
| La dirección de un enlace                                                                               | Tu navegador                                                      | Al abrirlo con Ctrl+clic                                                                    |

La clave de API del servicio de IA se guarda en el almacén de credenciales del sistema (Windows y macOS; en Linux, un fichero con permisos solo para ti) y la interfaz nunca la lee. El texto que borras se borra de verdad del fichero de la base de datos.

## Seguridad

Cómo avisar de un problema: [SECURITY.md](./SECURITY.md). En corto: la página no tiene acceso a internet, cada comando valida de nuevo sus argumentos en Rust, la IA solo propone cambios que tú aplicas, y la CI (preparada, aún sin estrenar en GitHub) revisa dependencias y licencias cada semana.

La app mira cada 12 horas si hay una versión nueva y **solo te avisa**: no descarga ni instala nada hasta que pulsas el botón, y comprueba la firma de la actualización con la clave del proyecto. Todavía no hay versiones publicadas. Cuando haya instaladores no estarán firmados con certificado de pago: Windows mostrará la advertencia de SmartScreen, y junto a cada instalador se publicará su SHA-256 para que lo compruebes.

## Licencia

[MIT](./LICENSE). Las licencias de lo que incluye la app están en [THIRD_PARTY_NOTICES.txt](./THIRD_PARTY_NOTICES.txt), generado con `npm run notices`.
