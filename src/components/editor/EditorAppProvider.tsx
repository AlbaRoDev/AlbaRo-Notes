import { useEffect, type ReactNode } from "react";
import { setKnownPages } from "../../lib/page-links";
import { EditorAppContext, type EditorAppContextValue } from "./editor-app-context";

export function EditorAppProvider({
  value,
  children,
}: {
  value: EditorAppContextValue;
  children: ReactNode;
}) {
  useEffect(() => setKnownPages(value.pages), [value.pages]);
  return <EditorAppContext.Provider value={value}>{children}</EditorAppContext.Provider>;
}
