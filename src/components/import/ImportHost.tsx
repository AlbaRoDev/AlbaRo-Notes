import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { PageSummary } from "../../types";
import {
  collectDropped,
  collectPicked,
  dropHasImportable,
  importNodes,
  readDrop,
  type ImportNode,
  type ImportReport,
} from "./import-files";
import "./import.css";

/** The palette's «Importar…» commands ask the host to open its pickers. */
export const IMPORT_FILES_EVENT = "albaro:import-files";
export const IMPORT_FOLDER_EVENT = "albaro:import-folder";

/**
 * Brings documents in as pages: drop Markdown, Word or HTML files, or a folder, anywhere on the window (images and
 * other files still go to the page under the pointer, as before), or pick them from the palette. The first page
 * made is opened and a note says what came in and what did not.
 */
export function ImportHost({ onDone }: { onDone: (created: PageSummary[]) => void }) {
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const running = useRef(false);

  const run = useCallback(
    async (collect: () => Promise<ImportNode[]> | ImportNode[]) => {
      if (running.current) return;
      running.current = true;
      setReport(null);
      setBusy(0);
      try {
        const nodes = await collect();
        const result = await importNodes(nodes, setBusy);
        if (result.created.length === 0 && result.skipped.length === 0) {
          result.skipped.push({
            name: "Nada que importar",
            reason: "solo se leen archivos .md, .docx, .html y .txt",
          });
        }
        setReport(result);
        if (result.created.length > 0) onDone(result.created);
      } catch (e) {
        setReport({ created: [], skipped: [{ name: "La importación", reason: String(e) }] });
      } finally {
        running.current = false;
        setBusy(null);
      }
    },
    [onDone],
  );

  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); // the webview must not open a dropped file
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      const dropped = readDrop(e.dataTransfer); // synchronously: the list is emptied when this handler returns
      if (!dropHasImportable(dropped)) return; // an image or any other file: the page's own drop handler takes it
      e.preventDefault();
      e.stopPropagation();
      void run(() => collectDropped(dropped));
    };
    const pickFiles = () => filesInput.current?.click();
    const pickFolder = () => folderInput.current?.click();
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop, true); // before the editor's, which would attach the file
    window.addEventListener(IMPORT_FILES_EVENT, pickFiles);
    window.addEventListener(IMPORT_FOLDER_EVENT, pickFolder);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop, true);
      window.removeEventListener(IMPORT_FILES_EVENT, pickFiles);
      window.removeEventListener(IMPORT_FOLDER_EVENT, pickFolder);
    };
  }, [run]);

  // a note that only says «all went well» goes away by itself; one with something skipped waits to be read
  useEffect(() => {
    if (!report || report.skipped.length > 0) return;
    const timer = window.setTimeout(() => setReport(null), 8000);
    return () => window.clearTimeout(timer);
  }, [report]);

  const picked = (e: React.ChangeEvent<HTMLInputElement>) => {
    // copied first: the list is live and emptying the input (so the same folder can be picked again) empties it
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length > 0) void run(() => collectPicked(files));
  };

  return (
    <>
      <input
        ref={filesInput}
        type="file"
        hidden
        multiple
        accept=".md,.markdown,.docx,.html,.htm,.txt"
        onChange={picked}
        aria-label="Importar documentos"
      />
      <input
        ref={folderInput}
        type="file"
        hidden
        // a folder: the browser hands over every file under it with its path
        {...({ webkitdirectory: "" } as Record<string, string>)}
        onChange={picked}
        aria-label="Importar una carpeta"
      />
      {(busy !== null || report) && (
        <div className="import-note" role="status">
          {busy !== null ? (
            <p>Importando… {busy > 0 ? `${busy} páginas` : ""}</p>
          ) : (
            report && (
              <>
                <button
                  type="button"
                  className="import-close"
                  aria-label="Cerrar"
                  onClick={() => setReport(null)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
                {report.created.length > 0 && (
                  <p>
                    {report.created.length === 1
                      ? "Importada 1 página."
                      : `Importadas ${report.created.length} páginas.`}
                  </p>
                )}
                {report.skipped.length > 0 && (
                  <>
                    <p>No se importó:</p>
                    <ul>
                      {report.skipped.slice(0, 6).map((s, i) => (
                        <li key={i}>
                          <strong>{s.name}</strong> — {s.reason}
                        </li>
                      ))}
                      {report.skipped.length > 6 && <li>…y {report.skipped.length - 6} más</li>}
                    </ul>
                  </>
                )}
              </>
            )
          )}
        </div>
      )}
    </>
  );
}
