/** The one place equations are turned into HTML (inline, block and the live preview all come through here). */
interface KatexLike {
  renderToString(
    latex: string,
    options: { throwOnError: boolean; displayMode: boolean; maxSize: number },
  ): string;
}

/**
 * Largest box, in em, any `\rule`, `\hspace`… may make. KaTeX has no limit by default, so
 * `\rule{99999em}{99999em}` made one equation 1.9 million px tall and pushed the page out of reach.
 */
const MAX_SIZE_EM = 50;

/**
 * `throwOnError: false` only covers LaTeX errors. Nesting thousands of braces deep (well under the
 * 10 000 characters Rust accepts) overflows the stack with a plain `RangeError`, and since the
 * equation is rendered while React draws it, that took the whole window down. A `null` result
 * means "could not be drawn": the caller shows the raw LaTeX instead, as before KaTeX arrives.
 * `trust` stays off (KaTeX's default), so `\href`, `\includegraphics` and `\htmlClass` are errors.
 */
export function renderLatex(katex: KatexLike, latex: string, displayMode: boolean): string | null {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode, maxSize: MAX_SIZE_EM });
  } catch {
    return null;
  }
}
