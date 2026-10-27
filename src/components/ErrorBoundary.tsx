import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** What failed, for the message: "la página", "la aplicación". */
  what: string;
  children: ReactNode;
}

/**
 * React unmounts the whole tree when a component throws while rendering and there is no boundary,
 * which left the window blank (a LaTeX that overflowed KaTeX's stack did exactly that). The data is
 * safe in SQLite; this keeps the failure to the part that broke and offers a way out. Put one
 * around the page editor with `key={pageId}` so opening another page starts it fresh.
 */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <p>Algo ha fallado al mostrar {this.props.what}. Tus notas están guardadas.</p>
        <button type="button" onClick={() => this.setState({ failed: false })}>
          Reintentar
        </button>{" "}
        <button type="button" onClick={() => window.location.reload()}>
          Recargar la ventana
        </button>
      </div>
    );
  }
}
