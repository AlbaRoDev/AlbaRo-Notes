# Security policy

AlbaRo Notes is a personal, open-source project maintained by one person. Security reports are welcome and are
handled on a best-effort basis.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private reporting instead: on the repository, go to **Security → Report a vulnerability**.
Include what you found, the version (shown at the bottom of the app), your operating system and, if you can, the
steps to reproduce it.

This is a hobby project, so there is no promised response time. Serious problems get fixed in a new release, and you
are credited in the release notes unless you prefer not to be.

## Supported versions

Only the latest release gets security fixes. The app checks GitHub for a new version when it starts and every 12 hours,
and installs one only when you press the button; updates are checked against the project's signature first.

## What counts

In scope: the app itself (the Rust backend, the interface and the installers), for example a way to run code in the
page, to make the app read or write files outside its data folder, to reach a machine on your network through the
app's own requests, to read the AI service's API key, or to make the AI assistant change your notes without you
pressing "Apply".

Out of scope:

- Bugs in the libraries the app uses (Tauri, Tiptap, SQLite, KaTeX…). Report them to those projects. If the app ships
  a version with a known problem, tell us.
- Anything that needs control of the user's computer first (another program already running as the same user, or
  someone reading your files).
- What an AI service or Ollama does with the text you send them once you have turned the AI on.
- A page or document you choose to import that is simply large or badly formed, as long as the app stays safe.

## What the app does to stay safe

In short: the page itself has no network access (the content security policy only lets it talk to the Rust side);
it can call only the app's own commands, and each one validates its arguments again in Rust; the AI never writes to
the database, it can only propose changes that you apply; requests the app makes for you refuse addresses that are
not on the internet (except one you typed that is visibly local); deleted text is really erased from the database
file; and the AI service's API key lives in the system's credential store.

---

# Política de seguridad

AlbaRo Notes es un proyecto personal de código abierto, mantenido por una persona. Los avisos de seguridad se
agradecen y se atienden lo mejor posible.

## Cómo avisar de una vulnerabilidad

**No abras una incidencia pública** por un problema de seguridad.

Usa el aviso privado de GitHub: en el repositorio, **Security → Report a vulnerability**. Cuenta qué has
encontrado, la versión (sale al pie de la app), tu sistema operativo y, si puedes, cómo reproducirlo.

Es un proyecto personal, así que no hay plazo de respuesta prometido. Los problemas serios se arreglan en una nueva
versión y se te cita en sus notas, salvo que prefieras no salir.

## Versiones con arreglos

Solo la última versión recibe arreglos de seguridad. La app mira en GitHub si hay una versión nueva al arrancar y cada
12 horas, y solo instala una cuando pulsas el botón; antes comprueba la firma de la actualización con la clave del proyecto.

## Qué cuenta y qué no

Cuenta: la propia app (la parte de Rust, la interfaz y los instaladores). Por ejemplo, ejecutar código en la página,
hacer que la app lea o escriba ficheros fuera de su carpeta de datos, alcanzar una máquina de tu red a través de las
peticiones de la app, leer la clave de API del servicio de IA, o conseguir que el asistente cambie tus notas sin que
pulses «Aplicar».

No cuenta: fallos de las bibliotecas que usa (Tauri, Tiptap, SQLite, KaTeX…; avisa a esos proyectos, y si la app
trae una versión con un problema conocido, dínoslo); lo que exige tener ya el control de tu equipo; lo que haga un
servicio de IA u Ollama con el texto que les mandes una vez activada la IA; y un documento que importes que sea
simplemente enorme o esté mal formado, mientras la app siga a salvo.
