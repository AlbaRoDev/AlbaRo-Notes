/**
 * The oldest Chromium the app is built for (Vite's default target, and the CSS it uses: `dvh`, `:has()`,
 * `color-mix()`). On Android the page runs in the system's WebView, which Google Play keeps current, but a phone
 * without Google services can be stuck on an old one: the app then says so instead of looking broken.
 */
export const MIN_WEBVIEW = 111;

/** The Chromium major version in a user-agent string; `null` if it is not Chromium (or says nothing). */
export function chromeMajor(userAgent: string): number | null {
  const match = /\bChrome\/(\d+)/.exec(userAgent);
  return match ? Number(match[1]) : null;
}

/** The version to complain about, or `null` when it is fine (or unknown: never warn on a guess). */
export function outdatedWebview(userAgent: string): number | null {
  const version = chromeMajor(userAgent);
  return version !== null && version < MIN_WEBVIEW ? version : null;
}
