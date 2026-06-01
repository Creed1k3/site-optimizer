/* ============================================================
   Patch notes  ·  animated, text-only changelog viewer
   ------------------------------------------------------------
   Add / remove slides freely — the viewer derives its slide
   count from `slides.length`, so the "Далее / Закрыть" flow and
   the progress dots adjust automatically.

   Each release:
     { version, date, slides: [ { title, intro?, items: [...] } ] }
   Each item:
     { k: 'new' | 'improved' | 'fixed', t: '…' }
   ============================================================ */

const RELEASES = [
  {
    version: 'v0.7.0',
    date: 'Июнь 2026',
    slides: [
      {
        title: 'Умная очистка медиа',
        intro: 'Поиск лишних файлов стал заметно аккуратнее и больше не трогает нужное.',
        items: [
          { k: 'new', t: 'Неиспользуемые изображения теперь ищутся и в CSS-фонах, и в инлайн-стилях.' },
          { k: 'new', t: 'Дубликаты определяются по содержимому файла, а не по его имени.' },
          { k: 'improved', t: 'Осторожный режим удаляет только то, на что не нашлось ни одной надёжной ссылки.' },
        ],
      },
      {
        title: 'Быстрее на больших сайтах',
        intro: 'Тяжёлые архивы обрабатываются ощутимо шустрее.',
        items: [
          { k: 'improved', t: 'Параллельная обработка файлов — до 2× быстрее на крупных проектах.' },
          { k: 'improved', t: 'Прогресс показывает реальную экономию в КБ прямо во время работы.' },
          { k: 'fixed', t: 'Исправлено зависание на ZIP-архивах больше 500 МБ.' },
        ],
      },
      {
        title: 'И ещё по мелочи',
        intro: 'Небольшие, но приятные штрихи по всему приложению.',
        items: [
          { k: 'new', t: 'Тёмная тема для всего интерфейса с плавным переключением.' },
          { k: 'new', t: 'Подробный отчёт с поиском по файлам и покрытием ссылок.' },
          { k: 'fixed', t: 'Корректная распаковка архивов с кириллицей в именах файлов.' },
        ],
      },
    ],
  },
  {
    version: 'v0.6.0',
    date: 'Март 2026',
    slides: [
      {
        title: 'Подробный отчёт',
        intro: 'Стало видно, что именно произошло с сайтом.',
        items: [
          { k: 'new', t: 'Новый экран отчёта с диаграммой покрытия ссылок.' },
          { k: 'improved', t: 'Файлы разбиты по категориям: изображения, шрифты, стили, скрипты.' },
        ],
      },
      {
        title: 'Удобнее в работе',
        intro: null,
        items: [
          { k: 'new', t: 'Выбор языка интерфейса прямо в верхней панели.' },
          { k: 'fixed', t: 'Мелкие исправления стабильности при экспорте.' },
        ],
      },
    ],
  },
  {
    version: 'v0.5.0',
    date: 'Январь 2026',
    slides: [
      {
        title: 'Первый публичный релиз',
        intro: 'С чего всё началось.',
        items: [
          { k: 'new', t: 'Оптимизация сайтов из ZIP-архива или локальной папки.' },
          { k: 'new', t: 'Экспорт результата обратно в архив или папку.' },
          { k: 'improved', t: 'Базовый отчёт об обработанных файлах.' },
        ],
      },
    ],
  },
];

const K_LABEL = { new: 'Новое', improved: 'Улучшено', fixed: 'Исправлено' };

/* ---------- the animated viewer ---------- */
function PatchNotes({ release, onClose }) {
  const [i, setI] = useState(0);
  const n = release.slides.length;
  const slide = release.slides[i];
  const last = i === n - 1;

  const next = () => { if (last) onClose(); else setI((v) => v + 1); };
  const prev = () => setI((v) => Math.max(0, v - 1));

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, last]);

  // stagger helpers — each animated element gets an increasing delay
  let d = 0;
  const step = (ms) => { const v = d; d += ms; return { '--pnd': `${v}ms` }; };

  return (
    <div className="pn-scrim" onClick={onClose}>
      <div className="pn" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Что нового">
        <button className="pn-x" onClick={onClose} aria-label="Закрыть"><Icon.x size={15} /></button>

        <div className="pn-top">
          <span className="pn-badge"><Icon.sparkles size={13} /> Что нового</span>
          <div className="pn-dots">
            {release.slides.map((_, k) => (
              <button
                key={k}
                className={`pn-dot ${k === i ? 'on' : ''} ${k < i ? 'past' : ''}`}
                onClick={() => setI(k)}
                aria-label={`Слайд ${k + 1}`}
              />
            ))}
          </div>
        </div>

        <div className="pn-stage">
          {/* key={i} remounts the slide so the CSS reveal replays each step */}
          <div className="pn-slide" key={i}>
            <div className="pn-kick pn-anim" style={step(70)}>
              {release.version} · {release.date}
            </div>
            <h2 className="pn-title pn-anim" style={step(90)}>{slide.title}</h2>
            {slide.intro && <p className="pn-intro pn-anim" style={step(110)}>{slide.intro}</p>}
            <ul className="pn-list">
              {slide.items.map((it, k) => (
                <li className="pn-item pn-anim" key={k} style={step(85)}>
                  <span className={`pn-tag ${it.k}`}>{K_LABEL[it.k]}</span>
                  <span className="pn-text">{it.t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="pn-foot">
          <span className="pn-count mono">{String(i + 1).padStart(2, '0')} <i>/</i> {String(n).padStart(2, '0')}</span>
          <div className="pn-nav">
            {i > 0 && <button className="pn-btn ghost" onClick={prev}>Назад</button>}
            <button className="pn-btn primary" onClick={next}>
              {last ? 'Закрыть' : <>Далее <Icon.arrowRight size={15} /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- the subtle version button + release list ---------- */
function VersionMenu({ version, hasUpdate, onOpen }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = (rel) => { setOpen(false); onOpen(rel); };

  return (
    <div className="ver-wrap" ref={ref}>
      <button
        className={`ver-btn ${open ? 'open' : ''} ${hasUpdate ? 'has-update' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Заметки о выпусках"
      >
        <span className="ver-dot" />
        <span className="ver-num">{version}</span>
        <span className="ver-chev"><Icon.chevron size={13} /></span>
      </button>

      {open && (
        <div className="ver-menu">
          <div className="ver-menu-head">Заметки о выпусках</div>
          {RELEASES.map((rel, idx) => (
            <button key={rel.version} className="ver-opt" onClick={() => pick(rel)}>
              <span className="vo-spark"><Icon.sparkles size={14} /></span>
              <span className="vo-txt">
                <span className="vo-l1">
                  {rel.version}
                  {idx === 0 && <span className="vo-new">новое</span>}
                </span>
                <span className="vo-l2">{rel.date} · {rel.slides.length} {plural(rel.slides.length)}</span>
              </span>
              <span className="vo-go"><Icon.arrowRight size={14} /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function plural(n) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return 'слайд';
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return 'слайда';
  return 'слайдов';
}

window.RELEASES = RELEASES;
window.PatchNotes = PatchNotes;
window.VersionMenu = VersionMenu;
