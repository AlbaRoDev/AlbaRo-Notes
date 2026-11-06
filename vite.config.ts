import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
import { hoverOnlyWhereHoverExists } from "./scripts/hover-media.ts";
const host = process.env.TAURI_DEV_HOST;
// `tauri android dev` uses its own port so it runs beside a desktop `tauri dev`.
const port = Number(process.env.ALBARO_VITE_PORT) || 1420;

// KaTeX's CSS lists every font three times (woff2, woff, ttf). Every webview Tauri uses —
// WebView2, WKWebView, WebKitGTK — reads woff2, so the other two only add ~1.5 MB to the app.
const katexWoff2Only = (): Plugin => ({
  name: "katex-woff2-only",
  enforce: "pre",
  transform(code, id) {
    if (!id.includes("katex") || !id.endsWith(".css")) return null;
    return code.replace(/,url\([^)]*\.(?:woff|ttf)\)\s*format\("[^"]*"\)/g, "");
  },
});

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), katexWoff2Only()],

  // `:hover` only where a pointer can hover (a touch screen keeps the last tapped element hovered)
  css: { postcss: { plugins: [hoverOnlyWhereHoverExists()] } },

  // `TAURI_ENV_PLATFORM` (android, ios, windows…) is set by the Tauri CLI: the page tells a phone build from a desktop one.
  envPrefix: ["VITE_", "TAURI_ENV_"],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: port + 1,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
