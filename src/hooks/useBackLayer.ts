import { useEffect, useRef } from "react";
import { createBackStack } from "../lib/back-stack.ts";
import { isMobile } from "../lib/viewport.ts";

let stack: ReturnType<typeof createBackStack> | null = null;
const getStack = () =>
  (stack ??= createBackStack(window.history, (onPop) =>
    window.addEventListener("popstate", onPop),
  ));

/**
 * While `active`, the system's back button calls `onBack` (it should close what is open). Only on phones and
 * tablets: the desktop has no back button and its history is left alone. `key` re-opens the layer when it
 * changes while still active (going up a page leaves a new parent to go up to).
 */
export function useBackLayer(active: boolean, onBack: () => void, key: unknown = null) {
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });
  useEffect(() => {
    if (!active || !isMobile) return;
    return getStack().push(() => latest.current());
  }, [active, key]);
}
