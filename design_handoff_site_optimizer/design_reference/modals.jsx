/* ============================================================
   Modals: Detailed Report + Settings
   ============================================================ */

const FILES = [
  { n: 'cdn/js/countries.js', tag: 'JS', st: 'missing', cat: 'Скрипты' },
  { n: 'cdn/js/geo/sk.js', tag: 'JS', st: 'missing', cat: 'Скрипты' },
  { n: 'cdn/js/ld.js', tag: 'JS', st: 'missing', cat: 'Скрипты' },
  { n: 'fonts/opensans-regular.61f3c1f8.ttf', tag: 'FNT', st: 'missing', cat: 'Шрифты' },
  { n: 'fonts/opensans-bold.93a072c2.ttf', tag: 'FNT', st: 'missing', cat: 'Шрифты' },
  { n: 'images/arrow_1.a48efa66.webp', tag: 'IMG', st: 'missing', cat: 'Изображения' },
  { n: 'images/arrow_2.d41af58d.webp', tag: 'IMG', st: 'missing', cat: 'Изображения' },
  { n: 'images/arrow_3.d9b53352.webp', tag: 'IMG', st: 'missing', cat: 'Изображения' },
  { n: 'fonts/roboto_400_cyrillic-ext.1394d855.woff2', tag: 'FNT', st: 'missing', cat: 'Шрифты' },
  { n: 'css/index.77fbd19f.css', tag: 'CSS', st: 'found', cat: 'Стили' },
  { n: 'css/index.7a2b4c76.css', tag: 'CSS', st: 'found', cat: 'Стили' },
  { n: 'images/hero_bg.5f2a.webp', tag: 'IMG', st: 'found', cat: 'Изображения' },
  { n: 'images/cover.8c1d.webp', tag: 'IMG', st: 'found', cat: 'Изображения' },
  { n: 'js/app.bundle.2f9.js', tag: 'JS', st: 'found', cat: 'Скрипты' },
];

const TAG_ICON = { IMG: 'image', FNT: 'type', JS: 'brace', CSS: 'code' };

function ReportModal({ onClose }) {
  const [tab, setTab] = useState('found');
  const [q, setQ] = useState('');
  const counts = { found: 164, removed: 1, errors: 0 };

  const source = tab === 'found' ? FILES : tab === 'removed'
    ? [{ n: 'images/unused_legacy.png', tag: 'IMG', st: 'missing', cat: 'Изображения' }]
    : [];
  const list = source.filter((f) => f.n.toLowerCase().includes(q.toLowerCase()));

  // coverage donut
  const onSite = 77, notFound = 87, total = onSite + notFound;
  const pct = Math.round((onSite / total) * 100);
  const R = 52, C = 2 * Math.PI * R, GAP = 7;
  const mLen = (onSite / total) * C - GAP;
  const dLen = (notFound / total) * C - GAP;

  const CATS = [
    { l: 'Изображения', n: 54, ic: 'image' },
    { l: 'Шрифты', n: 57, ic: 'type' },
    { l: 'Стили', n: 36, ic: 'code' },
    { l: 'Скрипты', n: 12, ic: 'brace' },
  ];

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal report-modal" onClick={(e) => e.stopPropagation()}>
        <button className="x-btn report-x" onClick={onClose}><Icon.x size={16} /></button>

        <div className="report-layout">
          {/* ---------- LEFT RAIL ---------- */}
          <aside className="report-rail">
            <div className="eyebrow">Отчёт об оптимизации</div>

            <div className="hero-metric">
              <div className="hm-val"><span className="num">22</span><span className="unit">КБ</span></div>
              <div className="hm-row">
                <span className="hm-lab">сэкономлено</span>
                <span className="trend-chip"><Icon.trend size={12} sw={2} /> −4.1%</span>
              </div>
            </div>

            <div className="path-chip">
              <Icon.folder size={14} />
              <span className="mono">115_offer_archive</span>
            </div>

            <div className="cov-block">
              <div className="cov-donut">
                <svg width="124" height="124" viewBox="0 0 124 124">
                  <circle cx="62" cy="62" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="11" />
                  <circle cx="62" cy="62" r={R} fill="none" stroke="var(--donut-on)" strokeWidth="11" strokeLinecap="round"
                          strokeDasharray={`${mLen} ${C - mLen}`} strokeDashoffset="0" />
                  <circle cx="62" cy="62" r={R} fill="none" stroke="var(--donut-off)" strokeWidth="11" strokeLinecap="round"
                          strokeDasharray={`${dLen} ${C - dLen}`} strokeDashoffset={-(mLen + GAP)} />
                </svg>
                <div className="cov-center">
                  <div className="p">{pct}<span>%</span></div>
                  <div className="l">покрытие</div>
                </div>
              </div>
              <div className="cov-legend">
                <div className="cl-item"><span className="dot" style={{ background: 'var(--donut-on)' }} />
                  <span className="cl-l">На месте</span><span className="cl-v">{onSite}</span></div>
                <div className="cl-item"><span className="dot" style={{ background: 'var(--donut-off)' }} />
                  <span className="cl-l">Не найдено</span><span className="cl-v">{notFound}</span></div>
              </div>
            </div>

            <div className="rail-stats">
              <div className="rs"><div className="rs-n">164</div><div className="rs-l">Обработано</div></div>
              <div className="rs"><div className="rs-n red">1</div><div className="rs-l">Удалено</div></div>
              <div className="rs"><div className="rs-n">0</div><div className="rs-l">Сжато</div></div>
              <div className="rs"><div className="rs-n">0</div><div className="rs-l">Ошибки</div></div>
            </div>
          </aside>

          {/* ---------- RIGHT MAIN ---------- */}
          <section className="report-main">
            <div className="rm-head">
              <h2>Подробный отчёт</h2>
              <div className="search">
                <Icon.search size={15} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти файл…" />
              </div>
            </div>

            <div className="cat-strip">
              {CATS.map((c) => {
                const Ci = Icon[c.ic];
                return (
                  <div className="cat-card" key={c.l}>
                    <span className="cat-ic"><Ci size={15} /></span>
                    <span className="cat-n">{c.n}</span>
                    <span className="cat-l">{c.l}</span>
                  </div>
                );
              })}
            </div>

            <div className="rtabs">
              {[['found', 'Найдено в коде', 'check'], ['removed', 'Удалено', 'trash'], ['errors', 'Ошибки', 'alert']].map(([k, label, ic]) => {
                const Ti = Icon[ic];
                return (
                  <button key={k} className={`rtab ${tab === k ? 'on' : ''}`} onClick={() => { setTab(k); setQ(''); }}>
                    <Ti size={14} />{label}<span className="badge">{counts[k]}</span>
                  </button>
                );
              })}
            </div>

            <div className="flist">
              {list.length === 0 ? (
                <div className="empty-list">
                  <span className="el-ic"><Icon.check size={22} /></span>
                  {q ? 'Ничего не найдено по запросу' : tab === 'errors' ? 'Ошибок нет — всё чисто' : 'Здесь пока ничего нет'}
                </div>
              ) : list.map((f, i) => {
                const Fi = Icon[TAG_ICON[f.tag]];
                return (
                  <div className="frow" key={i}>
                    <span className={`ftype ${f.tag.toLowerCase()}`}><Fi size={15} /></span>
                    <span className="fmeta">
                      <span className="fname">{f.n}</span>
                      <span className="fcat">{f.cat}</span>
                    </span>
                    <span className={`fstatus ${f.st}`}>
                      <span className="sd" />{f.st === 'found' ? 'на месте' : 'не найдено'}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div className="modal-foot">
          <span className="foot-note mono">Сканирование завершено · 164 ссылки проверено</span>
          <button className="btn btn-primary btn-uppercase" onClick={onClose}>Закрыть отчёт</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- SETTINGS ---------- */
function SettingsModal({ onClose }) {
  const [ctx, setCtx] = useState({ optimize: true, quick: false });
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Настройки</h2>
          <button className="x-btn" onClick={onClose}><Icon.x size={16} /></button>
        </div>
        <div className="set-section">
          <div className="eyebrow section-label">Пункты контекстного меню</div>
          <div className="check-row" onClick={() => setCtx({ ...ctx, optimize: !ctx.optimize })} style={{ cursor: 'pointer' }}>
            <div className={`checkbox ${ctx.optimize ? 'on' : ''}`}><Icon.check size={13} sw={2.6} /></div>
            <div className="check-txt"><div className="t">Оптимизировать сайт</div></div>
          </div>
          <div className="check-row" onClick={() => setCtx({ ...ctx, quick: !ctx.quick })} style={{ cursor: 'pointer' }}>
            <div className={`checkbox ${ctx.quick ? 'on' : ''}`}><Icon.check size={13} sw={2.6} /></div>
            <div className="check-txt"><div className="t">Быстро оптимизировать сайт</div></div>
          </div>
        </div>
        <div className="actions" style={{ paddingTop: 18 }}>
          <button className="btn btn-primary btn-uppercase" onClick={onClose}>Сохранить</button>
          <button className="btn btn-ghost" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}

window.ReportModal = ReportModal;
window.SettingsModal = SettingsModal;
