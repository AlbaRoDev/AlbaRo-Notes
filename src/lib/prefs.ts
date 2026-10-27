// Per-device UI preferences (sidebar width, theme…). Not data: storage can be
// unavailable or empty, so every caller must work with its default.

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not persisted, nothing else to do */
  }
}
