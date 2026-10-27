import { useEffect, useState } from "react";
import { Columns3 } from "lucide-react";
import { boardsOfTask } from "../../lib/db-client";
import type { BoardInfo } from "../../types";

/** The boards a task is on, under its linked pages. Read-only: cards are added and removed on the boards. */
export function TaskBoards({ taskId }: { taskId: string }) {
  const [boards, setBoards] = useState<BoardInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    boardsOfTask(taskId)
      .then((found) => !cancelled && setBoards(found))
      .catch(() => !cancelled && setBoards([]));
    return () => {
      cancelled = true;
    };
  }, [taskId]);
  if (boards.length === 0) return null;
  return (
    <div className="linked-pages">
      <span className="linked-pages-title">En tableros</span>
      <div className="linked-pages-chips">
        {boards.map((b) => (
          <span key={b.id} className="db-chip linked-chip">
            <Columns3 size={12} aria-hidden="true" /> {b.name}
          </span>
        ))}
      </div>
    </div>
  );
}
