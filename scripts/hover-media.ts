// A touch screen has no pointer to hover with, but the browser still applies `:hover` to the element last tapped
// and keeps it until another one is: a button stays lit after its tap. This PostCSS plugin moves every rule that
// has a `:hover` selector into `@media (hover: hover), (pointer: fine)`, so it only exists where something can hover.
// (Two queries: a webview that gets one of them wrong on a desktop still has the other.)
import type { AtRule, Plugin } from "postcss";

const QUERY = "(hover: hover), (pointer: fine)";

export const hoverOnlyWhereHoverExists = (): Plugin => ({
  postcssPlugin: "hover-only-where-hover-exists",
  Rule(rule, { atRule }) {
    const parent = rule.parent;
    const already = parent?.type === "atrule" && (parent as AtRule).params === QUERY;
    if (already || !rule.selector.includes(":hover")) return;
    // `.a:hover, .b:focus-visible { … }`: the focus half keeps working on touch
    const hover = rule.selectors.filter((s) => s.includes(":hover"));
    const rest = rule.selectors.filter((s) => !s.includes(":hover"));
    const media = atRule({ name: "media", params: QUERY });
    media.append(rule.clone({ selectors: hover }));
    if (rest.length) {
      rule.selectors = rest;
      rule.after(media);
    } else {
      rule.replaceWith(media);
    }
  },
});
