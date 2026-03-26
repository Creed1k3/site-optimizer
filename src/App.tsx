import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type InputMode = "zip" | "folder";
type ExportMode = "zip" | "folder";
type Phase = "idle" | "preparing" | "running" | "reviewing" | "exporting" | "done" | "error" | "batching" | "batchDone";
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

interface BatchSummaryItem {
  input: string;
  output?: string;
  success: boolean;
  savedBytes?: number;
  error?: string;
}

interface LaunchPayload {
  mode: "normal" | "quick";
  paths: string[];
}

interface ContextMenuSettings {
  normal: boolean;
  quick: boolean;
}

interface UpdateInfo {
  current_version: string;
  version: string;
  notes?: string | null;
  pub_date?: string | null;
}

interface UpdateDownloadProgress {
  state: "starting" | "downloading" | "installing" | "done";
  downloaded: number;
  total?: number | null;
  bytes_per_second: number;
  eta_seconds?: number | null;
  message: string;
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

function formatSpeed(bytesPerSecond: number, locale: Locale): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) {
    return locale === "ru" ? "считаем скорость…" : "measuring speed…";
  }

  return `${formatBytes(Math.round(bytesPerSecond))}/${locale === "ru" ? "с" : "s"}`;
}

function formatEta(seconds: number | null | undefined, locale: Locale): string {
  if (seconds == null || seconds <= 0) {
    return locale === "ru" ? "еще немного…" : "almost there…";
  }

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins <= 0) {
    return locale === "ru" ? `примерно ${secs} сек.` : `about ${secs}s`;
  }

  return locale === "ru" ? `примерно ${mins} мин ${secs} сек.` : `about ${mins}m ${secs}s`;
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
  const launchModeRef = useRef<"normal" | "quick">("normal");
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
  const [removeUnused, setRemoveUnused] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("site-optimizer-remove-unused") === "true";
  });
  const [dedupeImages, setDedupeImages] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("site-optimizer-dedupe-images") === "true";
  });
  const [runtimeDebug, setRuntimeDebug] = useState<string[]>([]);
  const [batchResults, setBatchResults] = useState<BatchSummaryItem[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [contextMenuNormal, setContextMenuNormal] = useState(false);
  const [contextMenuQuick, setContextMenuQuick] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<UpdateDownloadProgress | null>(null);
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [batchPaused, setBatchPaused] = useState(false);
  const [autoCloseSeconds, setAutoCloseSeconds] = useState<number | null>(null);
  const unlisten = useRef<(() => void) | null>(null);
  const floatCounter = useRef(0);
  const languageSwitcherRef = useRef<HTMLDivElement | null>(null);
  const batchPausedRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const autoCloseEnabledRef = useRef(false);
  const t = translations[locale];

  const showMainWindow = useCallback(async () => {
    try {
      await invoke("show_main_window");
    } catch {
      // ignore show failures
    }
  }, []);

  const stopCurrentOperation = useCallback(async () => {
    try {
      await invoke("stop_current_operation");
    } catch {
      // ignore stop failures
    }
  }, []);

  const quitApp = useCallback(async () => {
    try {
      await invoke("quit_app");
    } catch {
      // ignore quit failures
    }
  }, []);

  const refreshContextMenuSettings = useCallback(async () => {
    try {
      const settings = await invoke<ContextMenuSettings>("get_context_menu_settings");
      setContextMenuNormal(settings.normal);
      setContextMenuQuick(settings.quick);
    } catch {
      // ignore settings lookup failures
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    try {
      const update = await invoke<UpdateInfo | null>("check_for_updates");
      setUpdateInfo(update);
    } catch {
      // updater may be unconfigured during development
    }
  }, []);

  const saveContextMenuSettings = useCallback(async () => {
    setIsSavingSettings(true);
    try {
      const settings = await invoke<ContextMenuSettings>("set_context_menu_settings", {
        normal: contextMenuNormal,
        quick: contextMenuQuick
      });
      setContextMenuNormal(settings.normal);
      setContextMenuQuick(settings.quick);
      setIsSettingsOpen(false);
    } finally {
      setIsSavingSettings(false);
    }
  }, [contextMenuNormal, contextMenuQuick]);

  const installUpdate = useCallback(async () => {
    setIsInstallingUpdate(true);
    setUpdateProgress({
      state: "starting",
      downloaded: 0,
      total: null,
      bytes_per_second: 0,
      eta_seconds: null,
      message: locale === "ru" ? "Подготовка обновления…" : "Preparing update…"
    });
    try {
      await invoke("install_pending_update");
    } catch (error) {
      setErrorMsg(String(error));
      setPhase("error");
      setUpdateInfo(null);
      setUpdateProgress(null);
    } finally {
      setIsInstallingUpdate(false);
    }
  }, [locale]);

  const stopActiveWork = useCallback(async (closeAfterStop = false) => {
    stopRequestedRef.current = true;
    setBatchPaused(false);
    setClosePromptOpen(false);
    await stopCurrentOperation();
    if (closeAfterStop) {
      window.setTimeout(() => {
        void quitApp();
      }, 120);
    }
  }, [quitApp, stopCurrentOperation]);

  const resumeAfterClosePrompt = useCallback(() => {
    setClosePromptOpen(false);
    if (phase === "batching") {
      setBatchPaused(false);
    }
  }, [phase]);

  const toggleBatchPause = useCallback(() => {
    setBatchPaused((value) => !value);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("site-optimizer-locale", locale);
  }, [locale]);

  useEffect(() => {
    window.localStorage.setItem("site-optimizer-remove-unused", String(removeUnused));
  }, [removeUnused]);

  useEffect(() => {
    window.localStorage.setItem("site-optimizer-dedupe-images", String(dedupeImages));
  }, [dedupeImages]);

  useEffect(() => {
    batchPausedRef.current = batchPaused;
  }, [batchPaused]);

  useEffect(() => {
    void refreshContextMenuSettings();
  }, [refreshContextMenuSettings]);

  useEffect(() => {
    let cancelled = false;
    let unlistenLaunchRequested: (() => void) | null = null;
    let unlistenCloseRequested: (() => void) | null = null;
    let unlistenUpdateProgress: (() => void) | null = null;

    (async () => {
      try {
        const debugLines = await invoke<string[]>("get_runtime_debug");
        if (!cancelled) setRuntimeDebug(debugLines);
      } catch {
        // ignore debug lookup failures
      }

      try {
        const launchMode = await invoke<"normal" | "quick">("get_launch_mode");
        launchModeRef.current = launchMode;
        if (launchMode !== "quick") {
          void checkForUpdates();
        }
      } catch {
        // ignore launch mode lookup failures
      }

      try {
        const launchPaths = await invoke<string[]>("get_launch_paths");
        if (!launchPaths.length || cancelled) return;

        const firstPath = launchPaths[0];
        const isZip = firstPath.toLowerCase().endsWith(".zip");
        setInputMode(isZip ? "zip" : "folder");
        setInputPath(firstPath);

        if (launchModeRef.current === "quick") {
          window.setTimeout(() => {
            void runQuickBatchFromPaths(launchPaths, isZip ? "zip" : "folder", true);
          }, 160);
        }
        return;
      } catch {
        // ignore startup arg lookup failures
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

      unlistenLaunchRequested = await listen<LaunchPayload>("launch_requested", (event) => {
        const payload = event.payload;
        if (!payload?.paths?.length) return;

        const firstPath = payload.paths[0];
        const isZip = firstPath.toLowerCase().endsWith(".zip");
        setInputMode(isZip ? "zip" : "folder");
        setInputPath(firstPath);

        void showMainWindow();

        if (payload.mode === "quick") {
          void runQuickBatchFromPaths(payload.paths, isZip ? "zip" : "folder", true);
          return;
        }
        setPhase("idle");
        setBatchResults([]);
        setResult(null);
        setOutputPath(null);
        setErrorMsg("");
        setFloatingFiles([]);
        setCurrentFile("");
        setProgress({ done: 0, total: 0, percent: 0, status: "" });
      });

      unlistenCloseRequested = await listen("window_close_requested", () => {
        const busy = phase === "preparing" || phase === "running" || phase === "exporting" || phase === "batching";

        if (!busy) {
          void quitApp();
          return;
        }

        if (phase === "batching") {
          setBatchPaused(true);
        }
        setClosePromptOpen(true);
      });

      unlistenUpdateProgress = await listen<UpdateDownloadProgress>("update_download_progress", (event) => {
        setUpdateProgress(event.payload);
      });
    })();

    return () => {
      cancelled = true;
      unlistenLaunchRequested?.();
      unlistenCloseRequested?.();
      unlistenUpdateProgress?.();
    };
  }, [checkForUpdates, phase, quitApp, showMainWindow]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!languageSwitcherRef.current?.contains(event.target as Node)) {
        setIsLanguageOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, []);
  useEffect(() => {
    if (autoCloseSeconds === null) return;
    if (autoCloseSeconds <= 0) {
      void quitApp();
      return;
    }

    const timer = window.setTimeout(() => {
      setAutoCloseSeconds((value) => (value === null ? null : value - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [autoCloseSeconds, quitApp]);

  useEffect(() => {
    if (autoCloseSeconds === null) return;

    const cancelAutoClose = () => {
      setAutoCloseSeconds(null);
      autoCloseEnabledRef.current = false;
    };

    window.addEventListener("pointerdown", cancelAutoClose);
    window.addEventListener("keydown", cancelAutoClose);

    return () => {
      window.removeEventListener("pointerdown", cancelAutoClose);
      window.removeEventListener("keydown", cancelAutoClose);
    };
  }, [autoCloseSeconds]);


  const currentLanguageLabel = locale === "ru" ? t.languageNative : t.languageEnglish;
  const alternateLocale: Locale = locale === "ru" ? "en" : "ru";
  const alternateLanguageLabel = alternateLocale === "ru"
    ? (locale === "ru" ? translations.ru.languageNative : translations.en.languageNative)
    : (locale === "ru" ? t.languageEnglish : translations.en.languageEnglish);
  const extraCleanupTitle = locale === "ru" ? "Дополнительная очистка" : "Extra Cleanup";
  const removeUnusedLabel = locale === "ru" ? "Удалять неиспользуемые картинки" : "Remove unused images";
  const removeUnusedHint = locale === "ru"
    ? "Опция осторожная: может затронуть нестандартные шаблоны и lazy-load."
    : "Use carefully: custom templates and lazy-load setups may need review.";
  const dedupeLabel = locale === "ru" ? "Удалять дубликаты изображений" : "Remove duplicate images";
  const dedupeHint = locale === "ru"
    ? "Дубликаты ищутся по содержимому файла и объединяются в один оригинал."
    : "Duplicates are detected by file content and merged into a single original.";
  const quickOptimizeLabel = locale === "ru" ? "Быстро оптимизировать пачку" : "Quick optimize batch";
  const quickSummaryTitle = locale === "ru" ? "Пакетная оптимизация завершена" : "Batch optimization complete";
  const quickSummaryHint = locale === "ru"
    ? "Все выбранные сайты обработаны автоматически и сохранены рядом с исходниками."
    : "All selected sites were processed automatically and saved next to the originals.";
  const settingsTitle = locale === "ru" ? "Настройки" : "Settings";
  const settingsSave = locale === "ru" ? "Сохранить" : "Save";
  const settingsClose = locale === "ru" ? "Закрыть" : "Close";
  const contextMenuTitle = locale === "ru" ? "Пункты контекстного меню" : "Context menu entries";
  const updateTitle = locale === "ru" ? "Доступна новая версия" : "New version available";
  const updateHint = locale === "ru" ? "Хотите скачать и установить обновление сейчас?" : "Do you want to download and install the update now?";
  const updateNowLabel = locale === "ru" ? "Обновить сейчас" : "Update now";
  const updateLaterLabel = locale === "ru" ? "Позже" : "Later";
  const contextNormalLabel = locale === "ru" ? "Оптимизировать сайт" : "Optimize site";
  const contextQuickLabel = locale === "ru" ? "Быстро оптимизировать сайт" : "Quick optimize site";

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

  const pickBatchInputs = async () => {
    const paths = inputMode === "zip"
      ? await invoke<string[]>("open_zip_dialog_multi")
      : await invoke<string[]>("open_folder_dialog_multi");
    return paths.filter(Boolean);
  };

  const getTabLabel = (tab: ReportTab) => {
    if (tab === "converted") return t.tabConverted;
    if (tab === "deleted") return t.tabDeleted;
    return t.tabErrors;
  };

  const waitWhileBatchPaused = useCallback(async () => {
    while (batchPausedRef.current && !stopRequestedRef.current) {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    }
  }, []);

  const optimizeSingleForBatch = async (path: string, mode: InputMode) => {
    const dir = mode === "zip"
      ? await invoke<string>("unzip_site", { zipPath: path })
      : await invoke<string>("prepare_folder", { folderPath: path });

    const donePromise = new Promise<DonePayload>((resolve, reject) => {
      void (async () => {
        const off = await listen<string>("optimizer_event", (event) => {
          try {
            const data = JSON.parse(event.payload);
            switch (data.type) {
              case "status":
                setProgress((state) => ({ ...state, status: data.message }));
                break;
              case "progress":
                if (data.file) spawnFloatingFile(data.file);
                break;
              case "done":
                off();
                resolve(data as DonePayload);
                break;
              case "error":
                off();
                reject(new Error(String(data.message)));
                break;
            }
          } catch {
            // ignore malformed sidecar messages
          }
        });
      })();
    });

    await invoke("optimize_site", {
      workDir: dir,
      removeUnused,
      dedupeImages
    });
    const donePayload = await donePromise;

    const out = exportMode === "zip"
      ? await invoke<string>("export_as_zip", { workDir: dir, originalPath: path })
      : await invoke<string>("export_as_folder", { workDir: dir, originalPath: path });

    await invoke("cleanup_work_dir", { workDir: dir });
    return { out, donePayload };
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
    autoCloseEnabledRef.current = false;
    stopRequestedRef.current = false;
    setBatchPaused(false);
    setClosePromptOpen(false);
    setAutoCloseSeconds(null);
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
      await invoke("optimize_site", {
        workDir: dir,
        removeUnused,
        dedupeImages
      });
    } catch (error: any) {
      setErrorMsg(String(error));
      setPhase("error");
      unlisten.current?.();
    }
  };

  const doExport = async () => {
    if (!workDir || !inputPath) return;
    await startListening();
    stopRequestedRef.current = false;
    setClosePromptOpen(false);
    setAutoCloseSeconds(null);
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

  const runQuickBatch = async () => {
    const paths = await pickBatchInputs();
    if (!paths.length) return;
    await runQuickBatchFromPaths(paths, inputMode, false);
  };

  const runQuickBatchFromPaths = async (paths: string[], mode: InputMode, autoCloseAfterFinish: boolean) => {
    setPhase("batching");
    setBatchResults([]);
    setResult(null);
    setOutputPath(null);
    setErrorMsg("");
    setFloatingFiles([]);
    setCurrentFile("");
    setClosePromptOpen(false);
    setBatchPaused(false);
    stopRequestedRef.current = false;
    autoCloseEnabledRef.current = autoCloseAfterFinish;
    setAutoCloseSeconds(null);

    const nextResults: BatchSummaryItem[] = [];

    for (let index = 0; index < paths.length; index++) {
      if (stopRequestedRef.current) {
        break;
      }

      await waitWhileBatchPaused();
      if (stopRequestedRef.current) {
        break;
      }

      const currentPath = paths[index];
      const shortName = currentPath.split(/[\/]/).pop() ?? currentPath;
      setInputPath(currentPath);
      setInputMode(mode);
      setProgress({
        done: index,
        total: paths.length,
        percent: Math.round((index / paths.length) * 100),
        status: `${index + 1}/${paths.length}: ${shortName}`
      });

      try {
        const { out, donePayload } = await optimizeSingleForBatch(currentPath, mode);
        if (stopRequestedRef.current) {
          break;
        }
        nextResults.push({
          input: currentPath,
          output: out,
          success: true,
          savedBytes: donePayload.savedBytes
        });
      } catch (error: any) {
        if (stopRequestedRef.current) {
          break;
        }
        nextResults.push({
          input: currentPath,
          success: false,
          error: String(error)
        });
      }
    }

    setBatchResults(nextResults);
    setProgress({
      done: nextResults.filter((item) => item.success).length,
      total: nextResults.length,
      percent: 100,
      status: quickSummaryTitle
    });
    setPhase("batchDone");
    setBatchPaused(false);

    if (autoCloseAfterFinish) {
      setAutoCloseSeconds(10);
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
    setBatchResults([]);
    setErrorMsg("");
    setFloatingFiles([]);
    setCurrentFile("");
    setProgress({ done: 0, total: 0, percent: 0, status: "" });
    setClosePromptOpen(false);
    setBatchPaused(false);
    setAutoCloseSeconds(null);
    autoCloseEnabledRef.current = false;
    stopRequestedRef.current = false;
  };

  const stepIndex = { idle: 0, preparing: 0, running: 1, reviewing: 2, exporting: 3, done: 3, error: 0, batching: 1, batchDone: 3 };
  const isBusyPhase = phase === "preparing" || phase === "running" || phase === "exporting" || phase === "batching";
  const pauseLabel = locale === "ru" ? "\u041f\u0430\u0443\u0437\u0430" : "Pause";
  const resumeLabel = locale === "ru" ? "\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c" : "Resume";
  const stopLabel = locale === "ru" ? "\u041e\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c" : "Stop";
  const closePromptTitle = locale === "ru" ? "\u041f\u0440\u043e\u0446\u0435\u0441\u0441 \u0435\u0449\u0435 \u0438\u0434\u0435\u0442" : "Process is still running";
  const closePromptHint = locale === "ru"
    ? "\u041e\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c \u0442\u0435\u043a\u0443\u0449\u0443\u044e \u0437\u0430\u0434\u0430\u0447\u0443 \u0438 \u0437\u0430\u043a\u0440\u044b\u0442\u044c \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435?"
    : "Stop the current task and close the app?";
  const autoCloseHint = locale === "ru"
    ? `\u0410\u0432\u0442\u043e\u0437\u0430\u043a\u0440\u044b\u0442\u0438\u0435 \u0447\u0435\u0440\u0435\u0437 ${autoCloseSeconds} \u0441\u0435\u043a.`
    : `Closing automatically in ${autoCloseSeconds}s.`;
  const updateProgressPercent = updateProgress?.total
    ? Math.max(2, Math.min(100, Math.round((updateProgress.downloaded / updateProgress.total) * 100)))
    : (updateProgress?.state === "installing" ? 100 : 8);
  const updateProgressLabel = updateProgress?.state === "installing"
    ? (locale === "ru" ? "Установка обновления" : "Installing update")
    : updateProgress?.state === "done"
      ? (locale === "ru" ? "Готово к перезапуску" : "Ready to restart")
      : (locale === "ru" ? "Загрузка обновления" : "Downloading update");
  const currentStep = stepIndex[phase] ?? 0;
  const filteredReport = result?.report.filter((item) => activeTab === "errors" ? item.type === "error" : item.type === activeTab) ?? [];
  const batchSuccessCount = batchResults.filter((item) => item.success).length;
  const batchErrorCount = batchResults.length - batchSuccessCount;
  const batchSavedBytes = batchResults.reduce((sum, item) => sum + (item.savedBytes ?? 0), 0);

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

        <div className="header-tools">
          <button className="settings-btn" type="button" onClick={() => setIsSettingsOpen(true)} aria-label={settingsTitle}>
            <span className="settings-btn-icon">⚙</span>
          </button>
          <span className="header-version">v0.4.4</span>
        </div>
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

            <div className="options-card">
              <div className="options-card-title">{extraCleanupTitle}</div>

              <label className="option-row">
                <input
                  type="checkbox"
                  checked={removeUnused}
                  onChange={(event) => setRemoveUnused(event.target.checked)}
                />
                <span className="option-copy">
                  <span className="option-label">{removeUnusedLabel}</span>
                  <span className="option-hint">{removeUnusedHint}</span>
                </span>
              </label>

              <label className="option-row">
                <input
                  type="checkbox"
                  checked={dedupeImages}
                  onChange={(event) => setDedupeImages(event.target.checked)}
                />
                <span className="option-copy">
                  <span className="option-label">{dedupeLabel}</span>
                  <span className="option-hint">{dedupeHint}</span>
                </span>
              </label>
            </div>

            <div className="actions">
              <button className="btn-primary" disabled={!inputPath} onClick={runAll}>
                {inputMode === "zip" ? t.runZip : t.runFolder}
              </button>
              <button className="btn-ghost" onClick={runQuickBatch}>
                {quickOptimizeLabel}
              </button>
            </div>
          </div>
        )}

        {(phase === "preparing" || phase === "running" || phase === "exporting" || phase === "batching") && (
          <div className="running running--full">
            <div className="running-label">
              {phase === "preparing" && (inputMode === "zip" ? t.phasePreparingZip : t.phasePreparingFolder)}
              {phase === "running" && t.phaseRunning}
              {phase === "exporting" && (exportMode === "zip" ? t.phaseExportZip : t.phaseExportFolder)}
              {phase === "batching" && quickOptimizeLabel}
            </div>
            <div className="running-status">{progress.status}</div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: (phase === "preparing" || phase === "exporting") ? "100%" : `${progress.percent}%` }} />
            </div>
            <div className="progress-label">
              {(phase === "running" || phase === "batching") && progress.total > 0 ? t.filesProgress(progress.done, progress.total, progress.percent) : ""}
            </div>

            <div className="progress-actions">
              {phase === "batching" && (
                <button className="btn-ghost" onClick={() => void toggleBatchPause()}>
                  {batchPaused ? resumeLabel : pauseLabel}
                </button>
              )}
              {isBusyPhase && (
                <button className="btn-ghost btn-ghost--danger" onClick={() => void stopActiveWork()}>
                  {stopLabel}
                </button>
              )}
            </div>

            {(phase === "running" || phase === "batching") && progress.total > 0 && (
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

            {(phase === "running" || phase === "batching") && (
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
            {autoCloseSeconds !== null && <p className="done-hint done-hint--countdown">{autoCloseHint}</p>}
            <button className="btn-primary" onClick={() => void reset()}>{t.optimizeAnother}</button>
          </div>
        )}

        {phase === "batchDone" && (
          <div className="done-state">
            <div className="done-icon">✓</div>
            <p className="done-title">{quickSummaryTitle}</p>
            <p className="done-hint">{quickSummaryHint}</p>
            <div className="result-summary batch-summary">
              <div className="result-hero">
                <span className="result-hero-label">{t.saved}</span>
                <span className="result-hero-value">{formatBytes(batchSavedBytes)}</span>
              </div>
              <div className="result-stats">
                <div className="stat">
                  <span className="stat-value stat-value--teal">{batchSuccessCount}</span>
                  <span className="stat-label">{locale === "ru" ? "\u0443\u0441\u043f\u0435\u0448\u043d\u043e" : "success"}</span>
                </div>
                <div className="stat-divider" />
                <div className="stat">
                  <span className="stat-value stat-value--red">{batchErrorCount}</span>
                  <span className="stat-label">{locale === "ru" ? "\u0441 \u043e\u0448\u0438\u0431\u043a\u0430\u043c\u0438" : "with errors"}</span>
                </div>
              </div>
            </div>
            <div className="report report--full batch-report">
              <div className="report-list">
                {batchResults.map((item) => (
                  <div key={item.input} className={`report-item ${item.success ? "" : "report-item--error"}`}>
                    <span className="report-file">{item.input}</span>
                    <span className="report-meta">
                      {item.success
                        ? `${formatBytes(item.savedBytes ?? 0)} saved`
                        : (item.error ?? "Error")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {autoCloseSeconds !== null && <p className="done-hint done-hint--countdown">{autoCloseHint}</p>}
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
        {closePromptOpen && (
          <div className="modal-backdrop" onClick={resumeAfterClosePrompt}>
            <div className="modal-card" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <h3>{closePromptTitle}</h3>
                <button type="button" className="modal-close" onClick={resumeAfterClosePrompt}>×</button>
              </div>

              <div className="modal-section">
                <p className="update-hint">{closePromptHint}</p>
                {phase === "batching" && (
                  <p className="update-hint">{locale === "ru" ? "\u041f\u0430\u043a\u0435\u0442\u043d\u0430\u044f \u043e\u0447\u0435\u0440\u0435\u0434\u044c \u0443\u0436\u0435 \u043f\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u0430 \u043d\u0430 \u043f\u0430\u0443\u0437\u0443." : "The batch queue is already paused."}</p>
                )}
              </div>

              <div className="modal-actions">
                <button className="btn-primary btn-primary--danger" onClick={() => void stopActiveWork(true)}>
                  {locale === "ru" ? "\u041e\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c \u0438 \u0437\u0430\u043a\u0440\u044b\u0442\u044c" : "Stop and close"}
                </button>
                <button className="btn-ghost" onClick={resumeAfterClosePrompt}>
                  {locale === "ru" ? "\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u0440\u0430\u0431\u043e\u0442\u0443" : "Keep working"}
                </button>
              </div>
            </div>
          </div>
        )}

        {isSettingsOpen && (
          <div className="modal-backdrop" onClick={() => setIsSettingsOpen(false)}>
            <div className="modal-card" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <h3>{settingsTitle}</h3>
                <button type="button" className="modal-close" onClick={() => setIsSettingsOpen(false)}>×</button>
              </div>

              <div className="modal-section">
                <div className="modal-section-title">{contextMenuTitle}</div>

                <label className="option-row">
                  <input
                    type="checkbox"
                    checked={contextMenuNormal}
                    onChange={(event) => setContextMenuNormal(event.target.checked)}
                  />
                  <span className="option-copy">
                    <span className="option-label">{contextNormalLabel}</span>
                  </span>
                </label>

                <label className="option-row">
                  <input
                    type="checkbox"
                    checked={contextMenuQuick}
                    onChange={(event) => setContextMenuQuick(event.target.checked)}
                  />
                  <span className="option-copy">
                    <span className="option-label">{contextQuickLabel}</span>
                  </span>
                </label>
              </div>

              <div className="modal-actions">
                <button className="btn-primary" disabled={isSavingSettings} onClick={() => void saveContextMenuSettings()}>
                  {settingsSave}
                </button>
                <button className="btn-ghost" onClick={() => setIsSettingsOpen(false)}>
                  {settingsClose}
                </button>
              </div>
            </div>
          </div>
        )}

        {updateInfo && (
          <div className="modal-backdrop" onClick={() => { if (!isInstallingUpdate) { setUpdateInfo(null); setUpdateProgress(null); } }}>
            <div className="modal-card" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <h3>{updateTitle}</h3>
                <button type="button" className="modal-close" onClick={() => { if (!isInstallingUpdate) { setUpdateInfo(null); setUpdateProgress(null); } }}>?</button>
              </div>

              <div className="modal-section">
                <div className="update-version-line">
                  {updateInfo.current_version} ? {updateInfo.version}
                </div>
                <p className="update-hint">{updateHint}</p>
                {updateInfo.notes && <div className="update-notes">{updateInfo.notes}</div>}
                {updateProgress && (
                  <div className="update-progress-card">
                    <div className="update-progress-head">
                      <span className="update-progress-title">{updateProgressLabel}</span>
                      <span className="update-progress-percent">{updateProgressPercent}%</span>
                    </div>
                    <div className="update-progress-track">
                      <div
                        className={`update-progress-fill update-progress-fill--${updateProgress.state}`}
                        style={{ width: `${updateProgressPercent}%` }}
                      />
                    </div>
                    <div className="update-progress-meta">
                      <span>{updateProgress.message}</span>
                      {updateProgress.state === "downloading" && (
                        <>
                          <span>{formatSpeed(updateProgress.bytes_per_second, locale)}</span>
                          <span>{formatEta(updateProgress.eta_seconds, locale)}</span>
                        </>
                      )}
                      {updateProgress.state === "installing" && (
                        <span>{locale === "ru" ? "??? ????????" : "Almost there?"}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button className="btn-primary" disabled={isInstallingUpdate} onClick={() => void installUpdate()}>
                  {isInstallingUpdate ? (locale === "ru" ? "??????????" : "Updating?") : updateNowLabel}
                </button>
                <button className="btn-ghost" disabled={isInstallingUpdate} onClick={() => { setUpdateInfo(null); setUpdateProgress(null); }}>
                  {updateLaterLabel}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
