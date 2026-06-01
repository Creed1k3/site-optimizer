/* ============================================================
   Screens: Entry, Optimize, Review, Export
   ============================================================ */
const { useState, useEffect, useRef } = React;

/* ---------- 1. ENTRY ---------- */
function EntryScreen({ mode, setMode, file, setFile, cleanup, setCleanup, onRun }) {
  const [drag, setDrag] = useState(false);
  const pick = () => setFile('C:\\xampp\\htdocs\\115_offer_archive.zip');

  return (
    <div className="screen-inner">
      <div className="src-tabs">
        <button
          type="button"
          className={`src-tab ${mode === 'zip' ? 'on' : ''}`}
          onClick={() => setMode('zip')}
        >
          <Icon.zip size={15} /> ZIP-архив
        </button>
        <button
          type="button"
          className={`src-tab ${mode === 'folder' ? 'on' : ''}`}
          onClick={() => setMode('folder')}
        >
          <Icon.folder size={15} /> Папка
        </button>
      </div>

      <div
        className={`dropzone ${drag ? 'drag' : ''} ${file ? 'filled' : ''}`}
        onClick={() => !file && pick()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(); }}
      >
        {file ? (
          <>
            <div className="dz-check"><Icon.check size={30} /></div>
            <div className="dz-file">{file}</div>
            <button className="btn btn-ghost" onClick={(e) => { e.stopPropagation(); setFile(null); }}>
              <Icon.edit size={15} /> Изменить файл
            </button>
          </>
        ) : (
          <>
            <div className="dz-arrow"><Icon.arrowDown size={22} /></div>
            <div className="dz-title">{mode === 'zip' ? 'Перетащи сюда ZIP сайта' : 'Перетащи сюда папку сайта'}</div>
            <div className="dz-sub">или нажми для выбора · {mode === 'zip' ? 'только .zip' : 'любая папка'}</div>
          </>
        )}
      </div>

      <div className="card cleanup-card">
        <div className="eyebrow section-label">Дополнительная очистка</div>
        <div className="check-row" onClick={() => setCleanup({ ...cleanup, unused: !cleanup.unused })} style={{ cursor: 'pointer' }}>
          <div className={`checkbox ${cleanup.unused ? 'on' : ''}`}><Icon.check size={13} sw={2.6} /></div>
          <div className="check-txt">
            <div className="t">Удалять неиспользуемые медиафайлы</div>
            <div className="d">Осторожный режим: удаляются только файлы, для которых не найдено надёжных ссылок в коде.</div>
          </div>
        </div>
        <div className="check-row" onClick={() => setCleanup({ ...cleanup, dupes: !cleanup.dupes })} style={{ cursor: 'pointer' }}>
          <div className={`checkbox ${cleanup.dupes ? 'on' : ''}`}><Icon.check size={13} sw={2.6} /></div>
          <div className="check-txt">
            <div className="t">Удалять дубликаты медиафайлов</div>
            <div className="d">Дубликаты ищутся по содержимому файла и объединяются в один оригинал.</div>
          </div>
        </div>
      </div>

      <div className="actions">
        <button className="btn btn-primary btn-uppercase" disabled={!file} onClick={onRun}>
          {mode === 'zip' ? 'Распаковать и оптимизировать' : 'Оптимизировать папку'}
        </button>
        <button className="btn btn-ghost" onClick={onRun} disabled={false}>Быстро оптимизировать пачку</button>
      </div>
    </div>
  );
}

/* ---------- 2. OPTIMIZE ---------- */
const FILE_STREAM = [
  'images/hero_bg.webp', 'css/index.77fbd19f.css', 'js/countries.js', 'fonts/opensans-regular.ttf',
  'images/arrow_1.webp', 'images/popup.webp', 'js/geo.sk.js', 'css/index.7a2b4c76.css',
  'images/cover.webp', 'fonts/roboto_400.woff2', 'js/ld.js', 'images/arrow_2.webp',
  'images/banner_2x.png', 'css/critical.css', 'images/logo.svg', 'js/app.bundle.js',
];

/* ────────────────────────────────────────────────────────────
   КОЛИЧЕСТВО ПОТОКОВ  ·  меняй это число — сетка воркеров и
   параллелизм подстроятся автоматически (рекомендуется 2–8).
   ──────────────────────────────────────────────────────────── */
const THREAD_COUNT = 4;
const TOTAL_FILES = 164;

const pickFile = () => FILE_STREAM[Math.floor(Math.random() * FILE_STREAM.length)];
function fileKind(name) {
  const e = (name.split('.').pop() || '').toLowerCase();
  if (['webp', 'png', 'jpg', 'jpeg', 'svg', 'gif', 'avif'].includes(e)) return 'IMG';
  if (['woff2', 'woff', 'ttf', 'otf'].includes(e)) return 'FNT';
  if (e === 'css') return 'CSS';
  if (e === 'js') return 'JS';
  return 'FILE';
}
const RING_R = 30, RING_C = 2 * Math.PI * RING_R;

function WorkerCell({ w }) {
  const off = RING_C * (1 - w.progress);
  return (
    <div className={`worker ${w.flash > 0.02 ? 'flash' : ''} ${w.idle ? 'idle' : ''}`}>
      <div className="w-head">
        <span className="w-id">Поток {w.id}</span>
        <span className="w-dot" style={{ opacity: w.idle ? 0.25 : 1 }} />
      </div>

      <div className="w-ring" style={{ '--flash': w.flash }}>
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

      <div className="w-file" key={w.key}>{w.idle ? 'готово' : w.file}</div>
      <div className="w-meta">{w.idle ? `${w.done} файлов` : `обработано · ${w.done}`}</div>
      <span className="w-shimmer" style={{ opacity: w.idle ? 0 : 0.9 }} />
    </div>
  );
}

function OptimizeScreen({ onDone, path, threads = THREAD_COUNT }) {
  const canvasRef = useRef(null);
  const fieldRef = useRef(null);
  const [pct, setPct] = useState(0);
  const [done, setDone] = useState(0);
  const [saved, setSaved] = useState(0);
  const [active, setActive] = useState(threads);
  const [workers, setWorkers] = useState(() =>
    Array.from({ length: threads }, (_, i) => {
      const file = pickFile();
      return { id: i + 1, file, kind: fileKind(file), progress: 0, speed: 0.7 + Math.random() * 0.7, flash: 0, key: 0, done: 0, idle: false };
    })
  );

  useEffect(() => {
    const f = window.createScanField(canvasRef.current);
    fieldRef.current = f;
    f.init(); f.start();
    const onResize = () => f.resize();
    window.addEventListener('resize', onResize);

    const ws = workers.map((w) => ({ ...w }));
    let totalDone = 0, savedKb = 0, raf = null, last = performance.now(), finished = false;

    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      for (const w of ws) {
        if (w.flash > 0) w.flash = Math.max(0, w.flash - dt * 2.6);
        if (w.idle) continue;
        w.progress += w.speed * dt;
        if (w.progress >= 1) {
          // one file finished on this thread
          const chunk = 2 + Math.floor(Math.random() * 4); // a thread clears a few files per visible cycle
          totalDone += chunk;
          w.done += chunk;
          savedKb += 0.18 + Math.random() * 0.55;
          w.flash = 1;
          if (totalDone >= TOTAL_FILES) {
            totalDone = TOTAL_FILES;
            w.idle = true; w.progress = 1;
          } else {
            w.progress = 0;
            w.file = pickFile(); w.kind = fileKind(w.file); w.key++;
            w.speed = 0.7 + Math.random() * 0.7;
          }
        }
      }
      const p = Math.min(100, (totalDone / TOTAL_FILES) * 100);
      setWorkers(ws.map((w) => ({ ...w })));
      setDone(totalDone);
      setSaved((totalDone / TOTAL_FILES) * 22);
      setActive(ws.filter((w) => !w.idle).length);
      setPct(p);

      if (totalDone >= TOTAL_FILES && !finished) {
        finished = true;
        setTimeout(() => onDone && onDone(), 1100);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => { if (raf) cancelAnimationFrame(raf); f.stop(); window.removeEventListener('resize', onResize); };
  }, []);

  return (
    <div className="screen-inner">
      <div className="eyebrow section-label" style={{ marginTop: 4 }}>Параллельная оптимизация · {threads} потока</div>
      <div className="opt-head">
        <div className="opt-status">
          {pct < 100 ? <>Обработка в {active} потоках<span className="blink">…</span></> : 'Готово ✓'}
        </div>
        <div className="opt-pct">{Math.floor(pct)}<span style={{ fontSize: 16, color: 'var(--text-faint)' }}>%</span></div>
      </div>
      <div className="opt-bar"><i style={{ width: `${pct}%` }} /></div>

      <div className="canvas-wrap pool">
        <canvas ref={canvasRef} className="pool-canvas" />
        <div className="pool-grid" style={{ gridTemplateColumns: `repeat(${Math.min(threads, 4)}, 1fr)` }}>
          {workers.map((w) => <WorkerCell key={w.id} w={w} />)}
        </div>
        <div className="pool-foot">
          <span className="pf-stat"><b>{done}</b> обработано</span>
          <span className="pf-sep" />
          <span className="pf-stat"><b>{saved.toFixed(0)} КБ</b> экономия</span>
          <span className="pf-sep" />
          <span className="pf-stat">{active} / {threads} потоков активны</span>
        </div>
      </div>

      <div className="actions" style={{ justifyContent: 'space-between' }}>
        <div className="opt-path">{path}</div>
        {pct < 100 && (
          <button className="cancel-btn" onClick={() => onDone && onDone()}>
            <Icon.stop size={11} /> Остановить
          </button>
        )}
      </div>
    </div>
  );
}

window.EntryScreen = EntryScreen;
window.OptimizeScreen = OptimizeScreen;
