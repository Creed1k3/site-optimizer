/* ============================================================
   Auto-update toast  ·  minimal, Claude-flavoured
   States:  available → downloading → ready
   ============================================================ */

function UpdateToast({ open, version, onClose, onInstalled }) {
  const [phase, setPhase] = useState('available'); // available | downloading | ready
  const [pct, setPct] = useState(0);
  const timer = useRef(null);

  // reset to "available" each time it is (re)opened
  useEffect(() => {
    if (open) { setPhase('available'); setPct(0); }
    return () => clearInterval(timer.current);
  }, [open]);

  const startDownload = () => {
    setPhase('downloading');
    setPct(0);
    let p = 0;
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      // ease-out feel: slows as it nears 100
      p += Math.max(0.8, (100 - p) * 0.045);
      if (p >= 100) {
        p = 100;
        clearInterval(timer.current);
        setPct(100);
        setTimeout(() => setPhase('ready'), 360);
      } else {
        setPct(p);
      }
    }, 60);
  };

  const restart = () => { onInstalled && onInstalled(); onClose && onClose(); };

  return (
    <div className={`upd ${open ? 'show' : ''} phase-${phase}`} role="status" aria-live="polite">
      {/* left media — morphs with phase */}
      <div className="upd-media">
        <span className="upd-orb">
          <span className="upd-ic dl"><Icon.download size={17} /></span>
          <span className="upd-ic ok"><Icon.check size={17} sw={2.4} /></span>
          {phase === 'downloading' && (
            <svg className="upd-prog" viewBox="0 0 40 40">
              <circle className="track" cx="20" cy="20" r="17" />
              <circle className="bar" cx="20" cy="20" r="17"
                strokeDasharray={2 * Math.PI * 17}
                strokeDashoffset={(1 - pct / 100) * 2 * Math.PI * 17} />
            </svg>
          )}
        </span>
        {phase === 'available' && <span className="upd-pulse" />}
      </div>

      {/* body */}
      <div className="upd-body">
        <div className="upd-rows">
          {/* available */}
          <div className="upd-row r-available">
            <div className="upd-t">Доступно обновление</div>
            <div className="upd-d">Версия <b>{version}</b> готова к установке</div>
          </div>
          {/* downloading */}
          <div className="upd-row r-downloading">
            <div className="upd-t">Загрузка обновления</div>
            <div className="upd-bar"><i style={{ width: `${pct}%` }} /></div>
          </div>
          {/* ready */}
          <div className="upd-row r-ready">
            <div className="upd-t">Обновление готово</div>
            <div className="upd-d">Перезапустите, чтобы применить {version}</div>
          </div>
        </div>

        <div className="upd-actions">
          {phase === 'available' && (
            <>
              <button className="upd-btn primary" onClick={startDownload}>Обновить</button>
              <button className="upd-btn ghost" onClick={onClose}>Позже</button>
            </>
          )}
          {phase === 'downloading' && (
            <span className="upd-pct mono">{Math.round(pct)}%</span>
          )}
          {phase === 'ready' && (
            <>
              <button className="upd-btn primary" onClick={restart}>Перезапустить</button>
              <button className="upd-btn ghost" onClick={onClose}>Позже</button>
            </>
          )}
        </div>
      </div>

      <button className="upd-x" onClick={onClose} aria-label="Скрыть"><Icon.x size={13} /></button>
    </div>
  );
}

window.UpdateToast = UpdateToast;
