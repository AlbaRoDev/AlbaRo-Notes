import { useEffect, useState } from "react";

type Katex = typeof import("katex").default;

let loaded: Katex | null = null;
let loading: Promise<Katex> | null = null;

/** Fetches KaTeX (its own chunk) the first time anyone asks; later calls share the one request. */
export function loadKatex(): Promise<Katex> {
  loading ??= import("katex").then(
    (module) => (loaded = module.default),
    (error: unknown) => {
      loading = null; // a failed fetch must not stick
      throw error;
    },
  );
  return loading;
}

/**
 * KaTeX, or null for the moment before it arrives (the caller shows the raw
 * LaTeX meanwhile). The app asks for it when idle at startup (`main.tsx`), so
 * in practice only a page that has an equation on the very first screen sees
 * the gap.
 */
export function useKatex(): Katex | null {
  const [katex, setKatex] = useState(loaded);
  useEffect(() => {
    if (katex) return;
    let live = true;
    loadKatex().then(
      (k) => live && setKatex(k),
      () => undefined, // the equation stays as plain LaTeX
    );
    return () => {
      live = false;
    };
  }, [katex]);
  return katex;
}
