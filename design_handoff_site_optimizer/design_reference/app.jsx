/* ============================================================
   Site Optimizer — App shell + navigation
   ============================================================ */

const STEPS = ['Вход', 'Оптимизация', 'Проверка', 'Экспорт'];

function App() {
  const [theme, toggleTheme] = useTheme();
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0); // furthest reached (for stepper enablement)
  const [mode, setMode] = useState('zip');
  const [file, setFile] = useState(null);
  const [cleanup, setCleanup] = useState({ unused: true, dupes: true });
  const [exportMode, setExportMode] = useState('zip');
  const [report, setReport] = useState(false);
  const [settings, setSettings] = useState(false);
  const [version, setVersion] = useState('v0.6.0');
  const [hasUpdate, setHasUpdate] = useState(true);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [notes, setNotes] = useState(null); // active release for the patch-notes viewer
  const [closed, setClosed] = useState(false);

  // an update "arrives" shortly after launch
  useEffect(() => {
    if (!hasUpdate) return;
    const t = setTimeout(() => setUpdateOpen(true), 2600);
    return () => clearTimeout(t);
  }, [hasUpdate]);

  const go = (s) => { setStep(s); setMaxStep((m) => Math.max(m, s)); };

  const goStep = (i) => { if (i <= maxStep) setStep(i); };

  if (closed) {
    return (
      <div className="app-closed">
        <div className="ac-card">
          <span className="ac-glyph"><Icon.spark size={26} /></span>
          <div className="ac-title">Site Optimizer закрыт</div>
          <div className="ac-sub">Сеанс завершён. Можно открыть приложение снова.</div>
          <button className="btn btn-orange" onClick={() => { setClosed(false); setFile(null); setStep(0); setMaxStep(0); }}>
            Открыть снова
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="win">
      {/* titlebar */}
      <div className="titlebar">
        <div className="titlebar-brand">
          <span className="glyph"><Icon.spark size={15} /></span>
          <span className="name">Site Optimizer</span>
        </div>
        <div className="win-controls">
          <button className="win-btn"><Icon.min size={15} /></button>
          <button className="win-btn"><Icon.max size={13} /></button>
          <button className="win-btn close" onClick={() => setClosed(true)}><Icon.x size={15} /></button>
        </div>
      </div>

      {/* topbar */}
      <div className="topbar">
        <div className="topbar-left">
          <LanguageMenu />
        </div>

        <div className="stepper">
          {STEPS.map((label, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="step-sep" />}
              <button
                className={`step ${step === i ? 'active' : ''} ${i < step || (i < maxStep && step !== i) ? 'done' : ''}`}
                onClick={() => goStep(i)}
                disabled={i > maxStep}
              >
                <span className="dot">{i < maxStep && step !== i ? <Icon.check size={11} sw={2.6} /> : i + 1}</span>
                <span className="label">{label}</span>
              </button>
            </React.Fragment>
          ))}
        </div>

        <div className="topbar-right">
          <div className="tr-controls">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <button className="icon-btn" onClick={() => setSettings(true)} title="Настройки"><Icon.gear size={17} /></button>
          </div>
          <VersionMenu
            version={version}
            hasUpdate={hasUpdate}
            onOpen={(rel) => setNotes(rel)}
          />
        </div>
      </div>

      {/* stage */}
      <div className="stage">
        {step === 0 && (
          <div className="screen" key="entry">
            <EntryScreen
              mode={mode} setMode={setMode}
              file={file} setFile={setFile}
              cleanup={cleanup} setCleanup={setCleanup}
              onRun={() => go(1)}
            />
          </div>
        )}
        {step === 1 && (
          <div className="screen" key="opt">
            <OptimizeScreen path="C:\xampp\htdocs\115_offer_archive" onDone={() => go(2)} />
          </div>
        )}
        {step === 2 && (
          <div className="screen" key="rev">
            <ReviewScreen
              exportMode={exportMode} setExportMode={setExportMode}
              onReport={() => setReport(true)}
              onExport={() => go(3)}
              onCancel={() => { setFile(null); setStep(0); setMaxStep(0); }}
            />
          </div>
        )}
        {step === 3 && (
          <div className="screen" key="exp">
            <ExportScreen
              onReport={() => setReport(true)}
              onRestart={() => { setFile(null); setStep(0); setMaxStep(0); }}
              onClose={() => setClosed(true)}
            />
          </div>
        )}
      </div>

      {report && <ReportModal onClose={() => setReport(false)} />}
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
      {notes && <PatchNotes release={notes} onClose={() => setNotes(null)} />}

      <UpdateToast
        open={updateOpen}
        version="v0.7.0"
        onClose={() => setUpdateOpen(false)}
        onInstalled={() => { setVersion('v0.7.0'); setHasUpdate(false); }}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
