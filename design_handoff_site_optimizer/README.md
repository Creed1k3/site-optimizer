# Site Optimizer — перенос дизайна в кодовую базу (хендофф для Claude Code)

Цель: перенести новый визуал прототипа **«Paper / Clay»** в реальное Tauri-приложение
`site-optimizer/src/App.tsx`, **не сломав ни строчки рабочей логики** (Tauri `invoke`/`listen`,
фазы, прогресс, батч, апдейтер, settings, i18n).

> Главный принцип: логика остаётся, меняется только то, что она **рисует** — JSX-разметка,
> `className`, иконки и CSS. State-машина (`phase`) и все обработчики не трогаются.

---

## 0. С чего начать

1. Открой папку `design_reference/` — это исходники прототипа (React + чистый CSS). Это
   **референс визуала**, а не файлы для копирования один-в-один.
2. Дизайн-система целиком в двух файлах:
   - `design_reference/styles.css` — токены, тема, titlebar, stepper, кнопки, тосты.
   - `design_reference/styles-screens.css` — стили всех 4 экранов и модалок.
3. Иконки — `design_reference/icons.jsx` (stroke-based, `currentColor`, 1.7px).
4. Открой свой `site-optimizer/src/App.tsx` рядом и сверяйся с таблицей в §2.

---

## 1. Что НЕ трогаем (критично)

Эти вещи в `App.tsx` менять нельзя — только оборачивать в новую разметку:

- `type Phase = "idle" | "preparing" | "running" | "reviewing" | "exporting" | "done" | "error" | "batching" | "batchDone"` (строка 8)
- Все `useState` (строки ~401–451): `phase`, `progress`, `result`, `inputMode`, `exportMode`,
  `batchResults`, `updateInfo`, `isSettingsOpen`, `isReportOpen`, `locale` и т.д.
- Все `invoke("…")`: `optimize_site`, `cleanup_work_dir`, `stop_current_operation`,
  `install_pending_update`, `show/hide/maximize/restore_main_window`, `quit_app`, …
- Все `listen("…")`: `optimizer_event`, `tauri://drag-over/-leave`, `window_close_requested`, …
- `phaseRef`, `setActivityState`, эффекты авто-закрытия, батч-цикл.
- Тексты из `t.*` (i18n RU/EN) — переиспользуем как есть, новые строки добавляем в оба словаря.

Меняем только JSX внутри `return (…)` и добавляем новый CSS.

---

## 2. Карта: фаза в App.tsx → экран прототипа

| Фаза / условие в `App.tsx` (строка) | Экран в прототипе | Файл-референс |
|---|---|---|
| `phase === "idle"` (1725) | **Entry** — дроп-зона, выбор ZIP/папки, кнопка старта | `screens.jsx` (Entry) |
| `preparing \| running \| exporting \| batching` (1824) | **Optimize** — прогресс-бар, текущий файл, проценты, пауза/стоп | `screens.jsx` (Optimize) + `effect.js` (фон с летящими файлами) |
| `phase === "reviewing" && result` (1915) | **Review** — сводка, до/после, кнопка «Подробный отчёт», экспорт | `screens2.jsx` (Review) |
| `phase === "done"` (1984) | **Export / Done** — итог, размер, открыть результат | `screens2.jsx` (Export) |
| `phase === "batchDone"` (1998) | **Done** в батч-режиме (список результатов) | `screens2.jsx` + батч-блок |
| `phase === "error"` (2034) | Состояние ошибки (тот же контейнер, error-стиль) | `styles-screens.css` (`.error-*`) |
| `isReportOpen && …` (2049) | **Модалка «Подробный отчёт»** (табы assets/…) | `modals.jsx` (Detailed Report) |
| `isSettingsOpen` | **Модалка «Настройки»** | `modals.jsx` (Settings) |
| `updateInfo != null` | **Тост авто-апдейта** | `update.jsx` |
| Меню языка / тема (titlebar) | Переключатель темы + язык | `theme.jsx` |
| Патч-ноуты (по клику на версию) | Анимированный changelog | `patchnotes.jsx` |

Stepper в шапке: `currentStep = stepIndex[phase]` (строка 1282) — у прототипа есть готовый
индикатор шагов в `styles.css` (`.stepper`). Сопоставь индексы со своими фазами.

---

## 3. Порядок работ (рекомендуемый)

1. **CSS-фундамент.** Скопируй `design_reference/styles.css` → `src/styles.css` и
   `styles-screens.css` → `src/styles-screens.css`, импортни их в `App.tsx` (или main).
   Сверь имена CSS-переменных с тем, что уже есть, чтобы не было конфликта токенов.
2. **Иконки.** Перенеси `icons.jsx` → `src/components/Icons.tsx` (добавь типы пропсов).
   Замени текущие иконки в titlebar/кнопках на новые.
3. **Titlebar + stepper.** Обнови шапку окна и индикатор шагов под новые классы.
4. **Экран Entry** (`phase === "idle"`). Перенеси разметку дроп-зоны/выбора источника,
   сохранив все хендлеры (drag, `setInputMode`, выбор файла, старт).
5. **Экран Optimize** (busy-фазы). Подключи `progress.percent`, `progress.done/total`,
   `currentFile`, кнопки пауза/стоп. Фон с «летящими файлами» — опционально из `effect.js`.
6. **Review / Done / batchDone / error.** По одному, сверяясь с таблицей §2.
7. **Модалки** Report + Settings, затем **тост апдейта** и **патч-ноуты**.
8. Прогон RU/EN, светлая/тёмная тема, проверка батч-режима.

Делай по одному экрану и собирай проект между шагами — так проще ловить регрессии.

---

## 4. Соответствие мок-состояния прототипа → реальное

В прототипе экраны переключались вручную. Маппинг на реальные данные:

| В прототипе | В реальном `App.tsx` |
|---|---|
| `step` / `setStep` | `phase` / `setPhase` (НЕ добавлять новый стейт) |
| фейковый процент | `progress.percent` |
| «5 / 12 файлов» | `progress.done` / `progress.total` |
| имя текущего файла | `currentFile` |
| мок-сводка результата | `result` (`DonePayload`) |
| список в отчёте | `result.report`, `result.referencedAssets` |
| `setTimeout`-апдейт | `updateInfo` + `install_pending_update` |

---

## 5. Чек-лист готовности

- [ ] Вся Tauri-логика на месте, ни один `invoke`/`listen` не удалён.
- [ ] Все 9 значений `phase` рендерят корректный экран.
- [ ] RU и EN, светлая и тёмная тема — без визуальных дыр.
- [ ] Батч-режим (`batching` / `batchDone`) работает.
- [ ] Модалки Report/Settings, тост апдейта, патч-ноуты подключены.
- [ ] Прогресс-бар и счётчик файлов берут данные из `progress`, не из мока.
- [ ] `npm run tauri dev` собирается без ошибок типов.

---

## Содержимое `design_reference/`

| Файл | Что внутри |
|---|---|
| `styles.css` | Дизайн-система: токены, тема, titlebar, stepper, кнопки, тосты |
| `styles-screens.css` | Стили экранов Entry/Optimize/Review/Export + модалки |
| `icons.jsx` | Набор линейных иконок |
| `screens.jsx` | Экраны Entry + Optimize |
| `screens2.jsx` | Экраны Review + Export |
| `modals.jsx` | Модалки: подробный отчёт + настройки |
| `theme.jsx` | Переключатель темы + меню языка |
| `update.jsx` | Тост авто-апдейта |
| `patchnotes.jsx` | Анимированный changelog |
| `app.jsx` | Оболочка приложения прототипа (навигация) |
| `effect.js` | Фон-эффект «летящих файлов» для экрана Optimize |
| `index.html` | Точка входа прототипа (порядок подключения) |
