import type { ReactNode } from "react";
import { HALVES } from "./halves";
import { ThemeToggle } from "./ThemeToggle";
import { WindowControls } from "./WindowControls";
import type { Half } from "../../lib/workspace";
import appIcon from "../../../src-tauri/icons/128x128.png";
import "./workspace.css";

/** The start screen: two big cards, asked every launch. */
export function Home({
  onEnter,
  version,
  menu,
}: {
  onEnter: (half: Half) => void;
  version: string | null;
  /** The app's menu, in the top-left corner of the bar. */
  menu: ReactNode;
}) {
  return (
    <div className="home">
      <header className="workspace-bar home-bar" data-tauri-drag-region>
        {menu}
        <span className="workspace-bar-fill" data-tauri-drag-region />
        <ThemeToggle />
        <WindowControls />
      </header>
      <img src={appIcon} alt="" className="home-icon" />
      <h1>AlbaRo</h1>
      <div className="home-cards">
        {(["notes", "manager"] as const).map((half, i) => {
          const { label, blurb, Icon, key } = HALVES[half];
          return (
            <button
              key={half}
              type="button"
              className="home-card"
              onClick={() => onEnter(half)}
              autoFocus={i === 0}
            >
              <Icon size={36} strokeWidth={1.5} aria-hidden />
              <strong>{label}</strong>
              <span>{blurb}</span>
              <kbd>Ctrl+{key}</kbd>
            </button>
          );
        })}
      </div>
      {version && <p className="home-version">AlbaRo Notes v{version}</p>}
    </div>
  );
}
