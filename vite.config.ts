import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

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

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
