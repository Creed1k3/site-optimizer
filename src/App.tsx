/* src/App.tsx */
import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type InputMode  = "zip" | "folder";
type ExportMode = "zip" | "folder";
type Phase = "idle" | "preparing" | "running" | "reviewing" | "exporting" | "done" | "error";

interface ReportItem {
  type: "converted" | "deleted" | "error";
  file: string;
  srcFormat?: string;
  originalSize?: number;
  newSize?: number;
  saved?: number;
  savedPercent?: number;
  message?: string;
}

interface DonePayload {
  converted: number;
  deleted: number;
  replacedFiles: number;
  savedBytes: number;
  report: ReportItem[];
}

interface ProgressState {
  done: number;
  total: number;
  percent: number;
  status: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ── Floating file pill component ──────────────────────────────────────────────
interface FloatingFile { id: number; name: string; x: number; y: number; }

export default function App() {
  const [inputMode,   setInputMode]   = useState<InputMode>("zip");
  const [inputPath,   setInputPath]   = useState<string | null>(null);
  const [workDir,     setWorkDir]     = useState<string | null>(null);
  const [outputPath,  setOutputPath]  = useState<string | null>(null);
  const [phase,       setPhase]       = useState<Phase>("idle");
  const [progress,    setProgress]    = useState<ProgressState>({ done:0, total:0, percent:0, status:"" });
  const [result,      setResult]      = useState<DonePayload | null>(null);
  const [errorMsg,    setErrorMsg]    = useState<string>("");
  const [isDragging,  setIsDragging]  = useState(false);
  const [activeTab,   setActiveTab]   = useState<"converted"|"deleted"|"errors">("converted");
  const [exportMode,  setExportMode]  = useState<ExportMode>("zip");
  const [floatingFiles, setFloatingFiles] = useState<FloatingFile[]>([]);
  const [currentFile, setCurrentFile] = useState<string>("");
  const unlisten = useRef<(() => void) | null>(null);
  const floatCounter = useRef(0);

  // ── Tauri drag & drop ─────────────────────────────────────────────────────
  useEffect(() => {
    let unlistenDrop: (() => void) | null = null;
    let unlistenOver: (() => void) | null = null;
    let unlistenLeave: (() => void) | null = null;

    (async () => {
      unlistenOver = await listen("tauri://drag-over", () => {
        setIsDragging(true);
      });
      unlistenLeave = await listen("tauri://drag-leave", () => {
        setIsDragging(false);
      });
      unlistenDrop = await listen<{ paths: string[] }>("tauri://drag-drop", (e) => {
        setIsDragging(false);
        const path = e.payload.paths?.[0];
        if (!path) return;
        const isZip = path.toLowerCase().endsWith(".zip");
        setInputMode(isZip ? "zip" : "folder");
        setInputPath(path);
      });
    })();

    return () => {
      unlistenDrop?.();
      unlistenOver?.();
      unlistenLeave?.();
    };
  }, []);

  // ── Floating files animation ──────────────────────────────────────────────
  const spawnFloatingFile = useCallback((name: string) => {
    const short = name.split(/[\\/]/).pop() ?? name;
    const id = floatCounter.current++;
    const x = 10 + Math.random() * 70;
    const y = 20 + Math.random() * 60;
    setFloatingFiles(f => [...f.slice(-12), { id, name: short, x, y }]);
    setCurrentFile(short);
    setTimeout(() => setFloatingFiles(f => f.filter(ff => ff.id !== id)), 2500);
  }, []);

  // ── pick file / folder ────────────────────────────────────────────────────
  const pickInput = async () => {
    if (inputMode === "zip") {
      const p = await invoke<string | null>("open_zip_dialog");
      if (p) setInputPath(p);
    } else {
      const p = await invoke<string | null>("open_folder_dialog");
      if (p) setInputPath(p);
    }
  };

  // ── event listener ────────────────────────────────────────────────────────
  const startListening = async () => {
    unlisten.current?.();
    unlisten.current = await listen<string>("optimizer_event", (event) => {
      try {
        const data = JSON.parse(event.payload);
        switch (data.type) {
          case "status":
            setProgress(p => ({ ...p, status: data.message }));
            break;
          case "scan_done": {
            const parts: string[] = [];
            if (data.pngCount) parts.push(`${data.pngCount} PNG`);
            if (data.jpgCount) parts.push(`${data.jpgCount} JPG`);
            if (data.gifCount) parts.push(`${data.gifCount} GIF`);
            const label = parts.length ? parts.join(" + ") : "0 images";
            setProgress(p => ({ ...p, status: `Found ${label} across ${data.codeCount} code files` }));
            break;
          }
          case "classify_done":
            setProgress(p => ({
              ...p,
              status: `${data.toConvert} to convert · ${data.toDelete} unused`,
              total: data.toConvert + data.toDelete,
            }));
            break;
          case "progress":
            setProgress(p => ({ ...p, done: data.done, total: data.total, percent: data.percent }));
            if (data.file) spawnFloatingFile(data.file);
            break;
          case "done":
            setResult(data as DonePayload);
            setPhase("reviewing");
            setFloatingFiles([]);
            setCurrentFile("");
            unlisten.current?.();
            unlisten.current = null;
            break;
          case "rezip_done":
          case "copyout_done":
            setOutputPath(data.outputZipPath ?? data.outputDir);
            setPhase("done");
            unlisten.current?.();
            unlisten.current = null;
            break;
          case "error":
            setErrorMsg(data.message);
            setPhase("error");
            setFloatingFiles([]);
            setCurrentFile("");
            unlisten.current?.();
            unlisten.current = null;
            break;
        }
      } catch { /* ignore */ }
    });
  };

  // ── Step 1 ────────────────────────────────────────────────────────────────
  const runAll = async () => {
    if (!inputPath) return;
    await startListening();
    setPhase("preparing");
    setFloatingFiles([]);
    setCurrentFile("");
    setResult(null);
    setOutputPath(null);
    setErrorMsg("");
    setProgress({ done:0, total:0, percent:0, status: inputMode === "zip" ? "Extracting ZIP…" : "Copying folder…" });
    try {
      const dir = inputMode === "zip"
        ? await invoke<string>("unzip_site",      { zipPath: inputPath })
        : await invoke<string>("prepare_folder",  { folderPath: inputPath });
      setWorkDir(dir);
      setPhase("running");
      setProgress({ done:0, total:0, percent:0, status:"Starting optimizer…" });
      await invoke("optimize_site", { workDir: dir });
    } catch (err: any) {
      setErrorMsg(String(err));
      setPhase("error");
      unlisten.current?.();
    }
  };

  // ── Step 2 ────────────────────────────────────────────────────────────────
  const doExport = async () => {
    if (!workDir || !inputPath) return;
    await startListening();
    setPhase("exporting");
    setErrorMsg("");
    setProgress({ done:0, total:0, percent:0, status: exportMode === "zip" ? "Packing ZIP…" : "Copying output folder…" });
    try {
      const out = exportMode === "zip"
        ? await invoke<string>("export_as_zip",    { workDir, originalPath: inputPath })
        : await invoke<string>("export_as_folder", { workDir, originalPath: inputPath });
      await invoke("cleanup_work_dir", { workDir });
      setOutputPath(out);
      setPhase("done");
    } catch (err: any) {
      setErrorMsg(String(err));
      setPhase("error");
      unlisten.current?.();
    }
  };

  const reset = () => {
    setPhase("idle");
    setInputPath(null);
    setWorkDir(null);
    setOutputPath(null);
    setResult(null);
    setErrorMsg("");
    setFloatingFiles([]);
    setCurrentFile("");
    setProgress({ done:0, total:0, percent:0, status:"" });
  };

  const stepIndex = { idle:0, preparing:0, running:1, reviewing:2, exporting:3, done:3, error:0 };
  const currentStep = stepIndex[phase] ?? 0;

  return (
    <div className="app">
      <header className="header">
        <div className="header-logo">
          <span className="logo-icon">◈</span>
          <span className="logo-text">SITE OPTIMIZER</span>
        </div>
        <div className="header-steps">
          {(["Input","Optimize","Review","Export"] as const).map((s,i) => (
            <div key={s} className={`step ${currentStep===i?"step--active":""} ${currentStep>i?"step--done":""}`}>
              <span className="step-num">{currentStep>i?"✓":i+1}</span>
              <span className="step-label">{s}</span>
            </div>
          ))}
        </div>
        <span className="header-version">v0.3.0</span>
      </header>

      <main className="main">

        {/* ── IDLE ─────────────────────────────────────────────────────── */}
        {phase === "idle" && (
          <>
            <div className="mode-toggle">
              <button className={`mode-btn ${inputMode==="zip"?"mode-btn--active":""}`}
                onClick={() => { setInputMode("zip"); setInputPath(null); }}>
                <span className="mode-btn-icon">⊡</span> ZIP archive
              </button>
              <button className={`mode-btn ${inputMode==="folder"?"mode-btn--active":""}`}
                onClick={() => { setInputMode("folder"); setInputPath(null); }}>
                <span className="mode-btn-icon">⊞</span> Folder
              </button>
            </div>

            <div
              className={`dropzone ${isDragging?"dropzone--active":""} ${inputPath?"dropzone--selected":""}`}
              onClick={!inputPath ? pickInput : undefined}
            >
              {!inputPath ? (
                <>
                  <div className="dropzone-icon">{inputMode==="zip"?"⇣":"⌁"}</div>
                  <p className="dropzone-title">
                    {inputMode==="zip" ? "Drop your site ZIP here" : "Drop your site folder here"}
                  </p>
                  <p className="dropzone-sub">
                    {inputMode==="zip" ? "or click to browse  ·  .zip only" : "or click to browse"}
                  </p>
                </>
              ) : (
                <>
                  <div className="dropzone-icon dropzone-icon--ok">✓</div>
                  <p className="dropzone-title dropzone-path">{inputPath}</p>
                  <button className="btn-ghost" onClick={e => { e.stopPropagation(); setInputPath(null); }}>
                    change {inputMode==="zip"?"file":"folder"}
                  </button>
                </>
              )}
            </div>

            <div className="actions">
              <button className="btn-primary" disabled={!inputPath} onClick={runAll}>
                {inputMode==="zip" ? "Unzip & Optimize" : "Optimize Folder"}
              </button>
            </div>
          </>
        )}

        {/* ── PREPARING / RUNNING / EXPORTING ──────────────────────────── */}
        {(phase==="preparing"||phase==="running"||phase==="exporting") && (
          <div className="running">
            <div className="running-label">
              {phase==="preparing" && (inputMode==="zip" ? "Extracting archive" : "Copying folder")}
              {phase==="running"   && "Optimizing images"}
              {phase==="exporting" && (exportMode==="zip" ? "Packing output ZIP" : "Copying output folder")}
            </div>
            <div className="running-status">{progress.status}</div>
            <div className="progress-track">
              <div className="progress-fill"
                style={{ width: (phase==="preparing"||phase==="exporting") ? "100%" : `${progress.percent}%` }} />
            </div>
            <div className="progress-label">
              {phase==="running" && progress.total > 0
                ? `${progress.done} / ${progress.total} files  ·  ${progress.percent}%`
                : ""}
            </div>

            {phase==="running" && progress.total > 0 && (
              <div className="running-stats">
                <div className="running-stat">
                  <span className="running-stat-value">{progress.total}</span>
                  <span className="running-stat-label">queued</span>
                </div>
                <div className="running-stat">
                  <span className="running-stat-value">{progress.done}</span>
                  <span className="running-stat-label">processed</span>
                </div>
                <div className="running-stat">
                  <span className="running-stat-value">{progress.total - progress.done}</span>
                  <span className="running-stat-label">left</span>
                </div>
              </div>
            )}

            {/* Floating files */}
            {phase==="running" && (
              <div className="floating-arena">
                {floatingFiles.map(ff => (
                  <div key={ff.id} className="floating-file"
                    style={{ left: `${ff.x}%`, top: `${ff.y}%` }}>
                    <span className="floating-file-icon">◈</span>
                    <span className="floating-file-name">{ff.name}</span>
                  </div>
                ))}
                {currentFile && (
                  <div className="current-file-label">⟳ {currentFile}</div>
                )}
              </div>
            )}

            <div className="progress-path">{inputPath}</div>
          </div>
        )}

        {/* ── REVIEWING ────────────────────────────────────────────────── */}
        {phase==="reviewing" && result && (
          <>
            <div className="result-summary">
              <div className="result-hero">
                <span className="result-hero-label">Saved</span>
                <span className="result-hero-value">{formatBytes(result.savedBytes)}</span>
              </div>
              <div className="result-stats">
                <div className="stat">
                  <span className="stat-value stat-value--teal">{result.converted}</span>
                  <span className="stat-label">converted</span>
                </div>
                <div className="stat-divider" />
                <div className="stat">
                  <span className="stat-value stat-value--red">{result.deleted}</span>
                  <span className="stat-label">deleted</span>
                </div>
                <div className="stat-divider" />
                <div className="stat">
                  <span className="stat-value">{result.replacedFiles}</span>
                  <span className="stat-label">files updated</span>
                </div>
              </div>
            </div>

            <div className="review-callout">
              <span className="review-callout-icon">⌖</span>
              <div className="review-callout-body">
                <p className="review-callout-title">Ready for review</p>
                <p className="review-callout-path">{workDir}</p>
                <p className="review-callout-hint">Open the folder above, verify everything looks good, then choose your export format below.</p>
              </div>
            </div>

            <div className="report">
              <div className="report-tabs">
                {(["converted","deleted","errors"] as const).map(tab => {
                  const count = tab==="errors"
                    ? result.report.filter(r=>r.type==="error").length
                    : result.report.filter(r=>r.type===tab).length;
                  return (
                    <button key={tab}
                      className={`report-tab ${activeTab===tab?"report-tab--active":""}`}
                      onClick={() => setActiveTab(tab)}>
                      {tab} <span className="tab-count">{count}</span>
                    </button>
                  );
                })}
              </div>
              <div className="report-list">
                {result.report
                  .filter(r => activeTab==="errors" ? r.type==="error" : r.type===activeTab)
                  .map((item,i) => (
                    <div key={i} className={`report-item report-item--${item.type}`}>
                      <span className="report-file">{item.file}</span>
                      {item.type==="converted" && (
                        <span className="report-meta">
                          {item.srcFormat && <span className="report-fmt">{item.srcFormat}</span>}
                          {formatBytes(item.originalSize!)} → {formatBytes(item.newSize!)}
                          <span className="report-badge">-{item.savedPercent}%</span>
                        </span>
                      )}
                      {item.type==="deleted" && (
                        <span className="report-meta">
                          {item.srcFormat && <span className="report-fmt">{item.srcFormat}</span>}
                          {formatBytes(item.originalSize??0)} freed
                        </span>
                      )}
                      {item.type==="error" && (
                        <span className="report-error">{item.message}</span>
                      )}
                    </div>
                  ))}
              </div>
            </div>

            <div className="export-picker">
              <span className="export-picker-label">Export as</span>
              <div className="mode-toggle">
                <button className={`mode-btn ${exportMode==="zip"?"mode-btn--active":""}`}
                  onClick={() => setExportMode("zip")}>
                  <span className="mode-btn-icon">⊡</span> ZIP archive
                </button>
                <button className={`mode-btn ${exportMode==="folder"?"mode-btn--active":""}`}
                  onClick={() => setExportMode("folder")}>
                  <span className="mode-btn-icon">⊞</span> Folder
                </button>
              </div>
              <div className="export-picker-hint">
                {exportMode==="zip"
                  ? `Output: ${inputPath?.replace(/(\.[^.]+)?$/, "") ?? "…"}_optimized.zip`
                  : `Output: ${inputPath?.replace(/(\.[^.]+)?$/, "") ?? "…"}_optimized/`}
              </div>
            </div>

            <div className="actions">
              <button className="btn-primary" onClick={doExport}>
                {exportMode==="zip" ? "Pack & Export ZIP" : "Export Folder"}
              </button>
              <button className="btn-ghost" onClick={reset}>Cancel</button>
            </div>
          </>
        )}

        {/* ── DONE ─────────────────────────────────────────────────────── */}
        {phase==="done" && (
          <div className="done-state">
            <div className="done-icon">✓</div>
            <p className="done-title">Export complete</p>
            <p className="done-path">{outputPath}</p>
            <p className="done-hint">
              {exportMode==="zip"
                ? "The optimized ZIP has been saved next to your original file."
                : "The optimized folder has been saved next to your original."}
            </p>
            <button className="btn-primary" onClick={reset}>Optimize another site</button>
          </div>
        )}

        {/* ── ERROR ────────────────────────────────────────────────────── */}
        {phase==="error" && (
          <div className="error-state">
            <div className="error-icon">⚠</div>
            <p className="error-msg">{errorMsg}</p>
            <button className="btn-ghost" onClick={reset}>Try again</button>
          </div>
        )}

      </main>
    </div>
  );
}
