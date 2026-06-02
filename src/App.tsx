import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import "./styles.css";
import "./styles-screens.css";
import { Icon } from "./components/Icons";
import { WorkerPool } from "./components/WorkerPool";
import { TitleBar } from "./components/TitleBar";
import { NumberStepper } from "./components/NumberStepper";

type InputMode = "zip" | "folder";
type ExportMode = "zip" | "folder";
type Phase = "idle" | "preparing" | "running" | "reviewing" | "exporting" | "done" | "error" | "batching" | "batchDone";
type ReportTab = "assets" | "converted" | "deleted" | "errors";
type Locale = "ru" | "en";

type ReportReason =
  | "optimized"
  | "existing-webp"
  | "unused"
  | "duplicate"
  | "manual"
  | "dynamic"
  | "skipped"
  | "larger-than-source"
  | "ffmpeg-missing"
  | "error";

interface ReportItem {
  type: "converted" | "deleted" | "error";
  reason?: ReportReason;
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

// Real per-worker (pool lane) state, driven by sidecar "worker" events.
interface LaneState {
  id: number;
  file: string;
  kind: string;
  /** real intra-file percent (videos); for images it stays 0 while active */
  pct: number;
  /** files this lane has finished */
  filesDone: number;
  active: boolean;
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
  // Prefer the machine-readable reason emitted by the sidecar; fall back to the
  // record type only for forward-compatibility with older payloads.
  const reason: ReportReason = item.reason
    ?? (item.type === "converted" ? "optimized" : item.type === "deleted" ? "manual" : "error");

  switch (reason) {
    case "optimized":
      return { label: locale === "ru" ? "Оптимизировано" : "Optimized", tone: "good" };
    case "existing-webp":
      return { label: locale === "ru" ? "Готовый WEBP" : "Existing WEBP", tone: "warn" };
    case "unused":
      return { label: locale === "ru" ? "Не используется" : "Unused", tone: "warn" };
    case "duplicate":
      return { label: locale === "ru" ? "Дубликат" : "Duplicate", tone: "warn" };
    case "manual":
      return { label: locale === "ru" ? "Удалено вручную" : "Manual delete", tone: "warn" };
    case "dynamic":
      return { label: locale === "ru" ? "Динамическая ссылка" : "Dynamic link", tone: "danger" };
    case "skipped":
      return { label: locale === "ru" ? "Пропущено" : "Skipped", tone: "warn" };
    case "larger-than-source":
      return { label: locale === "ru" ? "Больше оригинала" : "Larger than source", tone: "warn" };
    case "ffmpeg-missing":
      return { label: locale === "ru" ? "ffmpeg не найден" : "ffmpeg missing", tone: "danger" };
    default:
      return { label: locale === "ru" ? "Ошибка" : "Error", tone: "danger" };
  }
}

function getReportBreakdown(report: ReportItem[]): ReportBreakdown {
  return report.reduce<ReportBreakdown>((summary, item) => {
    const reason: ReportReason = item.reason
      ?? (item.type === "converted" ? "optimized" : item.type === "deleted" ? "manual" : "error");

    switch (reason) {
      case "optimized":
        summary.converted += 1;
        break;
      case "existing-webp":
        summary.deleted += 1;
        summary.duplicates += 1;
        break;
      case "duplicate":
        summary.deleted += 1;
        summary.duplicates += 1;
        break;
      case "unused":
        summary.deleted += 1;
        summary.unused += 1;
        break;
      case "manual":
        summary.deleted += 1;
        summary.manual += 1;
        break;
      case "dynamic":
        summary.dynamic += 1;
        break;
      case "skipped":
      case "larger-than-source":
        summary.skipped += 1;
        break;
      default:
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
  const [lanes, setLanes] = useState<LaneState[]>([]);
  const [result, setResult] = useState<DonePayload | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<ReportTab>("assets");
  const [reportSearch, setReportSearch] = useState("");
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
  const [strictBudgetEnabled, setStrictBudgetEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("site-optimizer-strict-budget-enabled") === "true";
  });
  const [strictBudgetMb, setStrictBudgetMb] = useState<number>(() => {
    if (typeof window === "undefined") return 20;
    const saved = Number(window.localStorage.getItem("site-optimizer-strict-budget-mb") ?? "20");
    if (!Number.isFinite(saved) || saved <= 0) return 20;
    return Math.min(2048, Math.max(1, Math.round(saved)));
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
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return window.localStorage.getItem("site-optimizer-theme") === "dark" ? "dark" : "light";
  });
  const unlisten = useRef<(() => void) | null>(null);
  const floatCounter = useRef(0);
  const languageSwitcherRef = useRef<HTMLDivElement | null>(null);
  const batchPausedRef = useRef(false);
  const phaseRef = useRef<Phase>(phase);
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
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem("site-optimizer-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback((event: React.MouseEvent) => {
    const next = theme === "dark" ? "light" : "dark";
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const startViewTransition = (document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }).startViewTransition;
    if (!startViewTransition || reduce) {
      setTheme(next);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const vt = startViewTransition.call(document, () => {
      document.documentElement.setAttribute("data-theme", next);
    });
    setTheme(next);
    vt.ready.then(() => {
      const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 620, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" }
      );
    });
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("site-optimizer-remove-unused", String(removeUnused));
  }, [removeUnused]);

  useEffect(() => {
    window.localStorage.setItem("site-optimizer-dedupe-images", String(dedupeImages));
  }, [dedupeImages]);
  useEffect(() => {
    window.localStorage.setItem("site-optimizer-strict-budget-enabled", String(strictBudgetEnabled));
  }, [strictBudgetEnabled]);
  useEffect(() => {
    const normalized = Number.isFinite(strictBudgetMb) ? Math.min(2048, Math.max(1, Math.round(strictBudgetMb))) : 20;
    window.localStorage.setItem("site-optimizer-strict-budget-mb", String(normalized));
  }, [strictBudgetMb]);

  useEffect(() => {
    batchPausedRef.current = batchPaused;
  }, [batchPaused]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

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
        const activePhase = phaseRef.current;
        const busy = activePhase === "preparing" || activePhase === "running" || activePhase === "exporting" || activePhase === "batching";

        if (!busy) {
          void quitApp();
          return;
        }

        if (activePhase === "batching") {
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
    // Register launch/close/update listeners and run startup detection once on
    // mount. `phase` is intentionally excluded: the close handler reads the
    // live value via phaseRef, so this effect must not re-run (and re-subscribe
    // / re-run startup quick-launch) on every phase change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkForUpdates, hideMainWindow, quitApp, showMainWindow]);

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
  const strictBudgetLabel = locale === "ru"
    ? "\u041f\u0440\u0438\u043c\u0435\u043d\u0438\u0442\u044c \u0441\u0442\u0440\u043e\u0433\u0438\u0435 \u043e\u0433\u0440\u0430\u043d\u0438\u0447\u0435\u043d\u0438\u044f \u043f\u043e \u0432\u0435\u0441\u0443"
    : "Apply strict size limits";
  const strictBudgetHint = locale === "ru"
    ? "\u0415\u0441\u043b\u0438 \u043f\u0430\u043a\u0435\u0442 \u043c\u0435\u0434\u0438\u0430 \u0432\u044b\u0448\u0435 \u043b\u0438\u043c\u0438\u0442\u0430, \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442 \u0434\u043e\u043f. \u0430\u0433\u0440\u0435\u0441\u0441\u0438\u0432\u043d\u0443\u044e \u043e\u043f\u0442\u0438\u043c\u0438\u0437\u0430\u0446\u0438\u044e \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0439 \u0438 \u0432\u0438\u0434\u0435\u043e."
    : "If media total is above the limit, extra aggressive image/video compression will be applied.";
  const strictBudgetInputLabel = locale === "ru" ? "\u041b\u0438\u043c\u0438\u0442 (MB)" : "Limit (MB)";
  const strictBudgetMbSafe = Number.isFinite(strictBudgetMb) ? Math.min(2048, Math.max(1, Math.round(strictBudgetMb))) : 20;
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
      dedupeImages,
      strictLimitMb: strictBudgetEnabled ? strictBudgetMbSafe : null
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
    setLanes([]);
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
        dedupeImages,
        strictLimitMb: strictBudgetEnabled ? strictBudgetMbSafe : null
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
          case "pool":
            setLanes(Array.from({ length: Math.max(1, data.lanes) }, (_, i) => ({
              id: i, file: "", kind: "", pct: 0, filesDone: 0, active: false,
            })));
            break;
          case "worker":
            setLanes((prev) => {
              if (prev.length === 0) return prev;
              return prev.map((lane) => lane.id !== data.id ? lane : {
                id: data.id,
                file: data.file ?? lane.file,
                kind: data.kind ?? lane.kind,
                pct: data.state === "done" ? 100 : (data.pct ?? lane.pct),
                filesDone: data.state === "done" ? (data.filesDone ?? lane.filesDone) : lane.filesDone,
                active: data.state !== "done",
              });
            });
            break;
          case "progress":
            setProgress((state) => ({ ...state, done: data.done, total: data.total, percent: data.percent }));
            if (data.file) spawnFloatingFile(data.file);
            break;
          case "done":
            setResult(data as DonePayload);
            setPhase("reviewing");
            setFloatingFiles([]);
            setLanes([]);
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
            setLanes([]);
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
        dedupeImages,
        strictLimitMb: strictBudgetEnabled ? strictBudgetMbSafe : null
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
    setLanes([]);
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
  // visible worker count — bound to host concurrency (ready to swap for a real value)
  const workerThreads = Math.max(2, Math.min(8, (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4));
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

  const renderReportTwoPane = (
    report: ReportItem[],
    referencedAssets: ReferencedAsset[],
    breakdown: ReportBreakdown,
    assetBreakdown: ReferencedAssetBreakdown,
    options: { title: string; output?: string; savedBytes: number; converted: number }
  ) => {
    const ru = locale === "ru";
    const kindClass = (k: string) => (k === "font" ? "fnt" : k === "style" ? "css" : k === "script" ? "js" : "img");
    const kindIcon = (k: string) => (k === "font" ? Icon.type : k === "style" ? Icon.code : k === "script" ? Icon.brace : Icon.image);
    const kindLabel = (k: string) => {
      const ruMap: Record<string, string> = { image: "Изображения", font: "Шрифты", style: "Стили", script: "Скрипты", video: "Видео", other: "Прочее" };
      const enMap: Record<string, string> = { image: "Images", font: "Fonts", style: "Styles", script: "Scripts", video: "Video", other: "Other" };
      return (ru ? ruMap : enMap)[k] ?? k;
    };
    const extKind = (file: string) => {
      const e = (file.split(".").pop() || "").toLowerCase();
      if (["webp", "png", "jpg", "jpeg", "svg", "gif", "avif"].includes(e)) return "image";
      if (["woff2", "woff", "ttf", "otf"].includes(e)) return "font";
      if (e === "css") return "style";
      if (e === "js") return "script";
      if (["mp4", "webm", "mov"].includes(e)) return "video";
      return "other";
    };

    const q = reportSearch.trim().toLowerCase();
    const matches = (s: string) => !q || s.toLowerCase().includes(q);
    const deletedItems = report.filter((r) => r.type === "deleted" && matches(r.file));
    const errorItems = report.filter((r) => r.type === "error" && matches(r.file));
    const assetItems = referencedAssets.filter((a) => matches(a.file));

    const tab = activeTab === "deleted" || activeTab === "errors" ? activeTab : "assets";
    const total = assetBreakdown.present + assetBreakdown.missing;
    const pct = total > 0 ? Math.round((assetBreakdown.present / total) * 100) : 0;
    const R = 52, C = 2 * Math.PI * R, GAP = 7;
    const mLen = total > 0 ? (assetBreakdown.present / total) * C - GAP : 0;
    const dLen = total > 0 ? (assetBreakdown.missing / total) * C - GAP : 0;

    const cats = [
      { l: kindLabel("image"), n: assetBreakdown.image, ic: Icon.image },
      { l: kindLabel("font"), n: assetBreakdown.font, ic: Icon.type },
      { l: kindLabel("style"), n: assetBreakdown.style, ic: Icon.code },
      { l: kindLabel("script"), n: assetBreakdown.script, ic: Icon.brace },
    ];
    const tabs: Array<[ReportTab, string, (p: { size?: number }) => JSX.Element, number]> = [
      ["assets", ru ? "Найдено в коде" : "Found in code", Icon.check, assetBreakdown.total],
      ["deleted", ru ? "Удалено" : "Removed", Icon.trash, breakdown.deleted],
      ["errors", ru ? "Ошибки" : "Errors", Icon.alert, breakdown.errors],
    ];
    const baseName = options.title.split(/[\\/]/).pop() ?? options.title;

    return (
      <div className="report-layout">
        <aside className="report-rail">
          <div className="eyebrow">{ru ? "Отчёт об оптимизации" : "Optimization report"}</div>

          <div className="hero-metric">
            <div className="hm-val"><span className="num">{formatBytes(options.savedBytes)}</span></div>
            <div className="hm-row"><span className="hm-lab">{ru ? "сэкономлено" : "saved"}</span></div>
          </div>

          <div className="path-chip">
            {Icon.folder({ size: 14 })}
            <span className="mono">{baseName}</span>
          </div>

          <div className="cov-block">
            <div className="cov-donut">
              <svg width="124" height="124" viewBox="0 0 124 124">
                <circle cx="62" cy="62" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="11" />
                {total > 0 && (
                  <>
                    <circle cx="62" cy="62" r={R} fill="none" stroke="var(--donut-on)" strokeWidth="11" strokeLinecap="round"
                      strokeDasharray={`${Math.max(0, mLen)} ${C - Math.max(0, mLen)}`} strokeDashoffset="0" />
                    <circle cx="62" cy="62" r={R} fill="none" stroke="var(--donut-off)" strokeWidth="11" strokeLinecap="round"
                      strokeDasharray={`${Math.max(0, dLen)} ${C - Math.max(0, dLen)}`} strokeDashoffset={-(Math.max(0, mLen) + GAP)} />
                  </>
                )}
              </svg>
              <div className="cov-center">
                <div className="p">{pct}<span>%</span></div>
                <div className="l">{ru ? "покрытие" : "coverage"}</div>
              </div>
            </div>
            <div className="cov-legend">
              <div className="cl-item"><span className="dot" style={{ background: "var(--donut-on)" }} />
                <span className="cl-l">{reportPresentLabel}</span><span className="cl-v">{assetBreakdown.present}</span></div>
              <div className="cl-item"><span className="dot" style={{ background: "var(--donut-off)" }} />
                <span className="cl-l">{reportMissingLabel}</span><span className="cl-v">{assetBreakdown.missing}</span></div>
            </div>
          </div>

          <div className="rail-stats">
            <div className="rs"><div className="rs-n">{report.length}</div><div className="rs-l">{ru ? "Обработано" : "Processed"}</div></div>
            <div className="rs"><div className="rs-n red">{breakdown.deleted}</div><div className="rs-l">{t.deleted}</div></div>
            <div className="rs"><div className="rs-n">{options.converted}</div><div className="rs-l">{t.compressed}</div></div>
            <div className="rs"><div className="rs-n">{breakdown.errors}</div><div className="rs-l">{t.tabErrors}</div></div>
          </div>
        </aside>

        <section className="report-main">
          <div className="rm-head">
            <h2>{reportTitle}</h2>
            <div className="search">
              {Icon.search({ size: 15 })}
              <input value={reportSearch} onChange={(e) => setReportSearch(e.target.value)} placeholder={ru ? "Найти файл…" : "Find file…"} />
            </div>
          </div>

          <div className="cat-strip">
            {cats.map((c) => (
              <div className="cat-card" key={c.l}>
                <span className="cat-ic">{c.ic({ size: 15 })}</span>
                <span className="cat-n">{c.n}</span>
                <span className="cat-l">{c.l}</span>
              </div>
            ))}
          </div>

          <div className="rtabs">
            {tabs.map(([key, label, ic, count]) => (
              <button key={key} className={`rtab ${tab === key ? "on" : ""}`} onClick={() => { setActiveTab(key); }}>
                {ic({ size: 14 })}{label}<span className="badge">{count}</span>
              </button>
            ))}
          </div>

          <div className="flist" key={`${options.title}-${tab}-${q}`}>
            {tab === "assets" && (assetItems.length === 0 ? (
              <div className="empty-list"><span className="el-ic">{Icon.check({ size: 22 })}</span>{q ? (ru ? "Ничего не найдено по запросу" : "No matches") : (ru ? "Здесь пока ничего нет" : "Nothing here yet")}</div>
            ) : assetItems.map((a, i) => (
              <div className="frow" key={`a-${i}`}>
                <span className={`ftype ${kindClass(a.kind)}`}>{kindIcon(a.kind)({ size: 15 })}</span>
                <span className="fmeta"><span className="fname">{a.file}</span><span className="fcat">{kindLabel(a.kind)}</span></span>
                <span className={`fstatus ${a.exists ? "found" : "missing"}`}><span className="sd" />{a.exists ? reportPresentLabel : reportMissingLabel}</span>
              </div>
            )))}

            {tab === "deleted" && (deletedItems.length === 0 ? (
              <div className="empty-list"><span className="el-ic">{Icon.check({ size: 22 })}</span>{q ? (ru ? "Ничего не найдено по запросу" : "No matches") : t.emptyTab}</div>
            ) : deletedItems.map((item, i) => (
              <div className="frow" key={`d-${i}`}>
                <span className={`ftype ${kindClass(extKind(item.file))}`}>{kindIcon(extKind(item.file))({ size: 15 })}</span>
                <span className="fmeta"><span className="fname">{item.file}</span><span className="fcat">{getReportReasonInfo(item, locale).label}</span></span>
                <span className="fstatus found"><span className="sd" />{ru ? "удалено" : "removed"}</span>
              </div>
            )))}

            {tab === "errors" && (errorItems.length === 0 ? (
              <div className="empty-list"><span className="el-ic">{Icon.check({ size: 22 })}</span>{q ? (ru ? "Ничего не найдено по запросу" : "No matches") : (ru ? "Ошибок нет — всё чисто" : "No errors — all clean")}</div>
            ) : errorItems.map((item, i) => (
              <div className="frow" key={`e-${i}`}>
                <span className={`ftype ${kindClass(extKind(item.file))}`}>{kindIcon(extKind(item.file))({ size: 15 })}</span>
                <span className="fmeta"><span className="fname">{item.file}</span><span className="fcat">{item.message ?? getReportReasonInfo(item, locale).label}</span></span>
                <span className="fstatus missing"><span className="sd" />{ru ? "ошибка" : "error"}</span>
              </div>
            )))}
          </div>
        </section>
      </div>
    );
  };

  return (
    <div className="win">
      <TitleBar />
      <div className="topbar">
        <div className="topbar-left">
          <div className="lang-wrap" ref={languageSwitcherRef}>
            <button
              type="button"
              className={`lang-pill ${isLanguageOpen ? "open" : ""}`}
              onClick={() => setIsLanguageOpen((open) => !open)}
              aria-haspopup="listbox"
              aria-expanded={isLanguageOpen}
            >
              {Icon.globe({ size: 15 })}
              <span className="code">{locale.toUpperCase()}</span>
              <span className="chev">{Icon.chevron({ size: 14 })}</span>
            </button>

            {isLanguageOpen && (
              <div className="lang-menu" role="listbox" aria-label={t.languageLabel}>
                <div className="lang-menu-head">{t.languageLabel}</div>
                {(["ru", "en"] as const).map((code) => (
                  <button
                    key={code}
                    type="button"
                    className={`lang-opt ${locale === code ? "on" : ""}`}
                    onClick={() => {
                      setLocale(code);
                      setIsLanguageOpen(false);
                    }}
                  >
                    <span className="badge">{code.toUpperCase()}</span>
                    <span className="txt">
                      <span className="l1">{code === "ru" ? translations.ru.languageNative : translations.en.languageEnglish}</span>
                      <span className="l2">{code === "ru" ? "Russian" : "English"}</span>
                    </span>
                    {locale === code && <span className="tick">{Icon.check({ size: 14, sw: 2.4 })}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="stepper">
          {t.steps.map((step, index) => (
            <div key={step} style={{ display: "contents" }}>
              {index > 0 && <span className="step-sep" />}
              <button
                type="button"
                className={`step ${currentStep === index ? "active" : ""} ${currentStep > index ? "done" : ""}`}
                disabled
              >
                <span className="dot">{currentStep > index ? Icon.check({ size: 11, sw: 2.6 }) : index + 1}</span>
                <span className="label">{step}</span>
              </button>
            </div>
          ))}
        </div>

        <div className="topbar-right">
          <div className="tr-controls">
            <button
              type="button"
              className={`theme-toggle ${theme === "dark" ? "is-dark" : ""}`}
              onClick={toggleTheme}
              aria-label="Toggle theme"
            >
              <span className="tt-orb">
                <span className="tt-ic sun">{Icon.sun({ size: 16 })}</span>
                <span className="tt-ic moon">{Icon.moon({ size: 15 })}</span>
              </span>
            </button>
            <button className="icon-btn" type="button" onClick={() => setIsSettingsOpen(true)} aria-label={settingsTitle}>
              {Icon.gear({ size: 17 })}
            </button>
          </div>
          <div className="ver-wrap">
            <button type="button" className="ver-btn" disabled>
              <span className="ver-dot" />
              <span className="ver-num">v{__APP_VERSION__}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="stage">
        {phase === "idle" && (
          <div className="screen">
          <div className="screen-inner">
            <div className="src-tabs">
              <button
                type="button"
                className={`src-tab ${inputMode === "zip" ? "on" : ""}`}
                onClick={() => { setInputMode("zip"); setInputPath(null); }}
              >
                {Icon.zip({ size: 15 })} {t.inputZip}
              </button>
              <button
                type="button"
                className={`src-tab ${inputMode === "folder" ? "on" : ""}`}
                onClick={() => { setInputMode("folder"); setInputPath(null); }}
              >
                {Icon.folder({ size: 15 })} {t.inputFolder}
              </button>
            </div>

            <div className={`dropzone ${isDragging ? "drag" : ""} ${inputPath ? "filled" : ""}`} onClick={!inputPath ? pickInput : undefined}>
              {!inputPath ? (
                <>
                  <div className="dz-arrow">{Icon.arrowDown({ size: 22 })}</div>
                  <div className="dz-title">{inputMode === "zip" ? t.dropZip : t.dropFolder}</div>
                  <div className="dz-sub">{inputMode === "zip" ? t.browseZip : t.browseFolder}</div>
                </>
              ) : (
                <>
                  <div className="dz-check">{Icon.check({ size: 30 })}</div>
                  <div className="dz-file">{inputPath}</div>
                  <button className="btn btn-ghost" onClick={(event) => { event.stopPropagation(); setInputPath(null); }}>
                    {Icon.edit({ size: 15 })} {inputMode === "zip" ? t.changeFile : t.changeFolder}
                  </button>
                </>
              )}
            </div>

            <div className="card cleanup-card">
              <div className="eyebrow section-label">{extraCleanupTitle}</div>

              <div className="check-row" onClick={() => setRemoveUnused(!removeUnused)} style={{ cursor: "pointer" }}>
                <div className={`checkbox ${removeUnused ? "on" : ""}`}>{Icon.check({ size: 13, sw: 2.6 })}</div>
                <div className="check-txt">
                  <div className="t">{removeUnusedLabel}</div>
                  <div className="d">{removeUnusedHint}</div>
                </div>
              </div>

              <div className="check-row" onClick={() => setDedupeImages(!dedupeImages)} style={{ cursor: "pointer" }}>
                <div className={`checkbox ${dedupeImages ? "on" : ""}`}>{Icon.check({ size: 13, sw: 2.6 })}</div>
                <div className="check-txt">
                  <div className="t">{dedupeLabel}</div>
                  <div className="d">{dedupeHint}</div>
                </div>
              </div>

              <div className="check-row" onClick={() => setStrictBudgetEnabled(!strictBudgetEnabled)} style={{ cursor: "pointer" }}>
                <div className={`checkbox ${strictBudgetEnabled ? "on" : ""}`}>{Icon.check({ size: 13, sw: 2.6 })}</div>
                <div className="check-txt">
                  <div className="t">{strictBudgetLabel}</div>
                  <div className="d">{strictBudgetHint}</div>
                </div>
              </div>

              {strictBudgetEnabled && (
                <div className="check-row" style={{ alignItems: "center", paddingLeft: 33 }}>
                  <span className="cap-mono" style={{ color: "var(--text-dim)" }}>{strictBudgetInputLabel}</span>
                  <NumberStepper
                    value={strictBudgetMbSafe}
                    min={1}
                    max={2048}
                    step={1}
                    aria-label={strictBudgetInputLabel}
                    onChange={(next) => setStrictBudgetMb(Math.min(2048, Math.max(1, Math.round(next))))}
                  />
                </div>
              )}
            </div>

            <div className="actions">
              <button className="btn btn-primary btn-uppercase" disabled={!inputPath} onClick={runAll}>
                {inputMode === "zip" ? t.runZip : t.runFolder}
              </button>
              <button className="btn btn-ghost" onClick={runQuickBatch}>
                {quickOptimizeLabel}
              </button>
            </div>
          </div>
          </div>
        )}

        {(phase === "preparing" || phase === "running" || phase === "exporting" || phase === "batching") && (
          <div className="screen">
          <div className="screen-inner">
            {(phase === "running" || phase === "batching") ? (
              <>
                <div className="opt-head">
                  <div className="opt-status">{progress.status || (phase === "batching" ? quickOptimizeLabel : t.phaseRunning)}</div>
                  <div className="opt-pct">{Math.floor(progress.percent)}<span style={{ fontSize: 16, color: "var(--text-faint)" }}>%</span></div>
                </div>
                <div className="opt-bar">
                  <i style={{ width: `${progress.percent}%` }} />
                </div>
                <WorkerPool
                  percent={progress.percent}
                  done={progress.done}
                  total={progress.total}
                  recentFiles={[...floatingFiles.map((f) => f.name), ...(currentFile ? [currentFile] : [])]}
                  threads={lanes.length || workerThreads}
                  lanes={lanes.length ? lanes : undefined}
                  running={!batchPaused}
                  locale={locale}
                />
              </>
            ) : (
              <>
                <div className="eyebrow section-label" style={{ marginTop: 4 }}>
                  {phase === "preparing" && (inputMode === "zip" ? t.phasePreparingZip : t.phasePreparingFolder)}
                  {phase === "exporting" && (exportMode === "zip" ? t.phaseExportZip : t.phaseExportFolder)}
                </div>
                <div className="opt-head">
                  <div className="opt-status">{progress.status || t.optimizerStarting}</div>
                </div>
                <div className="opt-bar">
                  <i style={{ width: "100%" }} />
                </div>
                <div className="canvas-wrap" style={{ display: "grid", placeItems: "center" }}>
                  <div className="mono" style={{ color: "var(--text-faint)", fontSize: 12 }}>{currentFile || progress.status}</div>
                </div>
              </>
            )}

            {phase === "batching" && batchPaused && (
              <div className="pause-banner" style={{ marginTop: 14 }}>{pausedStateLabel}</div>
            )}

            <div className="actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div className="opt-path">{inputPath}</div>
              <div style={{ display: "flex", gap: 10 }}>
                {phase === "batching" && (
                  <button className="cancel-btn" style={{ color: "var(--mint-deep)", borderColor: "var(--mint-line)" }} onClick={() => void toggleBatchPause()}>
                    {batchPaused ? resumeLabel : pauseLabel}
                  </button>
                )}
                {isBusyPhase && (
                  <button className="cancel-btn" onClick={() => void stopActiveWork()}>
                    {Icon.stop({ size: 11 })} {stopLabel}
                  </button>
                )}
              </div>
            </div>
          </div>
          </div>
        )}

        {phase === "reviewing" && result && (
          <div className="screen">
          <div className="screen-inner">
            <div className="card stat-strip">
              <div className="stat">
                <div className="big mint">{formatBytes(result.savedBytes)}</div>
                <div className="meta"><div className="lab">{t.saved}</div></div>
              </div>
              <div className="stat">
                <div className="big">{result.converted}</div>
                <div className="meta"><div className="lab">{t.compressed}</div></div>
              </div>
              <div className="stat">
                <div className="big red">{result.deleted}</div>
                <div className="meta"><div className="lab">{t.deleted}</div></div>
              </div>
              <div className="stat">
                <div className="big">{result.replacedFiles}</div>
                <div className="meta"><div className="lab">{t.filesUpdated}</div></div>
              </div>
            </div>

            <div className="card info-card">
              <div className="ic">{Icon.spark({ size: 20 })}</div>
              <div className="grow">
                <div className="t">{t.reviewTitle}</div>
                <div className="p">{workDir}</div>
                <div className="d">{t.reviewHint}</div>
              </div>
            </div>

            <div className="card report-card">
              <div className="rc-ic">{Icon.doc({ size: 19 })}</div>
              <div className="grow">
                <div className="eyebrow">{reportOverviewLabel}</div>
                <div className="h" style={{ marginTop: 6 }}>{reportTitle}</div>
                <div className="d">{reportDetailHint}</div>
              </div>
              <button className="btn-report" onClick={() => void openDetailedReport()}>
                {openReportLabel} {Icon.arrowRight({ size: 15 })}
              </button>
            </div>

            <div className="card export-card">
              <div className="eyebrow section-label">{t.exportFormat}</div>
              <div className="fmt-list">
                <button
                  type="button"
                  className={`fmt-row ${exportMode === "zip" ? "on" : ""}`}
                  onClick={() => setExportMode("zip")}
                >
                  <span className="fmt-radio" />
                  <span className="fmt-ic">{Icon.zip({ size: 18 })}</span>
                  <span className="fmt-meta">
                    <span className="fmt-t">{t.inputZip}</span>
                    <span className="fmt-p mono">{t.outputZip(`${inputPath?.replace(/(\.[^.]+)?$/, "") ?? "…"}_optimized.zip`)}</span>
                  </span>
                  <span className="fmt-tag mono">.zip</span>
                </button>
                <button
                  type="button"
                  className={`fmt-row ${exportMode === "folder" ? "on" : ""}`}
                  onClick={() => setExportMode("folder")}
                >
                  <span className="fmt-radio" />
                  <span className="fmt-ic">{Icon.folder({ size: 18 })}</span>
                  <span className="fmt-meta">
                    <span className="fmt-t">{t.inputFolder}</span>
                    <span className="fmt-p mono">{t.outputFolder(`${inputPath?.replace(/(\.[^.]+)?$/, "") ?? "…"}_optimized/`)}</span>
                  </span>
                  <span className="fmt-tag mono">dir</span>
                </button>
              </div>
            </div>

            <div className="actions">
              <button className="btn btn-primary btn-uppercase" onClick={doExport}>
                {Icon.download({ size: 16 })} {exportMode === "zip" ? t.exportZip : t.exportFolder}
              </button>
              <button className="btn btn-ghost" onClick={() => void reset()}>{t.cancel}</button>
            </div>
          </div>
          </div>
        )}

        {phase === "done" && (
          <div className="screen">
          <div className="screen-inner">
            <div className="done-wrap">
              <div className="done-ring">{Icon.check({ size: 42, sw: 2 })}</div>
              <div className="done-title">{t.exportDone}</div>
              <div className="done-file">{outputPath}</div>
              <div className="done-sub">{exportMode === "zip" ? t.exportDoneZip : t.exportDoneFolder}</div>

              <button className="btn-report done-report" onClick={() => void openDetailedReport()}>
                {Icon.doc({ size: 15 })} {openReportLabel} {Icon.arrowRight({ size: 14 })}
              </button>

              {autoCloseSeconds !== null && <div className="done-sub">{autoCloseHint}</div>}

              <div className="done-actions">
                <button className="btn btn-ghost" onClick={() => void reset()}>
                  {Icon.refresh({ size: 15 })} {t.optimizeAnother}
                </button>
                <button className="btn btn-orange" onClick={() => void invoke("quit_app")}>
                  {Icon.x({ size: 16, sw: 2.2 })} {settingsClose}
                </button>
              </div>
            </div>
          </div>
          </div>
        )}

        {phase === "batchDone" && (
          <div className="screen">
          <div className="screen-inner">
            <div className="done-wrap" style={{ justifyContent: "flex-start", paddingTop: 24 }}>
              <div className="done-ring">{Icon.check({ size: 42, sw: 2 })}</div>
              <div className="done-title">{quickSummaryTitle}</div>
              <div className="done-sub">{quickSummaryHint}</div>

              <div className="card stat-strip" style={{ marginTop: 24 }}>
                <div className="stat">
                  <div className="big mint">{formatBytes(batchSavedBytes)}</div>
                  <div className="meta"><div className="lab">{t.saved}</div></div>
                </div>
                <div className="stat">
                  <div className="meta"><div className="lab">{locale === "ru" ? "\u0443\u0441\u043f\u0435\u0448\u043d\u043e" : "success"}</div></div>
                </div>
                <div className="stat">
                  <div className="big red">{batchErrorCount}</div>
                  <div className="meta"><div className="lab">{locale === "ru" ? "\u0441 \u043e\u0448\u0438\u0431\u043a\u0430\u043c\u0438" : "with errors"}</div></div>
                </div>
              </div>

              <button className="btn-report done-report" onClick={() => void openDetailedReport()}>
                {Icon.doc({ size: 15 })} {batchResults.length} {locale === "ru" ? "\u0441\u0430\u0439\u0442\u043e\u0432 \u0432 \u043e\u0442\u0447\u0435\u0442\u0435" : "sites in report"} {Icon.arrowRight({ size: 14 })}
              </button>

              {autoCloseSeconds !== null && <div className="done-sub">{autoCloseHint}</div>}

              <div className="done-actions">
                <button className="btn btn-ghost" onClick={() => void reset()}>
                  {Icon.refresh({ size: 15 })} {t.optimizeAnother}
                </button>
              </div>
            </div>
          </div>
          </div>
        )}
        {phase === "error" && (
          <div className="screen">
          <div className="screen-inner">
            <div className="done-wrap">
              <div className="done-ring" style={{ background: "var(--danger-soft)", borderColor: "oklch(0.55 0.17 27 / 0.35)", color: "var(--danger)" }}>
                {Icon.alert({ size: 40 })}
              </div>
              <div className="done-title">{locale === "ru" ? "Что-то пошло не так" : "Something went wrong"}</div>
              <div className="done-sub" style={{ maxWidth: "52ch" }}>{errorMsg}</div>
              {runtimeDebug.length > 0 && (
                <div className="card" style={{ marginTop: 18, padding: "14px 16px", textAlign: "left", maxWidth: 560, width: "100%" }}>
                  <div className="eyebrow section-label">Runtime debug</div>
                  {runtimeDebug.map((line) => (
                    <div key={line} className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)", padding: "2px 0" }}>{line}</div>
                  ))}
                </div>
              )}
              <div className="done-actions">
                <button className="btn btn-ghost" onClick={() => void reset()}>
                  {Icon.refresh({ size: 15 })} {t.tryAgain}
                </button>
              </div>
            </div>
          </div>
          </div>
        )}
        {isReportOpen && (phase === "reviewing" || phase === "done" || phase === "batchDone") && (
          <div className="scrim" onClick={() => void closeDetailedReport()}>
            <div className="modal report-modal" onClick={(event) => event.stopPropagation()}>
              <button type="button" className="x-btn report-x" onClick={() => void closeDetailedReport()}>{Icon.x({ size: 16 })}</button>

              {phase === "reviewing" && result && renderReportTwoPane(result.report, result.referencedAssets ?? [], reviewBreakdown, reviewReferencedBreakdown, {
                title: inputPath ?? (locale === "ru" ? "Текущий сайт" : "Current site"),
                savedBytes: result.savedBytes,
                converted: result.converted
              })}

              {phase === "done" && result && renderReportTwoPane(result.report, result.referencedAssets ?? [], reviewBreakdown, reviewReferencedBreakdown, {
                title: inputPath ?? (locale === "ru" ? "Текущий сайт" : "Current site"),
                savedBytes: result.savedBytes,
                converted: result.converted
              })}

              {phase === "batchDone" && (
                <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                  <div className="rtabs" style={{ padding: "18px 26px 0", flexWrap: "wrap", borderBottom: "none" }}>
                    {batchResults.map((item, index) => (
                      <button
                        type="button"
                        key={`report-site-${item.input}-${index}`}
                        className={`rtab ${activeBatchIndex === index ? "on" : ""}`}
                        onClick={() => setActiveBatchIndex(index)}
                      >
                        {item.success ? Icon.check({ size: 13 }) : Icon.alert({ size: 13 })}
                        {item.input.split(/[\\/]/).pop() ?? item.input}
                      </button>
                    ))}
                  </div>
                  {activeBatchItem && renderReportTwoPane(activeBatchItem.report ?? [], activeBatchItem.referencedAssets ?? [], activeBatchBreakdown, activeBatchReferencedBreakdown, {
                    title: activeBatchItem.input,
                    savedBytes: activeBatchItem.savedBytes ?? 0,
                    converted: activeBatchItem.converted ?? 0
                  })}
                </div>
              )}

              <div className="modal-foot">
                <span className="foot-note mono">{locale === "ru" ? "Сканирование завершено" : "Scan complete"} · {result?.referencedAssets?.length ?? 0} {locale === "ru" ? "ссылок проверено" : "links checked"}</span>
                <button className="btn btn-primary btn-uppercase" onClick={() => void closeDetailedReport()}>
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
          <div className="scrim" onClick={() => setIsSettingsOpen(false)}>
            <div className="modal modal-sm" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <h2>{settingsTitle}</h2>
                <button type="button" className="x-btn" onClick={() => setIsSettingsOpen(false)}>{Icon.x({ size: 16 })}</button>
              </div>

              <div className="set-section">
                <div className="eyebrow section-label">{contextMenuTitle}</div>

                <div className="check-row" onClick={() => setContextMenuNormal(!contextMenuNormal)} style={{ cursor: "pointer" }}>
                  <div className={`checkbox ${contextMenuNormal ? "on" : ""}`}>{Icon.check({ size: 13, sw: 2.6 })}</div>
                  <div className="check-txt"><div className="t">{contextNormalLabel}</div></div>
                </div>

                <div className="check-row" onClick={() => setContextMenuQuick(!contextMenuQuick)} style={{ cursor: "pointer" }}>
                  <div className={`checkbox ${contextMenuQuick ? "on" : ""}`}>{Icon.check({ size: 13, sw: 2.6 })}</div>
                  <div className="check-txt"><div className="t">{contextQuickLabel}</div></div>
                </div>
              </div>

              <div className="actions" style={{ paddingTop: 18 }}>
                <button className="btn btn-primary btn-uppercase" disabled={isSavingSettings} onClick={() => void saveContextMenuSettings()}>
                  {settingsSave}
                </button>
                <button className="btn btn-ghost" onClick={() => setIsSettingsOpen(false)}>
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
      </div>
    </div>
  );
}



