// The «back» of a phone, for things that open over the page (a drawer, a sheet, a dialog, a child page).
//
// The system's back button walks the webview's history, so every open layer owns one history entry: back
// removes the entry and `popstate` closes the top layer. A layer closed by the page itself (a tap on the
// scrim) gives its entry back with `history.go`. History changes are asynchronous, so nothing is pushed
// while a `go` is still on its way (its `popstate` has not arrived yet).
//
// Chromium marks an entry pushed without a user gesture «skippable»: the back button jumps over it, and the app
// leaves. Back itself is not a gesture, so a layer that opens again right after back (going up one more level)
// must not push a new entry: it walks forward onto the one it just left, which a tap created.

type Layer = { close: () => void };

export function createBackStack(
  history: Pick<History, "pushState" | "go">,
  listen: (onPop: () => void) => void,
  defer: (run: () => void) => void = queueMicrotask,
) {
  const layers: Layer[] = [];
  /** History entries in use: always catches up with `layers.length`. */
  let depth = 0;
  /** Entries of ours that lie ahead of the current one (left by back or given back) and can be walked onto again. */
  let ahead = 0;
  let travelling = false;
  let queued = false;

  const reconcile = () => {
    queued = false;
    if (travelling) return; // the pending popstate calls this again
    if (depth < layers.length && ahead > 0) {
      const reuse = Math.min(ahead, layers.length - depth);
      depth += reuse;
      ahead -= reuse;
      travelling = true;
      history.go(reuse);
      return;
    }
    while (depth < layers.length) {
      history.pushState({ back: ++depth }, "");
      ahead = 0; // pushing drops whatever lay ahead
    }
    if (depth > layers.length) {
      const extra = depth - layers.length;
      depth = layers.length;
      ahead += extra;
      travelling = true;
      history.go(-extra);
    }
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    defer(reconcile);
  };

  listen(() => {
    if (travelling) {
      travelling = false;
      schedule();
      return;
    }
    // The user went back: the entry is behind us now, so the top layer closes.
    depth = Math.max(0, depth - 1);
    ahead += 1;
    layers.pop()?.close();
    schedule();
  });

  return {
    /** Opens a layer; the returned function removes it (and does nothing if back already closed it). */
    push(close: () => void) {
      const layer: Layer = { close };
      layers.push(layer);
      schedule();
      return () => {
        const at = layers.indexOf(layer);
        if (at >= 0) layers.splice(at, 1);
        schedule();
      };
    },
  };
}
