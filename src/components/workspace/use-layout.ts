import { useCallback, useEffect, useState } from "react";
import { readPref, writePref } from "../../lib/prefs";
import { enter, parseSplit, promote, type Half, type Layout } from "../../lib/workspace";

const SPLIT_KEY = "workspace.split";

/** Which half is the main zone and how wide it is. The start screen is asked every launch, so `main` is not remembered; the width is. */
export function useLayout() {
  const [layout, setLayout] = useState<Layout>(() => ({
    main: null,
    split: parseSplit(readPref(SPLIT_KEY)),
  }));

  useEffect(() => writePref(SPLIT_KEY, String(layout.split)), [layout.split]);

  return {
    layout,
    enter: useCallback((half: Half) => setLayout((l) => enter(l, half)), []),
    promote: useCallback((half: Half) => setLayout((l) => promote(l, half)), []),
    setSplit: useCallback((split: number) => setLayout((l) => ({ ...l, split })), []),
    goHome: useCallback(() => setLayout((l) => ({ ...l, main: null })), []),
  };
}
