/**
 * Asks a yes/no question in the app's own dialog (`ConfirmHost`, mounted once in App). The webview's
 * `window.confirm` cannot be used: the dialog plugin replaces it with an async function, so
 * `if (window.confirm(…))` is always true and nothing waits for the answer.
 */
export interface Question {
  title: string;
  detail?: string;
  confirmLabel: string;
}

type Pending = Question & { resolve: (ok: boolean) => void };

let current: Pending | null = null;
const listeners = new Set<() => void>();

function show(next: Pending | null) {
  current = next;
  listeners.forEach((l) => l());
}

export function subscribeConfirm(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function pendingQuestion(): Pending | null {
  return current;
}

/** Resolves true on the confirm button, false on Cancel, Esc, a click outside — or another question taking its place. */
export function askConfirm(question: Question): Promise<boolean> {
  return new Promise((resolve) => {
    current?.resolve(false);
    show({ ...question, resolve });
  });
}

export function answerConfirm(ok: boolean): void {
  const asked = current;
  show(null);
  asked?.resolve(ok);
}
