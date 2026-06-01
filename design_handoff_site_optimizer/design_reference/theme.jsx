/* ============================================================
   Theme system + Language menu  (loads after screens.jsx,
   so React hooks useState/useEffect/useRef are already global)
   ============================================================ */

/* ---------- animated dark / light theme ---------- */
function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('so-theme') || 'light'; } catch (e) { return 'light'; }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('so-theme', theme); } catch (e) {}
  }, [theme]);

  const toggle = (e) => {
    const next = theme === 'dark' ? 'light' : 'dark';
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!document.startViewTransition || reduce) { setTheme(next); return; }

    // origin = the toggle button centre
    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const vt = document.startViewTransition(() => {
      document.documentElement.setAttribute('data-theme', next);
    });
    setTheme(next); // keep React state in sync

    vt.ready.then(() => {
      const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 620, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    });
  };

  return [theme, toggle];
}

function ThemeToggle({ theme, onToggle }) {
  const dark = theme === 'dark';
  return (
    <button
      className={`theme-toggle ${dark ? 'is-dark' : ''}`}
      onClick={onToggle}
      title={dark ? 'Светлая тема' : 'Тёмная тема'}
      aria-label="Сменить тему"
    >
      <span className="tt-orb">
        <span className="tt-ic sun"><Icon.sun size={16} /></span>
        <span className="tt-ic moon"><Icon.moon size={15} /></span>
      </span>
    </button>
  );
}

/* ---------- language menu ---------- */
const LANGS = [
  { code: 'RU', label: 'Русский',    sub: 'Russian'    },
  { code: 'EN', label: 'English',    sub: 'English'    },
  { code: 'DE', label: 'Deutsch',    sub: 'German'     },
  { code: 'ES', label: 'Español',    sub: 'Spanish'    },
  { code: 'UK', label: 'Українська', sub: 'Ukrainian'  },
];

function LanguageMenu() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('RU');
  const ref = useRef(null);
  const active = LANGS.find((l) => l.code === cur);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="lang-wrap" ref={ref}>
      <button className={`lang-pill ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)}>
        <Icon.globe size={15} />
        <span className="code">{active.code}</span>
        <span className="chev"><Icon.chevron size={14} /></span>
      </button>

      {open && (
        <div className="lang-menu">
          <div className="lang-menu-head">Язык интерфейса</div>
          {LANGS.map((l) => (
            <button
              key={l.code}
              className={`lang-opt ${l.code === cur ? 'on' : ''}`}
              onClick={() => { setCur(l.code); setOpen(false); }}
            >
              <span className="badge">{l.code}</span>
              <span className="txt">
                <span className="l1">{l.label}</span>
                <span className="l2">{l.sub}</span>
              </span>
              {l.code === cur && <span className="tick"><Icon.check size={14} sw={2.4} /></span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

window.useTheme = useTheme;
window.ThemeToggle = ThemeToggle;
window.LanguageMenu = LanguageMenu;
