import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/playfair-display";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { loadKatex } from "./lib/katex-lazy";
import { initTheme } from "./lib/theme";

initTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary what="la aplicación">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// KaTeX is its own chunk: fetch it once the first screen is up, so the equations a page opens later find it ready.
setTimeout(() => void loadKatex().catch(() => undefined), 1000);
