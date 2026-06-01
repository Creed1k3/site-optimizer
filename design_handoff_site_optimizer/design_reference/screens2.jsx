/* ============================================================
   Screens: Review (3) + Export (4)
   ============================================================ */

/* ---------- 3. REVIEW ---------- */
function ReviewScreen({ exportMode, setExportMode, onReport, onExport, onCancel }) {
  return (
    <div className="screen-inner">
      <div className="card stat-strip">
        <div className="stat">
          <div className="big mint">22 <span style={{ fontSize: 18 }}>КБ</span></div>
          <div className="meta"><div className="lab">Экономия</div></div>
        </div>
        <div className="stat">
          <div className="big">0</div>
          <div className="meta"><div className="lab">Сжато</div></div>
        </div>
        <div className="stat">
          <div className="big red">1</div>
          <div className="meta"><div className="lab">Удалено</div></div>
        </div>
        <div className="stat">
          <div className="big">0</div>
          <div className="meta"><div className="lab">Файлов обновлено</div></div>
        </div>
      </div>

      <div className="card info-card">
        <div className="ic"><Icon.spark size={20} /></div>
        <div className="grow">
          <div className="t">Готово к проверке</div>
          <div className="p">C:\xampp\htdocs\115_offer_archive_optimizer_work</div>
          <div className="d">Открой папку выше, проверь результат и потом выбери формат экспорта.</div>
        </div>
        <button className="btn btn-ghost"><Icon.folder size={16} /> Открыть</button>
      </div>

      <div className="card report-card">
        <div className="rc-ic"><Icon.doc size={19} /></div>
        <div className="grow">
          <div className="eyebrow">Обзор сайта</div>
          <div className="h" style={{ marginTop: 6 }}>Подробный отчёт</div>
          <div className="d">Полная техническая раскладка: покрытие ссылок, файлы по категориям.</div>
        </div>
        <button className="btn-report" onClick={onReport}>
          Открыть <Icon.arrowRight size={15} />
        </button>
      </div>

      <div className="card export-card">
        <div className="eyebrow section-label">Формат экспорта</div>
        <div className="fmt-list">
          <button
            type="button"
            className={`fmt-row ${exportMode === 'zip' ? 'on' : ''}`}
            onClick={() => setExportMode('zip')}
          >
            <span className="fmt-radio" />
            <span className="fmt-ic"><Icon.zip size={18} /></span>
            <span className="fmt-meta">
              <span className="fmt-t">ZIP-архив</span>
              <span className="fmt-p mono">115_offer_archive_optimized.zip</span>
            </span>
            <span className="fmt-tag mono">.zip</span>
          </button>
          <button
            type="button"
            className={`fmt-row ${exportMode === 'folder' ? 'on' : ''}`}
            onClick={() => setExportMode('folder')}
          >
            <span className="fmt-radio" />
            <span className="fmt-ic"><Icon.folder size={18} /></span>
            <span className="fmt-meta">
              <span className="fmt-t">Папка</span>
              <span className="fmt-p mono">115_offer_archive_optimized\</span>
            </span>
            <span className="fmt-tag mono">dir</span>
          </button>
        </div>
      </div>

      <div className="actions">
        <button className="btn btn-primary btn-uppercase" onClick={onExport}>
          <Icon.download size={16} /> {exportMode === 'zip' ? 'Упаковать и экспортировать ZIP' : 'Экспортировать в папку'}
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}

/* ---------- 4. EXPORT DONE ---------- */
function ExportScreen({ onReport, onRestart, onClose }) {
  return (
    <div className="screen-inner">
      <div className="done-wrap">
        <div className="done-ring"><Icon.check size={42} sw={2} /></div>
        <div className="done-title">Экспорт завершён</div>
        <div className="done-file">C:\xampp\htdocs\115_offer_archive_optimized.zip</div>
        <div className="done-sub">Оптимизированный ZIP сохранён рядом с исходным файлом.</div>

        <button className="btn-report done-report" onClick={onReport}>
          <Icon.doc size={15} /> Посмотреть детальный отчёт <Icon.arrowRight size={14} />
        </button>

        <div className="done-actions">
          <button className="btn btn-ghost" onClick={onRestart}>
            <Icon.refresh size={15} /> Оптимизировать другой сайт
          </button>
          <button className="btn btn-orange" onClick={onClose}>
            <Icon.x size={16} sw={2.2} /> Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

window.ReviewScreen = ReviewScreen;
window.ExportScreen = ExportScreen;
