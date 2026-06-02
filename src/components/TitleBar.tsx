import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "./Icons";

// A custom window title bar so the top strip follows the app theme instead of
// the black native Windows caption. Dragging is handled by CSS
// (`-webkit-app-region: drag` on `.titlebar`); the controls opt out via
// `.win-controls` (`no-drag`). Window decorations are disabled in tauri.conf.json.
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    win.isMaximized().then(setMaximized).catch(() => {});
    win.onResized(() => {
      win.isMaximized().then(setMaximized).catch(() => {});
    }).then((fn) => { unlisten = fn; }).catch(() => {});

    return () => unlisten?.();
  }, []);

  const win = getCurrentWindow();

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand">
        <span className="glyph"><Icon.spark size={15} /></span>
        <span className="name">Site Optimizer</span>
      </div>
      <div className="win-controls">
        <button className="win-btn" aria-label="Minimize" onClick={() => win.minimize()}>
          <Icon.min size={15} />
        </button>
        <button className="win-btn" aria-label={maximized ? "Restore" : "Maximize"} onClick={() => win.toggleMaximize()}>
          {maximized ? <RestoreGlyph /> : <Icon.max size={13} />}
        </button>
        <button className="win-btn close" aria-label="Close" onClick={() => win.close()}>
          <Icon.x size={15} />
        </button>
      </div>
    </div>
  );
}

// Two offset squares — the conventional "restore down" glyph.
function RestoreGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="3.5" width="13.5" height="13.5" rx="1.5" />
      <path d="M16.5 17v2A1.5 1.5 0 0 1 15 20.5H5A1.5 1.5 0 0 1 3.5 19V9A1.5 1.5 0 0 1 5 7.5h2" />
    </svg>
  );
}
