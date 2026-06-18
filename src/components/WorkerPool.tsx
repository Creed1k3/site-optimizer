import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";
import { createFlowField, type FlowField } from "../lib/flowField";

type Locale = "ru" | "en";

/** A real pool lane reported by the sidecar (structurally matches App's LaneState). */
export interface PoolLane {
  id: number;
  file: string;
  kind: string;
  /** real intra-file percent (videos); 0 while an image lane is busy */
  pct: number;
  filesDone: number;
  active: boolean;
}

interface WorkerPoolProps {
  /** real overall progress 0..100 */
  percent: number;
  /** real processed / total file counts */
  done: number;
  total: number;
  /** names of recently touched files (drives the per-worker labels) */
  recentFiles: string[];
  /** how many worker cells to show — bound to host concurrency */
  threads: number;
  /** real per-lane state from the sidecar; when present, cells show real data */
  lanes?: PoolLane[];
  /** while true the rings spin; when false every worker shows "done" */
  running: boolean;
  locale: Locale;
}

interface WorkerState {
  id: number;
  file: string;
  kind: string;
  progress: number;
  speed: number;
  flash: number;
  key: number;
  idle: boolean;
}

const FALLBACK_STREAM = [
  "images/hero_bg.webp", "css/index.css", "js/app.bundle.js", "fonts/regular.woff2",
  "images/cover.webp", "js/geo.js", "images/banner.png", "css/critical.css",
];

const RING_R = 30;
const RING_C = 2 * Math.PI * RING_R;

function fileKind(name: string): string {
  const e = (name.split(".").pop() || "").toLowerCase();
  if (["webp", "png", "jpg", "jpeg", "svg", "gif", "avif"].includes(e)) return "IMG";
  if (["woff2", "woff", "ttf", "otf"].includes(e)) return "FNT";
  if (e === "css") return "CSS";
  if (e === "js") return "JS";
  return "FILE";
}

function shortName(name: string): string {
  return name.split(/[\\/]/).pop() ?? name;
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const L = {
  ru: {
    eyebrow: (n: number) => `Параллельная оптимизация · ${n} ${n === 1 ? "поток" : n < 5 ? "потока" : "потоков"}`,
    threadId: (id: number) => `Поток ${id}`,
    ready: "готово",
    filesN: (n: number) => `${n} ${pluralRu(n, "файл", "файла", "файлов")}`,
    processedN: (n: number) => `обработано · ${n}`,
    footProcessed: "обработано",
    footQueued: "в очереди",
    footActive: (a: number, t: number) => `${a} / ${t} потоков активны`,
  },
  en: {
    eyebrow: (n: number) => `Parallel optimization · ${n} ${n === 1 ? "thread" : "threads"}`,
    threadId: (id: number) => `Thread ${id}`,
    ready: "done",
    filesN: (n: number) => `${n} ${n === 1 ? "file" : "files"}`,
    processedN: (n: number) => `processed · ${n}`,
    footProcessed: "processed",
    footQueued: "queued",
    footActive: (a: number, t: number) => `${a} / ${t} threads active`,
  },
} as const;

function WorkerCell({ w, doneCount, idleLabel, fileLabel, metaLabel }: {
  w: WorkerState; doneCount: number; idleLabel: string; fileLabel: string; metaLabel: string;
}) {
  const off = RING_C * (1 - w.progress);
  return (
    <div className={`worker ${w.flash > 0.02 ? "flash" : ""} ${w.idle ? "idle" : ""}`}>
      <div className="w-head">
        <span className="w-id">{fileLabel}</span>
        <span className="w-dot" style={{ opacity: w.idle ? 0.25 : 1 }} />
      </div>

      <div className="w-ring" style={{ "--flash": w.flash } as React.CSSProperties}>
        <svg width="72" height="72" viewBox="0 0 72 72">
          <circle cx="36" cy="36" r={RING_R} className="wr-track" />
          <circle
            cx="36" cy="36" r={RING_R} className="wr-arc"
            strokeDasharray={RING_C}
            strokeDashoffset={w.idle ? RING_C : off}
          />
        </svg>
        <div className="w-kind">{w.idle ? <Icon.check size={18} /> : w.kind}</div>
      </div>

      <div className="w-file" key={w.key}>{w.idle ? idleLabel : shortName(w.file)}</div>
      <div className="w-meta">{metaLabel}</div>
      <span className="w-shimmer" style={{ opacity: w.idle ? 0 : 0.9 }} />
    </div>
  );
}

// Renders a real pool lane reported by the sidecar. Video lanes show a true
// percent arc; image lanes (sharp encode is atomic, no intra-file %) show an
// indeterminate "busy" spinner plus the real count of files this lane finished.
function RealWorkerCell({ lane, idleLabel, fileLabel, metaLabel }: {
  lane: PoolLane; idleLabel: string; fileLabel: string; metaLabel: string;
}) {
  const hasRealPct = lane.active && lane.pct > 0;
  const busy = lane.active && lane.pct <= 0;
  const off = hasRealPct ? RING_C * (1 - lane.pct / 100) : busy ? RING_C * 0.75 : RING_C * (1 - (lane.active ? 0 : 1));
  return (
    <div className={`worker ${lane.active ? "" : "idle"}`}>
      <div className="w-head">
        <span className="w-id">{fileLabel}</span>
        <span className="w-dot" style={{ opacity: lane.active ? 1 : 0.25 }} />
      </div>

      <div className={`w-ring ${busy ? "busy" : ""}`}>
        <svg width="72" height="72" viewBox="0 0 72 72">
          <circle cx="36" cy="36" r={RING_R} className="wr-track" />
          <circle
            cx="36" cy="36" r={RING_R} className="wr-arc"
            strokeDasharray={RING_C}
            strokeDashoffset={off}
          />
        </svg>
        <div className="w-kind">{lane.active ? (lane.kind || "···") : <Icon.check size={18} />}</div>
      </div>

      <div className="w-file" key={lane.file}>{lane.active && lane.file ? shortName(lane.file) : idleLabel}</div>
      <div className="w-meta">{metaLabel}</div>
      <span className="w-shimmer" style={{ opacity: lane.active ? 0.9 : 0 }} />
    </div>
  );
}

export function WorkerPool({ percent, done, total, recentFiles, threads, lanes, running, locale }: WorkerPoolProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fieldRef = useRef<FlowField | null>(null);
  const filesRef = useRef<string[]>(recentFiles);
  filesRef.current = recentFiles;

  const t = L[locale];
  const idle = !running || percent >= 100;

  const [workers, setWorkers] = useState<WorkerState[]>(() =>
    Array.from({ length: threads }, (_, i) => {
      const file = recentFiles[i] ?? FALLBACK_STREAM[i % FALLBACK_STREAM.length];
      return { id: i + 1, file, kind: fileKind(file), progress: Math.random(), speed: 0.7 + Math.random() * 0.7, flash: 0, key: 0, idle: false };
    })
  );

  // rebuild worker array when thread count changes
  useEffect(() => {
    setWorkers((prev) => {
      if (prev.length === threads) return prev;
      return Array.from({ length: threads }, (_, i) => prev[i] ?? {
        id: i + 1,
        file: filesRef.current[i] ?? FALLBACK_STREAM[i % FALLBACK_STREAM.length],
        kind: fileKind(filesRef.current[i] ?? FALLBACK_STREAM[i % FALLBACK_STREAM.length]),
        progress: Math.random(), speed: 0.7 + Math.random() * 0.7, flash: 0, key: 0, idle: false,
      });
    });
  }, [threads]);

  // animated flow-field backdrop
  useEffect(() => {
    if (!canvasRef.current) return;
    const f = createFlowField(canvasRef.current);
    fieldRef.current = f;
    f.init();
    f.start();
    const onResize = () => f.resize();
    window.addEventListener("resize", onResize);
    return () => { f.stop(); window.removeEventListener("resize", onResize); };
  }, []);

  // ring animation loop — purely visual activity; real numbers come from props
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      setWorkers((ws) => ws.map((w) => {
        const nw = { ...w };
        if (nw.flash > 0) nw.flash = Math.max(0, nw.flash - dt * 2.6);
        if (idle) { nw.idle = true; nw.progress = 1; return nw; }
        nw.idle = false;
        nw.progress += nw.speed * dt;
        if (nw.progress >= 1) {
          nw.progress = 0;
          nw.flash = 1;
          const pool = filesRef.current;
          const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : FALLBACK_STREAM[Math.floor(Math.random() * FALLBACK_STREAM.length)];
          nw.file = pick;
          nw.kind = fileKind(pick);
          nw.key++;
          nw.speed = 0.7 + Math.random() * 0.7;
        }
        return nw;
      }));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [idle]);

  const useReal = !!lanes && lanes.length > 0;
  // The sidecar sizes its pool to min(cpus, fileCount), so a folder with few
  // files reports fewer lanes than the host has threads. Pad up to `threads`
  // with idle placeholder lanes so the grid stays a stable size across folders
  // in a batch instead of briefly collapsing to a single cell.
  const displayLanes: PoolLane[] = useReal
    ? Array.from({ length: threads }, (_, i) => lanes![i] ?? {
        id: i, file: "", kind: "", pct: 0, filesDone: 0, active: false,
      })
    : [];
  const activeThreads = useReal ? lanes!.filter((l) => l.active && !idle).length : (idle ? 0 : threads);
  // distribute the real processed count across the visible workers (decorative mode only)
  const perWorker = (i: number) => Math.floor(done / threads) + (i < done % threads ? 1 : 0);

  return (
    <>
      <div className="eyebrow section-label" style={{ marginTop: 4 }}>{t.eyebrow(threads)}</div>
      <div className="canvas-wrap pool">
        <canvas ref={canvasRef} className="pool-canvas" />
        <div className="pool-grid" style={{ gridTemplateColumns: `repeat(${Math.min(threads, 4)}, 1fr)` }}>
          {useReal
            ? displayLanes.map((lane) => (
                <RealWorkerCell
                  key={lane.id}
                  lane={idle ? { ...lane, active: false } : lane}
                  idleLabel={t.ready}
                  fileLabel={t.threadId(lane.id + 1)}
                  metaLabel={(idle || !lane.active) ? t.filesN(lane.filesDone) : t.processedN(lane.filesDone)}
                />
              ))
            : workers.map((w, i) => (
                <WorkerCell
                  key={w.id}
                  w={w}
                  doneCount={perWorker(i)}
                  idleLabel={t.ready}
                  fileLabel={t.threadId(w.id)}
                  metaLabel={w.idle ? t.filesN(perWorker(i)) : t.processedN(perWorker(i))}
                />
              ))}
        </div>
        <div className="pool-foot">
          <span className="pf-stat"><b>{done}</b> {t.footProcessed}</span>
          <span className="pf-sep" />
          <span className="pf-stat"><b>{total}</b> {t.footQueued}</span>
          <span className="pf-sep" />
          <span className="pf-stat">{t.footActive(activeThreads, threads)}</span>
        </div>
      </div>
    </>
  );
}
