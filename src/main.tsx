import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/playfair-display";
import "@fontsource-variable/eb-garamond";
import "@fontsource-variable/libre-baskerville";
import "@fontsource/unifrakturcook";
import App from "./App";
import "./touch.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { loadKatex } from "./lib/katex-lazy";
import { getLang, t } from "./lib/i18n.ts";
import { invoke } from "./lib/invoke.ts";
import { initTheme } from "./lib/theme";
import { initViewport } from "./lib/viewport.ts";

initTheme();
initViewport();
// Rust writes some texts itself (notices, the seeds of the task database): it needs to know the language.
void invoke("set_language", { code: getLang() });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary what={t("la aplicación")}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// KaTeX is its own chunk: fetch it once the first screen is up, so the equations a page opens later find it ready.
setTimeout(() => void loadKatex().catch(() => undefined), 1000);
