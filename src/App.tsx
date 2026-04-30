import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type InputMode = "zip" | "folder";
type ExportMode = "zip" | "folder";
type Phase = "idle" | "preparing" | "running" | "reviewing" | "exporting" | "done" | "error" | "batching" | "batchDone";
type ReportTab = "assets" | "converted" | "deleted" | "errors";
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

interface ReferencedAsset {
  file: string;
  kind: "image" | "video" | "font" | "script" | "style" | "other";
  exists: boolean;
}

interface DonePayload {
  converted: number;
  deleted: number;
  replacedFiles: number;
  savedBytes: number;
  report: ReportItem[];
  referencedAssets?: ReferencedAsset[];
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
  converted?: number;
  deleted?: number;
  replacedFiles?: number;
  report?: ReportItem[];
  referencedAssets?: ReferencedAsset[];
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
    languageLabel: "\u042f\u0437\u044b\u043a",
    languageNative: "\u0420\u0443\u0441\u0441\u043a\u0438\u0439",
    languageEnglish: "English",
    steps: ["\u0412\u0445\u043e\u0434", "\u041e\u043f\u0442\u0438\u043c\u0438\u0437\u0430\u0446\u0438\u044f", "\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430", "\u042d\u043a\u0441\u043f\u043e\u0440\u0442"],
    inputZip: "ZIP-\u0430\u0440\u0445\u0438\u0432",
    inputFolder: "\u041f\u0430\u043f\u043a\u0430",
    dropZip: "\u041f\u0435\u0440\u0435\u0442\u0430\u0449\u0438 \u0441\u044e\u0434\u0430 ZIP \u0441\u0430\u0439\u0442\u0430",
    dropFolder: "\u041f\u0435\u0440\u0435\u0442\u0430\u0449\u0438 \u0441\u044e\u0434\u0430 \u043f\u0430\u043f\u043a\u0443 \u0441\u0430\u0439\u0442\u0430",
    browseZip: "\u0438\u043b\u0438 \u043d\u0430\u0436\u043c\u0438 \u0434\u043b\u044f \u0432\u044b\u0431\u043e\u0440\u0430 \u00b7 \u0442\u043e\u043b\u044c\u043a\u043e .zip",
    browseFolder: "\u0438\u043b\u0438 \u043d\u0430\u0436\u043c\u0438 \u0434\u043b\u044f \u0432\u044b\u0431\u043e\u0440\u0430",
    changeFile: "\u0418\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u0444\u0430\u0439\u043b",
    changeFolder: "\u0418\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u0430\u043f\u043a\u0443",
    runZip: "\u0420\u0430\u0441\u043f\u0430\u043a\u043e\u0432\u0430\u0442\u044c \u0438 \u043e\u043f\u0442\u0438\u043c\u0438\u0437\u0438\u0440\u043e\u0432\u0430\u0442\u044c",
    runFolder: "\u041e\u043f\u0442\u0438\u043c\u0438\u0437\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u043f\u0430\u043f\u043a\u0443",
    preparingZip: "\u0420\u0430\u0441\u043f\u0430\u043a\u043e\u0432\u043a\u0430 ZIP\u2026",
    preparingFolder: "\u041a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u043f\u0430\u043f\u043a\u0438\u2026",
    optimizerStarting: "\u0417\u0430\u043f\u0443\u0441\u043a \u043e\u043f\u0442\u0438\u043c\u0438\u0437\u0430\u0446\u0438\u0438\u2026",
    exportingZip: "\u0423\u043f\u0430\u043a\u043e\u0432\u043a\u0430 ZIP\u2026",
    exportingFolder: "\u041a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u0430\u2026",
    scanFound: (label: string, codeCount: number) => `\u041d\u0430\u0439\u0434\u0435\u043d\u043e ${label} \u0432 ${codeCount} \u043a\u043e\u0434\u043e\u0432\u044b\u0445 \u0444\u0430\u0439\u043b\u0430\u0445`,
    classify: (toConvert: number, toDelete: number) => `${toConvert} \u043d\u0430 \u043e\u043f\u0442\u0438\u043c\u0438\u0437\u0430\u0446\u0438\u044e \u00b7 ${toDelete} \u043d\u0430 \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u0435`,
    zeroImages: "0 \u043c\u0435\u0434\u0438\u0430\u0444\u0430\u0439\u043b\u043e\u0432",
    phasePreparingZip: "\u0420\u0430\u0441\u043f\u0430\u043a\u043e\u0432\u043a\u0430 \u0430\u0440\u0445\u0438\u0432\u0430",
    phasePreparingFolder: "\u041a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u043f\u0430\u043f\u043a\u0438",
    phaseRunning: "\u041e\u043f\u0442\u0438\u043c\u0438\u0437\u0430\u0446\u0438\u044f \u043c\u0435\u0434\u0438\u0430\u0444\u0430\u0439\u043b\u043e\u0432",
    phaseExportZip: "\u0423\u043f\u0430\u043a\u043e\u0432\u043a\u0430 ZIP",
    phaseExportFolder: "\u041a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u0430",
    filesProgress: (done: number, total: number, percent: number) => `${done} / ${total} \u0444\u0430\u0439\u043b\u043e\u0432 \u00b7 ${percent}%`,
    queued: "\u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u0438",
    processed: "\u043e\u0431\u0440\u0430\u0431\u043e\u0442\u0430\u043d\u043e",
    left: "\u043e\u0441\u0442\u0430\u043b\u043e\u0441\u044c",
    saved: "\u042d\u043a\u043e\u043d\u043e\u043c\u0438\u044f",
    compressed: "\u0441\u0436\u0430\u0442\u043e",
    deleted: "\u0443\u0434\u0430\u043b\u0435\u043d\u043e",
    filesUpdated: "\u0444\u0430\u0439\u043b\u043e\u0432 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u043e",
    reviewTitle: "\u0413\u043e\u0442\u043e\u0432\u043e \u043a \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0435",
    reviewHint: "\u041e\u0442\u043a\u0440\u043e\u0439 \u043f\u0430\u043f\u043a\u0443 \u0432\u044b\u0448\u0435, \u043f\u0440\u043e\u0432\u0435\u0440\u044c \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442 \u0438 \u043f\u043e\u0442\u043e\u043c \u0432\u044b\u0431\u0435\u0440\u0438 \u0444\u043e\u0440\u043c\u0430\u0442 \u044d\u043a\u0441\u043f\u043e\u0440\u0442\u0430.",
    tabConverted: "\u041e\u043f\u0442\u0438\u043c\u0438\u0437\u0438\u0440\u043e\u0432\u0430\u043d\u043e",
    tabDeleted: "\u0423\u0434\u0430\u043b\u0435\u043d\u043e",
    tabErrors: "\u041e\u0448\u0438\u0431\u043a\u0438",
    freed: (value: string) => `\u043e\u0441\u0432\u043e\u0431\u043e\u0436\u0434\u0435\u043d\u043e ${value}`,
    emptyTab: "\u0417\u0434\u0435\u0441\u044c \u043f\u043e\u043a\u0430 \u043d\u0438\u0447\u0435\u0433\u043e \u043d\u0435\u0442",
    exportFormat: "\u0424\u043e\u0440\u043c\u0430\u0442 \u044d\u043a\u0441\u043f\u043e\u0440\u0442\u0430",
    outputZip: (path: string) => `\u0412\u044b\u0445\u043e\u0434\u043d\u043e\u0439 \u0444\u0430\u0439\u043b: ${path}`,
    outputFolder: (path: string) => `\u0412\u044b\u0445\u043e\u0434\u043d\u0430\u044f \u043f\u0430\u043f\u043a\u0430: ${path}`,
    exportZip: "\u0423\u043f\u0430\u043a\u043e\u0432\u0430\u0442\u044c \u0438 \u044d\u043a\u0441\u043f\u043e\u0440\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c ZIP",
    exportFolder: "\u042d\u043a\u0441\u043f\u043e\u0440\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u043f\u0430\u043f\u043a\u0443",
    cancel: "\u041e\u0442\u043c\u0435\u043d\u0430",
    exportDone: "\u042d\u043a\u0441\u043f\u043e\u0440\u0442 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d",
    exportDoneZip: "\u041e\u043f\u0442\u0438\u043c\u0438\u0437\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0439 ZIP \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d \u0440\u044f\u0434\u043e\u043c \u0441 \u0438\u0441\u0445\u043e\u0434\u043d\u044b\u043c \u0444\u0430\u0439\u043b\u043e\u043c.",
    exportDoneFolder: "\u041e\u043f\u0442\u0438\u043c\u0438\u0437\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u0430\u044f \u043f\u0430\u043f\u043a\u0430 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0430 \u0440\u044f\u0434\u043e\u043c \u0441 \u0438\u0441\u0445\u043e\u0434\u043d\u043e\u0439.",
    optimizeAnother: "\u041e\u043f\u0442\u0438\u043c\u0438\u0437\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0434\u0440\u0443\u0433\u043e\u0439 \u0441\u0430\u0439\u0442",
    tryAgain: "\u041f\u043e\u043f\u0440\u043e\u0431\u043e\u0432\u0430\u0442\u044c \u0441\u043d\u043e\u0432\u0430"
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
    browseZip: "or click to browse \u00b7 .zip only",
    browseFolder: "or click to browse",
    changeFile: "Change file",
    changeFolder: "Change folder",
    runZip: "Unzip & Optimize",
    runFolder: "Optimize Folder",
    preparingZip: "Extracting ZIP\u2026",
    preparingFolder: "Copying folder\u2026",
    optimizerStarting: "Starting optimizer\u2026",
    exportingZip: "Packing ZIP\u2026",
    exportingFolder: "Copying output\u2026",
    scanFound: (label: string, codeCount: number) => `Found ${label} across ${codeCount} code files`,
    classify: (toConvert: number, toDelete: number) => `${toConvert} to optimize \u00b7 ${toDelete} to delete`,
    zeroImages: "0 media files",
    phasePreparingZip: "Extracting archive",
    phasePreparingFolder: "Copying folder",
    phaseRunning: "Optimizing media files",
    phaseExportZip: "Packing ZIP",
    phaseExportFolder: "Copying output",
    filesProgress: (done: number, total: number, percent: number) => `${done} / ${total} files \u00b7 ${percent}%`,
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
    return locale === "ru" ? "\u0441\u0447\u0438\u0442\u0430\u0435\u043c \u0441\u043a\u043e\u0440\u043e\u0441\u0442\u044c\u2026" : "measuring speed\u2026";
  }

  return `${formatBytes(Math.round(bytesPerSecond))}/${locale === "ru" ? "\u0441" : "s"}`;
}

function formatEta(seconds: number | null | undefined, locale: Locale): string {
  if (seconds == null || seconds <= 0) {
    return locale === "ru" ? "\u0435\u0449\u0435 \u043d\u0435\u043c\u043d\u043e\u0433\u043e\u2026" : "almost there\u2026";
  }

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins <= 0) {
    return locale === "ru" ? `\u043f\u0440\u0438\u043c\u0435\u0440\u043d\u043e ${secs} \u0441\u0435\u043a.` : `about ${secs}s`;
  }

  return locale === "ru" ? `\u043f\u0440\u0438\u043c\u0435\u0440\u043d\u043e ${mins} \u043c\u0438\u043d ${secs} \u0441\u0435\u043a.` : `about ${mins}m ${secs}s`;
}

type ReportReasonTone = "good" | "warn" | "danger" | "neutral";

interface ReportReasonInfo {
  label: string;
  tone: ReportReasonTone;
}

interface ReportBreakdown {
  converted: number;
  deleted: number;
  unused: number;
  duplicates: number;
  manual: number;
  skipped: number;
  dynamic: number;
  errors: number;
}

interface ReferencedAssetBreakdown {
  total: number;
  present: number;
  missing: number;
  image: number;
  video: number;
  font: number;
  script: number;
  style: number;
  other: number;
}

function getReportReasonInfo(item: ReportItem, locale: Locale): ReportReasonInfo {
  const message = (item.message ?? "").toLowerCase();

  if (item.type === "converted") {
    return {
      label: locale === "ru" ? "Оптимизировано" : "Optimized",
      tone: "good"
    };
  }

  if (item.type === "deleted") {
    if (message.includes("готовый webp") || message.includes("existing webp")) {
      return {
        label: locale === "ru" ? "Готовый WEBP" : "Existing WEBP",
        tone: "warn"
      };
    }

    if (message.includes("не используется") || message.includes("unused")) {
      return {
        label: locale === "ru" ? "Не используется" : "Unused",
        tone: "warn"
      };
    }

    if (message.includes("дубликат") || message.includes("duplicate")) {
      return {
        label: locale === "ru" ? "Дубликат" : "Duplicate",
        tone: "warn"
      };
    }

    if (message.includes("вручную") || message.includes("manual") || message.includes("user")) {
      return {
        label: locale === "ru" ? "Удалено вручную" : "Manual delete",
        tone: "warn"
      };
    }

    return {
      label: locale === "ru" ? "Удалено" : "Deleted",
      tone: "warn"
    };
  }

  if (message.includes("динамичес") || message.includes("dynamic")) {
    return {
      label: locale === "ru" ? "Динамическая ссылка" : "Dynamic link",
      tone: "danger"
    };
  }

  if (message.includes("пропущ") || message.includes("skipped")) {
    return {
      label: locale === "ru" ? "Пропущено" : "Skipped",
      tone: "warn"
    };
  }

  return {
    label: locale === "ru" ? "Ошибка" : "Error",
    tone: "danger"
  };
}

function getReportBreakdown(report: ReportItem[]): ReportBreakdown {
  return report.reduce<ReportBreakdown>((summary, item) => {
    const message = (item.message ?? "").toLowerCase();

    if (item.type === "converted") {
      summary.converted += 1;
      return summary;
    }

    if (item.type === "deleted") {
      summary.deleted += 1;
      if (message.includes("готовый webp") || message.includes("existing webp")) {
        summary.duplicates += 1;
      } else if (message.includes("не используется") || message.includes("unused")) {
        summary.unused += 1;
      } else if (message.includes("дубликат") || message.includes("duplicate")) {
        summary.duplicates += 1;
      } else if (message.includes("вручную") || message.includes("manual") || message.includes("user")) {
        summary.manual += 1;
      }
      return summary;
    }

    if (message.includes("динамичес") || message.includes("dynamic")) {
      summary.dynamic += 1;
    }

    if (message.includes("пропущ") || message.includes("skipped")) {
      summary.skipped += 1;
    } else {
      summary.errors += 1;
    }

    return summary;
  }, {
    converted: 0,
    deleted: 0,
    unused: 0,
    duplicates: 0,
    manual: 0,
    skipped: 0,
    dynamic: 0,
    errors: 0
  });
}

function getReferencedAssetBreakdown(assets: ReferencedAsset[]): ReferencedAssetBreakdown {
  return assets.reduce<ReferencedAssetBreakdown>((summary, asset) => {
    summary.total += 1;
    if (asset.exists) {
      summary.present += 1;
    } else {
      summary.missing += 1;
    }
    summary[asset.kind] += 1;
    return summary;
  }, {
    total: 0,
    present: 0,
    missing: 0,
    image: 0,
    video: 0,
    font: 0,
    script: 0,
    style: 0,
    other: 0
  });
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
  const [activeTab, setActiveTab] = useState<ReportTab>("assets");
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
  const [activeBatchIndex, setActiveBatchIndex] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [contextMenuNormal, setContextMenuNormal] = useState(false);
  const [contextMenuQuick, setContextMenuQuick] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<UpdateDownloadProgress | null>(null);
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [batchPaused, setBatchPaused] = useState(false);
  const [autoCloseSeconds, setAutoCloseSeconds] = useState<number | null>(null);
  const unlisten = useRef<(() => void) | null>(null);
  const floatCounter = useRef(0);
  const languageSwitcherRef = useRef<HTMLDivElement | null>(null);
  const batchPausedRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const autoCloseCancelArmedRef = useRef(false);
  const autoCloseDelayRef = useRef(10);
  const t = translations[locale];

  const showMainWindow = useCallback(async () => {
    try {
      await invoke("show_main_window");
    } catch {
      // ignore show failures
    }
  }, []);

  const hideMainWindow = useCallback(async () => {
    try {
      await invoke("hide_main_window");
    } catch {
      // ignore hide failures
    }
  }, []);

  const stopCurrentOperation = useCallback(async () => {
    try {
      await invoke("stop_current_operation");
    } catch {
      // ignore stop failures
    }
  }, []);

  const setActivityState = useCallback(async (isBusy: boolean) => {
    try {
      await invoke("set_activity_state", { isBusy });
    } catch {
      // ignore state sync failures
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
    void setActivityState(phase === "preparing" || phase === "running" || phase === "exporting" || phase === "batching");
  }, [phase, setActivityState]);

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
          void hideMainWindow();
          window.setTimeout(() => {
            if (launchPaths.length === 1) {
              void runQuickSingleFromPath(firstPath, isZip ? "zip" : "folder", true);
              return;
            }
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

        if (payload.mode === "quick") {
          void hideMainWindow();
          if (payload.paths.length === 1) {
            void runQuickSingleFromPath(firstPath, isZip ? "zip" : "folder", true);
            return;
          }
          void runQuickBatchFromPaths(payload.paths, isZip ? "zip" : "folder", true);
          return;
        }
        void showMainWindow();
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
  }, [checkForUpdates, hideMainWindow, phase, quitApp, showMainWindow]);

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
      if (!autoCloseCancelArmedRef.current) return;
      setAutoCloseSeconds(null);
      autoCloseCancelArmedRef.current = false;
    };

    window.addEventListener("pointerdown", cancelAutoClose);
    window.addEventListener("keydown", cancelAutoClose);

    return () => {
      window.removeEventListener("pointerdown", cancelAutoClose);
      window.removeEventListener("keydown", cancelAutoClose);
    };
  }, [autoCloseSeconds]);

  useEffect(() => {
    if (phase === "done" || phase === "batchDone") {
      autoCloseCancelArmedRef.current = false;
      setAutoCloseSeconds(autoCloseDelayRef.current);
      const armTimer = window.setTimeout(() => {
        autoCloseCancelArmedRef.current = true;
      }, 500);
      return () => window.clearTimeout(armTimer);
    }

    autoCloseCancelArmedRef.current = false;
    setAutoCloseSeconds(null);
  }, [phase]);


  const currentLanguageLabel = locale === "ru" ? t.languageNative : t.languageEnglish;
  const alternateLocale: Locale = locale === "ru" ? "en" : "ru";
  const alternateLanguageLabel = alternateLocale === "ru"
    ? (locale === "ru" ? translations.ru.languageNative : translations.en.languageNative)
    : (locale === "ru" ? t.languageEnglish : translations.en.languageEnglish);
  const extraCleanupTitle = locale === "ru" ? "\u0414\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u0430\u044f \u043e\u0447\u0438\u0441\u0442\u043a\u0430" : "Extra Cleanup";
  const removeUnusedLabel = locale === "ru" ? "\u0423\u0434\u0430\u043b\u044f\u0442\u044c \u043d\u0435\u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u043c\u044b\u0435 \u043c\u0435\u0434\u0438\u0430\u0444\u0430\u0439\u043b\u044b" : "Remove unused media files";
  const removeUnusedHint = locale === "ru"
    ? "\u041e\u0441\u0442\u043e\u0440\u043e\u0436\u043d\u044b\u0439 \u0440\u0435\u0436\u0438\u043c: \u0443\u0434\u0430\u043b\u044f\u044e\u0442\u0441\u044f \u0442\u043e\u043b\u044c\u043a\u043e \u0444\u0430\u0439\u043b\u044b, \u0434\u043b\u044f \u043a\u043e\u0442\u043e\u0440\u044b\u0445 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e \u043d\u0430\u0434\u0435\u0436\u043d\u044b\u0445 \u0441\u0441\u044b\u043b\u043e\u043a \u0432 \u043a\u043e\u0434\u0435."
    : "Use carefully: custom templates and lazy-load setups may need review.";
  const dedupeLabel = locale === "ru" ? "\u0423\u0434\u0430\u043b\u044f\u0442\u044c \u0434\u0443\u0431\u043b\u0438\u043a\u0430\u0442\u044b \u043c\u0435\u0434\u0438\u0430\u0444\u0430\u0439\u043b\u043e\u0432" : "Remove duplicate media files";
  const dedupeHint = locale === "ru"
    ? "\u0414\u0443\u0431\u043b\u0438\u043a\u0430\u0442\u044b \u0438\u0449\u0443\u0442\u0441\u044f \u043f\u043e \u0441\u043e\u0434\u0435\u0440\u0436\u0438\u043c\u043e\u043c\u0443 \u0444\u0430\u0439\u043b\u0430 \u0438 \u043e\u0431\u044a\u0435\u0434\u0438\u043d\u044f\u044e\u0442\u0441\u044f \u0432 \u043e\u0434\u0438\u043d \u043e\u0440\u0438\u0433\u0438\u043d\u0430\u043b."
    : "Duplicates are detected by file content and merged into a single original.";
  const quickOptimizeLabel = locale === "ru" ? "\u0411\u044b\u0441\u0442\u0440\u043e \u043e\u043f\u0442\u0438\u043c\u0438\u0437\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u043f\u0430\u0447\u043a\u0443" : "Quick optimize batch";
  const quickSummaryTitle = locale === "ru" ? "\u041f\u0430\u043a\u0435\u0442\u043d\u0430\u044f \u043e\u043f\u0442\u0438\u043c\u0438\u0437\u0430\u0446\u0438\u044f \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0430" : "Batch optimization complete";
  const quickSummaryHint = locale === "ru"
    ? "\u0412\u0441\u0435 \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0435 \u0441\u0430\u0439\u0442\u044b \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u0430\u043d\u044b \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u0438 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u044b \u0440\u044f\u0434\u043e\u043c \u0441 \u0438\u0441\u0445\u043e\u0434\u043d\u0438\u043a\u0430\u043c\u0438."
    : "All selected sites were processed automatically and saved next to the originals.";
  const settingsTitle = locale === "ru" ? "\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438" : "Settings";
  const settingsSave = locale === "ru" ? "\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c" : "Save";
  const settingsClose = locale === "ru" ? "\u0417\u0430\u043a\u0440\u044b\u0442\u044c" : "Close";
  const contextMenuTitle = locale === "ru" ? "\u041f\u0443\u043d\u043a\u0442\u044b \u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442\u043d\u043e\u0433\u043e \u043c\u0435\u043d\u044e" : "Context menu entries";
  const updateTitle = locale === "ru" ? "\u0414\u043e\u0441\u0442\u0443\u043f\u043d\u0430 \u043d\u043e\u0432\u0430\u044f \u0432\u0435\u0440\u0441\u0438\u044f" : "New version available";
  const updateHint = locale === "ru" ? "\u0425\u043e\u0442\u0438\u0442\u0435 \u0441\u043a\u0430\u0447\u0430\u0442\u044c \u0438 \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435 \u0441\u0435\u0439\u0447\u0430\u0441?" : "Do you want to download and install the update now?";
  const updateNowLabel = locale === "ru" ? "\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u0441\u0435\u0439\u0447\u0430\u0441" : "Update now";
  const updateLaterLabel = locale === "ru" ? "\u041f\u043e\u0437\u0436\u0435" : "Later";
  const contextNormalLabel = locale === "ru" ? "\u041e\u043f\u0442\u0438\u043c\u0438\u0437\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0441\u0430\u0439\u0442" : "Optimize site";
  const contextQuickLabel = locale === "ru" ? "\u0411\u044b\u0441\u0442\u0440\u043e \u043e\u043f\u0442\u0438\u043c\u0438\u0437\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0441\u0430\u0439\u0442" : "Quick optimize site";

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

  const runQuickSingleFromPath = async (path: string, mode: InputMode, autoCloseAfterFinish: boolean) => {
    await startListening();
    autoCloseDelayRef.current = autoCloseAfterFinish ? 3 : 10;
    autoCloseCancelArmedRef.current = false;
    stopRequestedRef.current = false;
    setBatchPaused(false);
    setClosePromptOpen(false);
    setBatchResults([]);
    setActiveBatchIndex(0);
    setResult(null);
    setWorkDir(null);
    setOutputPath(null);
    setErrorMsg("");
    setFloatingFiles([]);
    setCurrentFile("");
    setInputPath(path);
    setInputMode(mode);
    setAutoCloseSeconds(null);
    setPhase("preparing");
    setProgress({
      done: 0,
      total: 0,
      percent: 0,
      status: mode === "zip" ? t.preparingZip : t.preparingFolder
    });

    try {
      const dir = mode === "zip"
        ? await invoke<string>("unzip_site", { zipPath: path })
        : await invoke<string>("prepare_folder", { folderPath: path });

      setWorkDir(dir);
      setPhase("running");
      setProgress({ done: 0, total: 0, percent: 0, status: t.optimizerStarting });

      await invoke("optimize_site", {
        workDir: dir,
        removeUnused,
        dedupeImages
      });

      if (stopRequestedRef.current) {
        return;
      }

      setPhase("exporting");
      setProgress({
        done: 0,
        total: 0,
        percent: 0,
        status: exportMode === "zip" ? t.exportingZip : t.exportingFolder
      });

      const out = exportMode === "zip"
        ? await invoke<string>("export_as_zip", { workDir: dir, originalPath: path })
        : await invoke<string>("export_as_folder", { workDir: dir, originalPath: path });

      await invoke("cleanup_work_dir", { workDir: dir });
      setOutputPath(out);
      setPhase("done");
    } catch (error: any) {
      setErrorMsg(String(error));
      setPhase("error");
      unlisten.current?.();
    }
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
    autoCloseDelayRef.current = 10;
    autoCloseCancelArmedRef.current = false;
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
    autoCloseDelayRef.current = 10;
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
    autoCloseDelayRef.current = autoCloseAfterFinish ? 3 : 10;
    setPhase("batching");
    setBatchResults([]);
    setActiveBatchIndex(0);
    setResult(null);
    setOutputPath(null);
    setErrorMsg("");
    setFloatingFiles([]);
    setCurrentFile("");
    setClosePromptOpen(false);
    setBatchPaused(false);
    stopRequestedRef.current = false;
    autoCloseCancelArmedRef.current = false;
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
      const shortName = currentPath.split(/[\\/]/).pop() ?? currentPath;
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
          savedBytes: donePayload.savedBytes,
          converted: donePayload.converted,
          deleted: donePayload.deleted,
          replacedFiles: donePayload.replacedFiles,
          report: donePayload.report,
          referencedAssets: donePayload.referencedAssets
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
    setActiveBatchIndex(0);
    setProgress({
      done: nextResults.filter((item) => item.success).length,
      total: nextResults.length,
      percent: 100,
      status: quickSummaryTitle
    });
    setPhase("batchDone");
    setBatchPaused(false);
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
    setActiveBatchIndex(0);
    setIsReportOpen(false);
    setErrorMsg("");
    setFloatingFiles([]);
    setCurrentFile("");
    setProgress({ done: 0, total: 0, percent: 0, status: "" });
    setClosePromptOpen(false);
    setBatchPaused(false);
    setAutoCloseSeconds(null);
    autoCloseDelayRef.current = 10;
    autoCloseCancelArmedRef.current = false;
    stopRequestedRef.current = false;
  };

  const stepIndex = { idle: 0, preparing: 0, running: 1, reviewing: 2, exporting: 3, done: 3, error: 0, batching: 1, batchDone: 3 };
  const isBusyPhase = phase === "preparing" || phase === "running" || phase === "exporting" || phase === "batching";
  const pauseLabel = locale === "ru" ? "\u041f\u0430\u0443\u0437\u0430" : "Pause";
  const resumeLabel = locale === "ru" ? "\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c" : "Resume";
  const stopLabel = locale === "ru" ? "\u041e\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c" : "Stop";
  const openReportLabel = locale === "ru" ? "\u0414\u0435\u0442\u0430\u043b\u044c\u043d\u044b\u0439 \u043e\u0442\u0447\u0435\u0442" : "Detailed report";
  const reportTitle = locale === "ru" ? "\u041f\u043e\u0434\u0440\u043e\u0431\u043d\u044b\u0439 \u043e\u0442\u0447\u0435\u0442" : "Detailed report";
  const reportCloseLabel = locale === "ru" ? "\u0417\u0430\u043a\u0440\u044b\u0442\u044c \u043e\u0442\u0447\u0435\u0442" : "Close report";
  const reportSiteLabel = locale === "ru" ? "\u0421\u0430\u0439\u0442\u044b \u0432 \u043f\u0430\u0447\u043a\u0435" : "Batch sites";
  const reportAssetsLabel = locale === "ru" ? "\u041d\u0430\u0439\u0434\u0435\u043d\u043e \u0432 \u043a\u043e\u0434\u0435" : "Found in code";
  const reportOverviewLabel = locale === "ru" ? "\u041e\u0431\u0437\u043e\u0440 \u0441\u0430\u0439\u0442\u0430" : "Site overview";
  const reportPresentLabel = locale === "ru" ? "\u043d\u0430 \u043c\u0435\u0441\u0442\u0435" : "present";
  const reportMissingLabel = locale === "ru" ? "\u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e" : "missing";
  const reportAssetsHint = locale === "ru" ? "\u0412\u0441\u0435 \u0430\u0441\u0441\u0435\u0442\u044b, \u043a\u043e\u0442\u043e\u0440\u044b\u0435 \u0430\u043d\u0430\u043b\u0438\u0437\u0430\u0442\u043e\u0440 \u043d\u0430\u0448\u0435\u043b \u0432 \u043a\u043e\u0434\u0435." : "Every asset the analyzer found in code.";
  const reportPerformanceLabel = locale === "ru" ? "\u041f\u043e\u043b\u0435\u0437\u043d\u044b\u0439 \u044d\u0444\u0444\u0435\u043a\u0442" : "Optimization impact";
  const reportCoverageLabel = locale === "ru" ? "\u041f\u043e\u043a\u0440\u044b\u0442\u0438\u0435 \u043a\u043e\u0434\u0430" : "Code coverage";
  const reportDetailHint = locale === "ru" ? "\u041d\u0438\u0436\u0435 \u043f\u043e\u043b\u043d\u0430\u044f \u0442\u0435\u0445\u043d\u0438\u0447\u0435\u0441\u043a\u0430\u044f \u0440\u0430\u0441\u043a\u043b\u0430\u0434\u043a\u0430 \u043f\u043e \u0441\u0430\u0439\u0442\u0443." : "Full technical breakdown for this site.";
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
  const pausedStateLabel = locale === "ru" ? "Пакетная обработка на паузе" : "Batch processing paused";
  const currentStep = stepIndex[phase] ?? 0;
  const batchSuccessCount = batchResults.filter((item) => item.success).length;
  const batchErrorCount = batchResults.length - batchSuccessCount;
  const batchSavedBytes = batchResults.reduce((sum, item) => sum + (item.savedBytes ?? 0), 0);
  const activeBatchItem = batchResults[activeBatchIndex] ?? null;
  const reviewBreakdown = getReportBreakdown(result?.report ?? []);
  const activeBatchBreakdown = getReportBreakdown(activeBatchItem?.report ?? []);
  const reviewReferencedBreakdown = getReferencedAssetBreakdown(result?.referencedAssets ?? []);
  const activeBatchReferencedBreakdown = getReferencedAssetBreakdown(activeBatchItem?.referencedAssets ?? []);

  const getTabLabel = (tab: ReportTab) => {
    if (tab === "assets") return reportAssetsLabel;
    if (tab === "converted") return t.tabConverted;
    if (tab === "deleted") return t.tabDeleted;
    return t.tabErrors;
  };

  const getAssetKindLabel = (kind: ReferencedAsset["kind"]) => {
    if (kind === "image") return "IMG";
    if (kind === "video") return "VID";
    if (kind === "font") return "FNT";
    if (kind === "script") return "JS";
    if (kind === "style") return "CSS";
    return "FILE";
  };

  const getAssetKindTitle = (kind: ReferencedAsset["kind"]) => {
    if (kind === "image") return locale === "ru" ? "\u0418\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f" : "Images";
    if (kind === "video") return locale === "ru" ? "\u0412\u0438\u0434\u0435\u043e" : "Video";
    if (kind === "font") return locale === "ru" ? "\u0428\u0440\u0438\u0444\u0442\u044b" : "Fonts";
    if (kind === "script") return locale === "ru" ? "\u0421\u043a\u0440\u0438\u043f\u0442\u044b" : "Scripts";
    if (kind === "style") return locale === "ru" ? "\u0421\u0442\u0438\u043b\u0438" : "Styles";
    return locale === "ru" ? "\u0414\u0440\u0443\u0433\u043e\u0435" : "Other";
  };

  const getReportItemsForTab = (report: ReportItem[], tab: ReportTab) => {
    if (tab === "errors") return report.filter((item) => item.type === "error");
    if (tab === "converted") return report.filter((item) => item.type === "converted");
    if (tab === "deleted") return report.filter((item) => item.type === "deleted");
    return [];
  };

  const getTabCount = (report: ReportItem[], referencedAssets: ReferencedAsset[], tab: ReportTab) => {
    if (tab === "assets") return referencedAssets.length;
    return getReportItemsForTab(report, tab).length;
  };

  const renderReferencedAssetSummary = (summary: ReferencedAssetBreakdown) => {
    const items = [
      { key: "image", label: getAssetKindTitle("image"), value: summary.image },
      { key: "video", label: getAssetKindTitle("video"), value: summary.video },
      { key: "font", label: getAssetKindTitle("font"), value: summary.font },
      { key: "script", label: getAssetKindTitle("script"), value: summary.script },
      { key: "style", label: getAssetKindTitle("style"), value: summary.style }
    ].filter((item) => item.value > 0);

    return (
      <div className="report-chip-grid">
        {items.map((item) => (
          <div key={item.key} className="report-chip-card">
            <span className="report-chip-value">{item.value}</span>
            <span className="report-chip-label">{item.label}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderReportDistribution = (report: ReportItem[], summary: ReportBreakdown) => {
    const errors = report.filter((item) => item.type === "error");
    const skipped = summary.skipped + summary.dynamic;
    const totalProblemEvents = summary.errors + skipped;
    const grouped = new Map<string, { count: number; files: string[] }>();
    errors.forEach((item) => {
      const raw = (item.message ?? (locale === "ru" ? "Неизвестная ошибка" : "Unknown error")).trim();
      const label = raw.split("\n")[0].slice(0, 120);
      const current = grouped.get(label);
      if (!current) {
        grouped.set(label, { count: 1, files: [item.file] });
      } else {
        current.count += 1;
        if (current.files.length < 2) current.files.push(item.file);
      }
    });
    const topReasons = Array.from(grouped.entries())
      .map(([reason, info]) => ({ reason, count: info.count, files: info.files }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    const latestErrors = errors.slice(0, 4);
    const maxReasonCount = topReasons[0]?.count ?? 1;

    return (
      <div className="error-insight-panel">
        <div className="error-kpi-grid">
          <div className="error-kpi-card">
            <span className="error-kpi-value">{totalProblemEvents}</span>
            <span className="error-kpi-label">{locale === "ru" ? "\u0412\u0441\u0435\u0433\u043e \u043f\u0440\u043e\u0431\u043b\u0435\u043c" : "Total issues"}</span>
          </div>
          <div className="error-kpi-card">
            <span className="error-kpi-value">{summary.errors}</span>
            <span className="error-kpi-label">{locale === "ru" ? "\u041e\u0448\u0438\u0431\u043a\u0438" : "Errors"}</span>
          </div>
          <div className="error-kpi-card">
            <span className="error-kpi-value">{skipped}</span>
            <span className="error-kpi-label">{locale === "ru" ? "\u041f\u0440\u043e\u043f\u0443\u0441\u043a\u0438 / dynamic" : "Skipped / dynamic"}</span>
          </div>
        </div>

        <div className="error-reasons">
          <span className="error-reasons-title">{locale === "ru" ? "\u0422\u043e\u043f \u043f\u0440\u0438\u0447\u0438\u043d\u044b" : "Top reasons"}</span>
          {topReasons.length === 0 ? (
            <div className="error-empty">{locale === "ru" ? "\u041e\u0448\u0438\u0431\u043e\u043a \u043d\u0435\u0442" : "No errors found"}</div>
          ) : (
            <div className="error-reasons-list">
              {topReasons.map((item, index) => (
                <div key={`${item.reason}-${index}`} className="error-reason-item">
                  <div className="error-reason-copy">
                    <span className="error-reason-text" title={item.reason}>{item.reason}</span>
                    <span className="error-reason-count">{item.count}</span>
                  </div>
                  <div className="error-reason-track">
                    <span
                      className="error-reason-fill"
                      style={{
                        width: `${Math.max(12, Math.round((item.count / maxReasonCount) * 100))}%`,
                        animationDelay: `${220 + index * 90}ms`
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {latestErrors.length > 0 && (
          <div className="error-latest">
            <span className="error-latest-title">{locale === "ru" ? "\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0435 \u043e\u0448\u0438\u0431\u043a\u0438" : "Latest issues"}</span>
            {latestErrors.map((item, index) => (
              <div key={`${item.file}-${index}`} className="error-latest-item">
                <span className="error-latest-file" title={item.file}>{item.file}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderCoverageDistribution = (summary: ReferencedAssetBreakdown) => {
    const total = summary.total || 1;
    const entries = [
      { key: "present", label: reportPresentLabel, value: summary.present, tone: "good" },
      { key: "missing", label: reportMissingLabel, value: summary.missing, tone: "danger" }
    ];

    return (
      <div className="report-bars">
        {entries.map((entry, index) => (
          <div key={entry.key} className="report-bar-row">
            <div className="report-bar-copy">
              <span className="report-bar-label">{entry.label}</span>
              <span className="report-bar-value">{entry.value}</span>
            </div>
            <div className="report-bar-track">
              <span
                className={`report-bar-fill report-bar-fill--${entry.tone}`}
                style={{
                  width: `${Math.max(4, Math.round((entry.value / total) * 100))}%`,
                  animationDelay: `${180 + index * 110}ms`
                }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderOverviewDonut = (summary: ReportBreakdown) => {
    const slices = [
      { key: "optimized", value: summary.converted, color: "var(--teal)", label: locale === "ru" ? "Оптимизировано" : "Optimized" },
      { key: "unused", value: summary.unused, color: "#f3d89a", label: locale === "ru" ? "Не используется" : "Unused" },
      { key: "duplicates", value: summary.duplicates, color: "#7fa7ff", label: locale === "ru" ? "Дубликаты" : "Duplicates" },
      { key: "errors", value: summary.errors + summary.skipped + summary.dynamic, color: "var(--red)", label: locale === "ru" ? "Ошибки / пропуски" : "Errors / skipped" }
    ];
    const total = slices.reduce((sum, part) => sum + part.value, 0);
    if (total <= 0) return null;

    let cursor = 0;
    const stops = slices
      .filter((slice) => slice.value > 0)
      .map((slice) => {
        const from = cursor;
        const angle = (slice.value / total) * 360;
        cursor += angle;
        return `${slice.color} ${from}deg ${cursor}deg`;
      });

    return (
      <div className="overview-donut-wrap report-animate report-animate--delay-1">
        <div className="overview-donut" style={{ background: `conic-gradient(${stops.join(", ")})` }}>
          <div className="overview-donut-hole">
            <span className="overview-donut-total">{total}</span>
            <span className="overview-donut-total-label">{locale === "ru" ? "всего" : "total"}</span>
          </div>
        </div>
        <div className="overview-donut-legend">
          {slices.filter((slice) => slice.value > 0).map((slice, index) => (
            <div key={slice.key} className="overview-donut-legend-item" style={{ animationDelay: `${220 + index * 90}ms` }}>
              <span className="overview-donut-dot" style={{ background: slice.color }} />
              <span className="overview-donut-label">{slice.label}</span>
              <span className="overview-donut-value">{slice.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderReportItem = (item: ReportItem, key: string) => {
    const reason = getReportReasonInfo(item, locale);

    return (
      <div key={key} className={`report-item report-item--${item.type}`}>
        <div className="report-copy">
          <span className="report-file">{item.file}</span>
          <div className="report-detail-line">
            <span className={`report-reason report-reason--${reason.tone}`}>{reason.label}</span>
            {item.srcFormat && <span className="report-fmt">{item.srcFormat}</span>}
            {item.message && item.type !== "converted" && (
              <span className="report-detail-text">{item.message}</span>
            )}
          </div>
        </div>

            {item.type === "converted" && (
          <span className="report-meta">
            {formatBytes(item.originalSize ?? 0)} {"->"} {formatBytes(item.newSize ?? 0)}
            {typeof item.savedPercent === "number" && (
              <span className="report-badge">
                -{item.savedPercent}%{typeof item.saved === "number" ? ` · ${formatBytes(item.saved)}` : ""}
              </span>
            )}
          </span>
        )}

        {item.type === "deleted" && (
          <span className="report-meta">
            {formatBytes(item.originalSize ?? 0)}
          </span>
        )}
      </div>
    );
  };

  const renderReferencedAssetItem = (asset: ReferencedAsset, key: string) => (
    <div key={key} className={`report-item report-item--asset ${asset.exists ? "" : "report-item--error"}`}>
      <div className="report-copy">
        <span className="report-file">{asset.file}</span>
        <div className="report-detail-line">
          <span className="report-fmt">{getAssetKindLabel(asset.kind)}</span>
          <span className={`report-reason ${asset.exists ? "report-reason--good" : "report-reason--danger"}`}>
            {asset.exists ? reportPresentLabel : reportMissingLabel}
          </span>
          <span className="report-detail-text">{getAssetKindTitle(asset.kind)}</span>
        </div>
      </div>
    </div>
  );

  const openDetailedReport = async () => {
    setActiveTab("assets");
    setIsReportOpen(true);
    try {
      await invoke("maximize_main_window");
    } catch {
      // ignore window resize issues and still show the report
    }
  };

  const closeDetailedReport = async () => {
    setIsReportOpen(false);
    try {
      await invoke("restore_main_window");
    } catch {
      // ignore window resize issues on close
    }
  };

  const renderReportInspector = (
    report: ReportItem[],
    referencedAssets: ReferencedAsset[],
    breakdown: ReportBreakdown,
    assetBreakdown: ReferencedAssetBreakdown,
    options: {
      title: string;
      output?: string;
      hint?: string;
      savedBytes: number;
      converted: number;
      deleted: number;
      replacedFiles?: number;
    }
  ) => {
    const visibleItems = activeTab === "assets"
      ? referencedAssets
      : getReportItemsForTab(report, activeTab);

    return (
      <div className="report-inspector">
        <div className="result-summary batch-summary batch-summary--detail report-animate">
          <div className="result-hero">
            <span className="result-hero-label">{t.saved}</span>
            <span className="result-hero-value">{formatBytes(options.savedBytes)}</span>
          </div>
          <div className="result-stats">
            <div className="stat">
              <span className="stat-value stat-value--teal">{options.converted}</span>
              <span className="stat-label">{t.compressed}</span>
            </div>
            <div className="stat-divider" />
            <div className="stat">
              <span className="stat-value stat-value--red">{options.deleted}</span>
              <span className="stat-label">{t.deleted}</span>
            </div>
            <div className="stat-divider" />
            <div className="stat">
              <span className="stat-value">{options.replacedFiles ?? 0}</span>
              <span className="stat-label">{t.filesUpdated}</span>
            </div>
          </div>
        </div>

        <div className="report-hero-grid">
          <section className="report-panel report-panel--overview report-animate report-animate--delay-1">
            <div className="report-panel-head">
              <span className="report-panel-eyebrow">{reportOverviewLabel}</span>
              <span className="report-detail-title">{options.title}</span>
            </div>
            {options.output && <p className="review-callout-path">{options.output}</p>}
            <p className="review-callout-hint">{options.hint ?? reportDetailHint}</p>
            {renderOverviewDonut(breakdown)}
          </section>

          <section className="report-panel report-animate report-animate--delay-2">
            <div className="report-panel-head">
              <span className="report-panel-eyebrow">{reportPerformanceLabel}</span>
              <span className="report-detail-title">{locale === "ru" ? "\u041e\u0448\u0438\u0431\u043a\u0438 \u0438 \u043f\u0440\u0438\u0447\u0438\u043d\u044b" : "Errors and reasons"}</span>
            </div>
            {renderReportDistribution(report, breakdown)}
          </section>

          <section className="report-panel report-panel--coverage report-animate report-animate--delay-3">
            <div className="report-panel-head">
              <span className="report-panel-eyebrow">{reportCoverageLabel}</span>
              <span className="report-detail-title">{reportAssetsLabel}</span>
            </div>
            <p className="review-callout-hint">{reportAssetsHint}</p>
            <div className="report-coverage-meta">
              <span>{assetBreakdown.total}</span>
              <span>{reportPresentLabel}: {assetBreakdown.present}</span>
              <span>{reportMissingLabel}: {assetBreakdown.missing}</span>
            </div>
            {renderCoverageDistribution(assetBreakdown)}
            {renderReferencedAssetSummary(assetBreakdown)}
          </section>
        </div>

        <div className="report-tabs report-tabs--spacious report-animate report-animate--delay-4">
          {(["assets", "converted", "deleted", "errors"] as const).map((tab) => (
            <button key={tab} className={`report-tab ${activeTab === tab ? "report-tab--active" : ""}`} onClick={() => setActiveTab(tab)}>
              {getTabLabel(tab)} <span className="tab-count">{getTabCount(report, referencedAssets, tab)}</span>
            </button>
          ))}
        </div>

        <div
          key={`report-list-${options.title}-${activeTab}`}
          className="report-list report-list--inspector report-animate report-animate--delay-5 report-list-enter"
        >
          {activeTab === "assets"
            ? (visibleItems as ReferencedAsset[]).map((asset, index) => renderReferencedAssetItem(asset, `asset-${options.title}-${index}`))
            : (visibleItems as ReportItem[]).map((item, index) => renderReportItem(item, `inspector-${options.title}-${activeTab}-${index}`))}
          {visibleItems.length === 0 && (
            <div className="report-empty">{t.emptyTab}</div>
          )}
        </div>
      </div>
    );
  };
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
          <span className="header-version">v0.6.0</span>
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
                  <div className="dropzone-icon">{inputMode === "zip" ? "↓" : "⌂"}</div>
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
                <button
                  className={`icon-action-btn ${batchPaused ? "icon-action-btn--paused" : ""}`}
                  onClick={() => void toggleBatchPause()}
                  aria-label={batchPaused ? resumeLabel : pauseLabel}
                  title={batchPaused ? resumeLabel : pauseLabel}
                >
                  <span className="icon-action-btn-core">
                    {batchPaused ? (
                      <svg viewBox="0 0 24 24" className="icon-action-svg" aria-hidden="true">
                        <path d="M9 7.5L16 12l-7 4.5z" fill="currentColor" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="icon-action-svg" aria-hidden="true">
                        <rect x="8" y="7" width="2.75" height="10" rx="1" fill="currentColor" />
                        <rect x="13.25" y="7" width="2.75" height="10" rx="1" fill="currentColor" />
                      </svg>
                    )}
                  </span>
                </button>
              )}
              {isBusyPhase && (
                <button
                  className="icon-action-btn icon-action-btn--danger"
                  onClick={() => void stopActiveWork()}
                  aria-label={stopLabel}
                  title={stopLabel}
                >
                  <span className="icon-action-btn-core">
                    <svg viewBox="0 0 24 24" className="icon-action-svg" aria-hidden="true">
                      <rect x="8" y="8" width="8" height="8" rx="1.6" fill="currentColor" />
                    </svg>
                  </span>
                </button>
              )}
            </div>

            {phase === "batching" && batchPaused && (
              <div className="pause-banner">{pausedStateLabel}</div>
            )}

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
                    <span className="floating-file-icon">•</span>
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
              <span className="review-callout-icon">✦</span>
              <div className="review-callout-body">
                <p className="review-callout-title">{t.reviewTitle}</p>
                <p className="review-callout-path">{workDir}</p>
                <p className="review-callout-hint">{t.reviewHint}</p>
              </div>
            </div>

            <div className="report-shortcut-card">
              <div className="report-shortcut-copy">
                <span className="report-shortcut-eyebrow">{reportOverviewLabel}</span>
                <h3 className="report-shortcut-title">{reportTitle}</h3>
                <p className="report-shortcut-text">{reportDetailHint}</p>
              </div>
              <button className="btn-primary" onClick={() => void openDetailedReport()}>{openReportLabel}</button>
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
            <div className="actions actions--center">
              <button className="btn-primary" onClick={() => void openDetailedReport()}>{openReportLabel}</button>
              <button className="btn-ghost" onClick={() => void reset()}>{t.optimizeAnother}</button>
            </div>
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
            <div className="report-shortcut-card report-shortcut-card--batch">
              <div className="report-shortcut-copy">
                <span className="report-shortcut-eyebrow">{reportSiteLabel}</span>
                <h3 className="report-shortcut-title">{batchResults.length} {locale === "ru" ? "\u0441\u0430\u0439\u0442\u043e\u0432 \u0432 \u043e\u0442\u0447\u0435\u0442\u0435" : "sites in report"}</h3>
                <p className="report-shortcut-text">{reportDetailHint}</p>
              </div>
              <button className="btn-primary" onClick={() => void openDetailedReport()}>{openReportLabel}</button>
            </div>
            {autoCloseSeconds !== null && <p className="done-hint done-hint--countdown">{autoCloseHint}</p>}
            <div className="actions actions--center">
              <button className="btn-ghost" onClick={() => void reset()}>{t.optimizeAnother}</button>
            </div>
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
        {isReportOpen && (phase === "reviewing" || phase === "done" || phase === "batchDone") && (
          <div className="modal-backdrop" onClick={() => void closeDetailedReport()}>
            <div className="modal-card modal-card--report" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <h3>{reportTitle}</h3>
                <button type="button" className="modal-close" onClick={() => void closeDetailedReport()}>×</button>
              </div>

              {phase === "reviewing" && result && renderReportInspector(result.report, result.referencedAssets ?? [], reviewBreakdown, reviewReferencedBreakdown, {
                title: inputPath ?? (locale === "ru" ? "Текущий сайт" : "Current site"),
                output: workDir ?? undefined,
                savedBytes: result.savedBytes,
                converted: result.converted,
                deleted: result.deleted,
                replacedFiles: result.replacedFiles
              })}

              {phase === "done" && result && renderReportInspector(result.report, result.referencedAssets ?? [], reviewBreakdown, reviewReferencedBreakdown, {
                title: inputPath ?? (locale === "ru" ? "Текущий сайт" : "Current site"),
                output: outputPath ?? undefined,
                savedBytes: result.savedBytes,
                converted: result.converted,
                deleted: result.deleted,
                replacedFiles: result.replacedFiles
              })}

              {phase === "batchDone" && (
                <div className="report-modal-layout">
                  <div className="report-modal-sites">
                    <div className="report-detail-title">{reportSiteLabel}</div>
                    <div className="report-list report-list--compact">
                      {batchResults.map((item, index) => (
                        <button
                          type="button"
                          key={`report-modal-${item.input}-${index}`}
                          className={`report-item report-item--button ${item.success ? "" : "report-item--error"} ${activeBatchIndex === index ? "report-item--active" : ""}`}
                          onClick={() => setActiveBatchIndex(index)}
                        >
                          <span className="report-file">{item.input}</span>
                          <span className="report-meta">
                            {item.success
                              ? `${formatBytes(item.savedBytes ?? 0)} · ${item.converted ?? 0} / ${item.deleted ?? 0}`
                              : (item.error ?? "Error")}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {activeBatchItem && renderReportInspector(activeBatchItem.report ?? [], activeBatchItem.referencedAssets ?? [], activeBatchBreakdown, activeBatchReferencedBreakdown, {
                    title: activeBatchItem.input,
                    output: activeBatchItem.output,
                    hint: activeBatchItem.success ? undefined : activeBatchItem.error,
                    savedBytes: activeBatchItem.savedBytes ?? 0,
                    converted: activeBatchItem.converted ?? 0,
                    deleted: activeBatchItem.deleted ?? 0,
                    replacedFiles: activeBatchItem.replacedFiles
                  })}
                </div>
              )}

              <div className="modal-actions">
                <button className="btn-primary" onClick={() => void closeDetailedReport()}>
                  {reportCloseLabel}
                </button>
              </div>
            </div>
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
                <button type="button" className="modal-close" onClick={() => { if (!isInstallingUpdate) { setUpdateInfo(null); setUpdateProgress(null); } }}>×</button>
              </div>

              <div className="modal-section">
                <div className="update-version-line">
                  {updateInfo.current_version} {"->"} {updateInfo.version}
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
                        <span>{locale === "ru" ? "Еще немного..." : "Almost there..."}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button className="btn-primary" disabled={isInstallingUpdate} onClick={() => void installUpdate()}>
                  {isInstallingUpdate ? (locale === "ru" ? "Обновляем..." : "Updating...") : updateNowLabel}
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



