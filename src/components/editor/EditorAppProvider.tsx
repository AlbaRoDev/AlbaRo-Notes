import type { ReactNode } from "react";
import { EditorAppContext, type EditorAppContextValue } from "./editor-app-context";

export function EditorAppProvider({
  value,
  children,
}: {
  value: EditorAppContextValue;
  children: ReactNode;
}) {
  return <EditorAppContext.Provider value={value}>{children}</EditorAppContext.Provider>;
}
