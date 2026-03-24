import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type InputMode = "zip" | "folder";
type ExportMode = "zip" | "folder";
type Phase = "idle" | "preparing" | "running" | "reviewing" | "exporting" | "done" | "error";
type ReportTab = "converted" | "deleted" | "errors";
type Locale = "ru" | "en";

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

interface FloatingFile {
  id: number;
  name: string;
  x: number;
  y: number;
}

const translations = {
  ru: {
    languageLabel: "Язык",
    languageNative: "Русский",
    languageEnglish: "English",
    steps: ["Вход", "Оптимизация", "Проверка", "Экспорт"],
    inputZip: "ZIP-архив",
    inputFolder: "Папка",
    dropZip: "Перетащи сюда ZIP сайта",
    dropFolder: "Перетащи сюда папку сайта",
    browseZip: "или нажми для выбора · только .zip",
    browseFolder: "или нажми для выбора",
    changeFile: "Изменить файл",
    changeFolder: "Изменить папку",
    runZip: "Распаковать и оптимизировать",
    runFolder: "Оптимизировать папку",
    preparingZip: "Распаковка ZIP…",
    preparingFolder: "Копирование папки…",
    optimizerStarting: "Запуск оптимизации…",
    exportingZip: "Упаковка ZIP…",
    exportingFolder: "Копирование результата…",
    scanFound: (label: string, codeCount: number) => `Найдено ${label} в ${codeCount} кодовых файлах`,
    classify: (toConvert: number, toDelete: number) => `${toConvert} на оптимизацию · ${toDelete} на удаление`,
    zeroImages: "0 изображений",
    phasePreparingZip: "Распаковка архива",
    phasePreparingFolder: "Копирование папки",
    phaseRunning: "Оптимизация изображений",
    phaseExportZip: "Упаковка ZIP",
    phaseExportFolder: "Копирование результата",
    filesProgress: (done: number, total: number, percent: number) => `${done} / ${total} файлов · ${percent}%`,
    queued: "в очереди",
    processed: "обработано",
    left: "осталось",
    saved: "Экономия",
    compressed: "сжато",
    deleted: "удалено",
    filesUpdated: "файлов обновлено",
    reviewTitle: "Готово к проверке",
    reviewHint: "Открой папку выше, проверь результат и потом выбери формат экспорта.",
    tabConverted: "Оптимизировано",
    tabDeleted: "Удалено",
    tabErrors: "Ошибки",
    freed: (value: string) => `освобождено ${value}`,
    emptyTab: "Здесь пока ничего нет",
    exportFormat: "Формат экспорта",
    outputZip: (path: string) => `Выходной файл: ${path}`,
    outputFolder: (path: string) => `Выходная папка: ${path}`,
    exportZip: "Упаковать и экспортировать ZIP",
    exportFolder: "Экспортировать папку",
    cancel: "Отмена",
    exportDone: "Экспорт завершен",
    exportDoneZip: "Оптимизированный ZIP сохранен рядом с исходным файлом.",
    exportDoneFolder: "Оптимизированная папка сохранена рядом с исходной.",
    optimizeAnother: "Оптимизировать другой сайт",
    tryAgain: "Попробовать снова"
  },
  en: {
    languageLabel: "Language",
    languageNative: "Russian",
    languageEnglish: "English",
    steps: ["Input", "Optimize", "Review", "Export"],
    inputZip: "ZIP Archive",
    inputFolder: "Folder",
    dropZip: "Drop your site ZIP here",
    dropFolder: "Drop your site folder here",
    browseZip: "or click to browse · .zip only",
    browseFolder: "or click to browse",
    changeFile: "Change file",
    changeFolder: "Change folder",
    runZip: "Unzip & Optimize",
    runFolder: "Optimize Folder",
    preparingZip: "Extracting ZIP…",
    preparingFolder: "Copying folder…",
    optimizerStarting: "Starting optimizer…",
    exportingZip: "Packing ZIP…",
    exportingFolder: "Copying output…",
    scanFound: (label: string, codeCount: number) => `Found ${label} across ${codeCount} code files`,
    classify: (toConvert: number, toDelete: number) => `${toConvert} to optimize · ${toDelete} to delete`,
    zeroImages: "0 images",
    phasePreparingZip: "Extracting archive",
    phasePreparingFolder: "Copying folder",
    phaseRunning: "Optimizing images",
    phaseExportZip: "Packing ZIP",
    phaseExportFolder: "Copying output",
    filesProgress: (done: number, total: number, percent: number) => `${done} / ${total} files · ${percent}%`,
    queued: "queued",
    processed: "processed",
    left: "left",
    saved: "Saved",
    compressed: "compressed",
    deleted: "deleted",
    filesUpdated: "files updated",
    reviewTitle: "Ready for review",
    reviewHint: "Open the folder above, verify the result, then choose your export format.",
    tabConverted: "Converted",
    tabDeleted: "Deleted",
    tabErrors: "Errors",
    freed: (value: string) => `${value} freed`,
    emptyTab: "Nothing here yet",
    exportFormat: "Export Format",
    outputZip: (path: string) => `Output file: ${path}`,
    outputFolder: (path: string) => `Output folder: ${path}`,
    exportZip: "Pack & Export ZIP",
    exportFolder: "Export Folder",
    cancel: "Cancel",
    exportDone: "Export complete",
    exportDoneZip: "The optimized ZIP was saved next to the original file.",
    exportDoneFolder: "The optimized folder was saved next to the original.",
    optimizeAnother: "Optimize another site",
    tryAgain: "Try again"
  }
} as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function ZipIcon() {
  return (
    <span className="segmented-icon" aria-hidden="true">
      <svg viewBox="0 0 16 16" className="segmented-icon-svg">
        <rect x="3.2" y="2.7" width="9.6" height="10.6" rx="2.2" className="segmented-icon-stroke" />
        <path d="M8 3.9v8.2" className="segmented-icon-stroke" />
        <path d="M7.2 5.35h1.6M7.2 7.6h1.6M7.2 9.85h1.6" className="segmented-icon-detail" />
      </svg>
    </span>
  );
}

function FolderIcon() {
  return (
    <span className="segmented-icon" aria-hidden="true">
      <svg viewBox="0 0 16 16" className="segmented-icon-svg">
        <path d="M2.75 5.25a1.5 1.5 0 0 1 1.5-1.5h2.1l1.1 1.3h4.3a1.5 1.5 0 0 1 1.5 1.5v4.2a1.5 1.5 0 0 1-1.5 1.5h-7.5a1.5 1.5 0 0 1-1.5-1.5z" className="segmented-icon-stroke" />
      </svg>
    </span>
  );
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window === "undefined") return "ru";
    const saved = window.localStorage.getItem("site-optimizer-locale");
    return saved === "en" ? "en" : "ru";
  });
  const [inputMode, setInputMode] = useState<InputMode>("zip");
  const [inputPath, setInputPath] = useState<string | null>(null);
  const [workDir, setWorkDir] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ProgressState>({ done: 0, total: 0, percent: 0, status: "" });
  const [result, setResult] = useState<DonePayload | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<ReportTab>("converted");
  const [exportMode, setExportMode] = useState<ExportMode>("zip");
  const [floatingFiles, setFloatingFiles] = useState<FloatingFile[]>([]);
  const [currentFile, setCurrentFile] = useState<string>("");
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);
  const [runtimeDebug, setRuntimeDebug] = useState<string[]>([]);
  const unlisten = useRef<(() => void) | null>(null);
  const floatCounter = useRef(0);
  const languageSwitcherRef = useRef<HTMLDivElement | null>(null);
  const t = translations[locale];

  useEffect(() => {
    window.localStorage.setItem("site-optimizer-locale", locale);
  }, [locale]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const debugLines = await invoke<string[]>("get_runtime_debug");
        if (!cancelled) setRuntimeDebug(debugLines);
      } catch {
        // ignore debug lookup failures
      }

      try {
        const launchPath = await invoke<string | null>("get_launch_path");
        if (!launchPath || cancelled) return;
        const isZip = launchPath.toLowerCase().endsWith(".zip");
        setInputMode(isZip ? "zip" : "folder");
        setInputPath(launchPath);
      } catch {
        // ignore startup arg lookup failures
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!languageSwitcherRef.current?.contains(event.target as Node)) {
        setIsLanguageOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const currentLanguageLabel = locale === "ru" ? t.languageNative : t.languageEnglish;
  const alternateLocale: Locale = locale === "ru" ? "en" : "ru";
  const alternateLanguageLabel = alternateLocale === "ru"
    ? (locale === "ru" ? translations.ru.languageNative : translations.en.languageNative)
    : (locale === "ru" ? t.languageEnglish : translations.en.languageEnglish);

  useEffect(() => {
    let unlistenDrop: (() => void) | null = null;
    let unlistenOver: (() => void) | null = null;
    let unlistenLeave: (() => void) | null = null;

    (async () => {
      unlistenOver = await listen("tauri://drag-over", () => setIsDragging(true));
      unlistenLeave = await listen("tauri://drag-leave", () => setIsDragging(false));
      unlistenDrop = await listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
        setIsDragging(false);
        const path = event.payload.paths?.[0];
        if (!path) return;
        setInputMode(path.toLowerCase().endsWith(".zip") ? "zip" : "folder");
        setInputPath(path);
      });
    })();

    return () => {
      unlistenDrop?.();
      unlistenOver?.();
      unlistenLeave?.();
    };
  }, []);

  const spawnFloatingFile = useCallback((name: string) => {
    const short = name.split(/[\\/]/).pop() ?? name;
    const id = floatCounter.current++;
    const x = 10 + Math.random() * 70;
    const y = 20 + Math.random() * 60;
    setFloatingFiles((files) => [...files.slice(-12), { id, name: short, x, y }]);
    setCurrentFile(short);
    setTimeout(() => setFloatingFiles((files) => files.filter((file) => file.id !== id)), 2500);
  }, []);

  const pickInput = async () => {
    if (inputMode === "zip") {
      const path = await invoke<string | null>("open_zip_dialog");
      if (path) setInputPath(path);
      return;
    }
    const path = await invoke<string | null>("open_folder_dialog");
    if (path) setInputPath(path);
  };

  const getTabLabel = (tab: ReportTab) => {
    if (tab === "converted") return t.tabConverted;
    if (tab === "deleted") return t.tabDeleted;
    return t.tabErrors;
  };

  const startListening = async () => {
    unlisten.current?.();
    unlisten.current = await listen<string>("optimizer_event", (event) => {
      try {
        const data = JSON.parse(event.payload);
        switch (data.type) {
          case "status":
            setProgress((state) => ({ ...state, status: data.message }));
            break;
          case "scan_done": {
            const parts: string[] = [];
            if (data.pngCount) parts.push(`${data.pngCount} PNG`);
            if (data.jpgCount) parts.push(`${data.jpgCount} JPG`);
            if (data.gifCount) parts.push(`${data.gifCount} GIF`);
            const label = parts.length ? parts.join(" + ") : t.zeroImages;
            setProgress((state) => ({ ...state, status: t.scanFound(label, data.codeCount) }));
            break;
          }
          case "classify_done":
            setProgress((state) => ({
              ...state,
              status: t.classify(data.toConvert, data.toDelete),
              total: data.toConvert + data.toDelete
            }));
            break;
          case "progress":
            setProgress((state) => ({ ...state, done: data.done, total: data.total, percent: data.percent }));
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
      } catch {
        // ignore malformed sidecar messages
      }
    });
  };

  const runAll = async () => {
    if (!inputPath) return;
    await startListening();
    setPhase("preparing");
    setFloatingFiles([]);
    setCurrentFile("");
    setResult(null);
    setOutputPath(null);
    setErrorMsg("");
    setProgress({
      done: 0,
      total: 0,
      percent: 0,
      status: inputMode === "zip" ? t.preparingZip : t.preparingFolder
    });

    try {
      const dir = inputMode === "zip"
        ? await invoke<string>("unzip_site", { zipPath: inputPath })
        : await invoke<string>("prepare_folder", { folderPath: inputPath });
      setWorkDir(dir);
      setPhase("running");
      setProgress({ done: 0, total: 0, percent: 0, status: t.optimizerStarting });
      await invoke("optimize_site", { workDir: dir });
    } catch (error: any) {
      setErrorMsg(String(error));
      setPhase("error");
      unlisten.current?.();
    }
  };

  const doExport = async () => {
    if (!workDir || !inputPath) return;
    await startListening();
    setPhase("exporting");
    setErrorMsg("");
    setProgress({
      done: 0,
      total: 0,
      percent: 0,
      status: exportMode === "zip" ? t.exportingZip : t.exportingFolder
    });

    try {
      const out = exportMode === "zip"
        ? await invoke<string>("export_as_zip", { workDir, originalPath: inputPath })
        : await invoke<string>("export_as_folder", { workDir, originalPath: inputPath });
      await invoke("cleanup_work_dir", { workDir });
      setOutputPath(out);
      setPhase("done");
    } catch (error: any) {
      setErrorMsg(String(error));
      setPhase("error");
      unlisten.current?.();
    }
  };

  const reset = async () => {
    if (workDir) {
      try {
        await invoke("cleanup_work_dir", { workDir });
      } catch {
        // ignore cleanup errors on reset
      }
    }
    setPhase("idle");
    setInputPath(null);
    setWorkDir(null);
    setOutputPath(null);
    setResult(null);
    setErrorMsg("");
    setFloatingFiles([]);
    setCurrentFile("");
    setProgress({ done: 0, total: 0, percent: 0, status: "" });
  };

  const stepIndex = { idle: 0, preparing: 0, running: 1, reviewing: 2, exporting: 3, done: 3, error: 0 };
  const currentStep = stepIndex[phase] ?? 0;
  const filteredReport = result?.report.filter((item) => activeTab === "errors" ? item.type === "error" : item.type === activeTab) ?? [];

  return (
    <div className="app">
      <header className="header">
        <div className="language-switcher" ref={languageSwitcherRef}>
          <span className="language-label">{t.languageLabel}</span>
          <div className={`language-select-wrap ${isLanguageOpen ? "language-select-wrap--open" : ""}`}>
            <button
              type="button"
              className="language-trigger"
              onClick={() => setIsLanguageOpen((open) => !open)}
              aria-haspopup="listbox"
              aria-expanded={isLanguageOpen}
            >
              <span>{currentLanguageLabel}</span>
              <span className="language-trigger-arrow" />
            </button>

            {isLanguageOpen && (
              <div className="language-menu" role="listbox" aria-label={t.languageLabel}>
                <button
                  type="button"
                  className="language-menu-item"
                  onClick={() => {
                    setLocale(alternateLocale);
                    setIsLanguageOpen(false);
                  }}
                >
                  {alternateLanguageLabel}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="header-steps">
          {t.steps.map((step, index) => (
            <div key={step} className={`step ${currentStep === index ? "step--active" : ""} ${currentStep > index ? "step--done" : ""}`}>
              <span className="step-num">{currentStep > index ? "✓" : index + 1}</span>
              <span className="step-label">{step}</span>
            </div>
          ))}
        </div>

        <span className="header-version">v0.3.0</span>
      </header>

      <main className="main">
        {phase === "idle" && (
          <div className="idle-screen">
            <div className="mode-toggle">
              <button className={`mode-btn ${inputMode === "zip" ? "mode-btn--active" : ""}`} onClick={() => { setInputMode("zip"); setInputPath(null); }}>
                <ZipIcon /> {t.inputZip}
              </button>
              <button className={`mode-btn ${inputMode === "folder" ? "mode-btn--active" : ""}`} onClick={() => { setInputMode("folder"); setInputPath(null); }}>
                <FolderIcon /> {t.inputFolder}
              </button>
            </div>

            <div className={`dropzone ${isDragging ? "dropzone--active" : ""} ${inputPath ? "dropzone--selected" : ""}`} onClick={!inputPath ? pickInput : undefined}>
              {!inputPath ? (
                <>
                  <div className="dropzone-icon">{inputMode === "zip" ? "⇣" : "⌃"}</div>
                  <p className="dropzone-title">{inputMode === "zip" ? t.dropZip : t.dropFolder}</p>
                  <p className="dropzone-sub">{inputMode === "zip" ? t.browseZip : t.browseFolder}</p>
                </>
              ) : (
                <>
                  <div className="dropzone-icon dropzone-icon--ok">✓</div>
                  <p className="dropzone-title dropzone-path">{inputPath}</p>
                  <button className="btn-ghost" onClick={(event) => { event.stopPropagation(); setInputPath(null); }}>
                    {inputMode === "zip" ? t.changeFile : t.changeFolder}
                  </button>
                </>
              )}
            </div>

            <div className="actions">
              <button className="btn-primary" disabled={!inputPath} onClick={runAll}>
                {inputMode === "zip" ? t.runZip : t.runFolder}
              </button>
            </div>
          </div>
        )}

        {(phase === "preparing" || phase === "running" || phase === "exporting") && (
          <div className="running running--full">
            <div className="running-label">
              {phase === "preparing" && (inputMode === "zip" ? t.phasePreparingZip : t.phasePreparingFolder)}
              {phase === "running" && t.phaseRunning}
              {phase === "exporting" && (exportMode === "zip" ? t.phaseExportZip : t.phaseExportFolder)}
            </div>
            <div className="running-status">{progress.status}</div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: (phase === "preparing" || phase === "exporting") ? "100%" : `${progress.percent}%` }} />
            </div>
            <div className="progress-label">
              {phase === "running" && progress.total > 0 ? t.filesProgress(progress.done, progress.total, progress.percent) : ""}
            </div>

            {phase === "running" && progress.total > 0 && (
              <div className="running-stats">
                <div className="running-stat">
                  <span className="running-stat-value">{progress.total}</span>
                  <span className="running-stat-label">{t.queued}</span>
                </div>
                <div className="running-stat">
                  <span className="running-stat-value">{progress.done}</span>
                  <span className="running-stat-label">{t.processed}</span>
                </div>
                <div className="running-stat">
                  <span className="running-stat-value">{progress.total - progress.done}</span>
                  <span className="running-stat-label">{t.left}</span>
                </div>
              </div>
            )}

            {phase === "running" && (
              <div className="floating-arena">
                {floatingFiles.map((file) => (
                  <div key={file.id} className="floating-file" style={{ left: `${file.x}%`, top: `${file.y}%` }}>
                    <span className="floating-file-icon">◈</span>
                    <span className="floating-file-name">{file.name}</span>
                  </div>
                ))}
                {currentFile && <div className="current-file-label">{currentFile}</div>}
              </div>
            )}

            <div className="progress-path">{inputPath}</div>
          </div>
        )}

        {phase === "reviewing" && result && (
          <>
            <div className="result-summary">
              <div className="result-hero">
                <span className="result-hero-label">{t.saved}</span>
                <span className="result-hero-value">{formatBytes(result.savedBytes)}</span>
              </div>
              <div className="result-stats">
                <div className="stat">
                  <span className="stat-value stat-value--teal">{result.converted}</span>
                  <span className="stat-label">{t.compressed}</span>
                </div>
                <div className="stat-divider" />
                <div className="stat">
                  <span className="stat-value stat-value--red">{result.deleted}</span>
                  <span className="stat-label">{t.deleted}</span>
                </div>
                <div className="stat-divider" />
                <div className="stat">
                  <span className="stat-value">{result.replacedFiles}</span>
                  <span className="stat-label">{t.filesUpdated}</span>
                </div>
              </div>
            </div>

            <div className="review-callout">
              <span className="review-callout-icon">⌖</span>
              <div className="review-callout-body">
                <p className="review-callout-title">{t.reviewTitle}</p>
                <p className="review-callout-path">{workDir}</p>
                <p className="review-callout-hint">{t.reviewHint}</p>
              </div>
            </div>

            <div className="report report--full">
              <div className="report-tabs">
                {(["converted", "deleted", "errors"] as const).map((tab) => {
                  const count = tab === "errors"
                    ? result.report.filter((item) => item.type === "error").length
                    : result.report.filter((item) => item.type === tab).length;
                  return (
                    <button key={tab} className={`report-tab ${activeTab === tab ? "report-tab--active" : ""}`} onClick={() => setActiveTab(tab)}>
                      {getTabLabel(tab)} <span className="tab-count">{count}</span>
                    </button>
                  );
                })}
              </div>

              <div className="report-list">
                {filteredReport.map((item, index) => (
                  <div key={index} className={`report-item report-item--${item.type}`}>
                    <span className="report-file">{item.file}</span>
                    {item.type === "converted" && (
                      <span className="report-meta">
                        {item.srcFormat && <span className="report-fmt">{item.srcFormat}</span>}
                        {formatBytes(item.originalSize!)} → {formatBytes(item.newSize!)}
                        <span className="report-badge">-{item.savedPercent}%</span>
                      </span>
                    )}
                    {item.type === "deleted" && (
                      <span className="report-meta">
                        {item.srcFormat && <span className="report-fmt">{item.srcFormat}</span>}
                        {t.freed(formatBytes(item.originalSize ?? 0))}
                      </span>
                    )}
                    {item.type === "error" && <span className="report-error">{item.message}</span>}
                  </div>
                ))}

                {filteredReport.length === 0 && <div className="report-empty">{t.emptyTab}</div>}
              </div>
            </div>

            <div className="export-picker">
              <span className="export-picker-label">{t.exportFormat}</span>
              <div className="mode-toggle">
                <button className={`mode-btn ${exportMode === "zip" ? "mode-btn--active" : ""}`} onClick={() => setExportMode("zip")}>
                  <ZipIcon /> {t.inputZip}
                </button>
                <button className={`mode-btn ${exportMode === "folder" ? "mode-btn--active" : ""}`} onClick={() => setExportMode("folder")}>
                  <FolderIcon /> {t.inputFolder}
                </button>
              </div>
              <div className="export-picker-hint">
                {exportMode === "zip"
                  ? t.outputZip(`${inputPath?.replace(/(\.[^.]+)?$/, "") ?? "…"}_optimized.zip`)
                  : t.outputFolder(`${inputPath?.replace(/(\.[^.]+)?$/, "") ?? "…"}_optimized/`)}
              </div>
            </div>

            <div className="actions">
              <button className="btn-primary" onClick={doExport}>
                {exportMode === "zip" ? t.exportZip : t.exportFolder}
              </button>
              <button className="btn-ghost" onClick={() => void reset()}>{t.cancel}</button>
            </div>
          </>
        )}

        {phase === "done" && (
          <div className="done-state">
            <div className="done-icon">✓</div>
            <p className="done-title">{t.exportDone}</p>
            <p className="done-path">{outputPath}</p>
            <p className="done-hint">{exportMode === "zip" ? t.exportDoneZip : t.exportDoneFolder}</p>
            <button className="btn-primary" onClick={() => void reset()}>{t.optimizeAnother}</button>
          </div>
        )}

        {phase === "error" && (
          <div className="error-state">
            <div className="error-icon">⚠</div>
            <p className="error-msg">{errorMsg}</p>
            {runtimeDebug.length > 0 && (
              <div className="debug-panel">
                <div className="debug-panel-title">Runtime debug</div>
                {runtimeDebug.map((line) => (
                  <div key={line} className="debug-line">{line}</div>
                ))}
              </div>
            )}
            <button className="btn-ghost" onClick={() => void reset()}>{t.tryAgain}</button>
          </div>
        )}
      </main>
    </div>
  );
}
