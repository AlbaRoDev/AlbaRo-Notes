import type { ReactNode } from "react";

/** A group that slides open and shut (grid rows from 0fr to 1fr) instead of popping in and out; closed, it is inert. */
export function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="fold" data-open={open}>
      <div className="fold-inner" inert={!open}>
        {children}
      </div>
    </div>
  );
}
