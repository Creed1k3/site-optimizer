# Site Optimizer v0.3.0

Desktop app (Tauri 2 + React). Принимает **ZIP-архив или папку**, оптимизирует изображения, даёт проверить результат, затем экспортирует — снова в **ZIP или папку** на твой выбор.

---

## Что делает

1. **Распаковывает ZIP** или **копирует папку** во временный рабочий каталог
2. Конвертирует **PNG + JPG/JPEG → WebP** (quality 82, ~70-80% меньше)
3. Заменяет все `.png` / `.jpg` / `.jpeg` ссылки в коде на `.webp`
4. Перемещает неиспользуемые картинки в `.trash/` (не удаляет сразу)
5. **Ждёт** — показывает путь к рабочей папке, можно проверить файлы
6. Экспортирует результат как **ZIP-архив** или **папку** — на выбор
7. Удаляет временный рабочий каталог

---

## Требования

| Инструмент | Версия | Установка |
|---|---|---|
| Rust (stable) | 1.77+ | https://rustup.rs |
| Node.js | 18+ | https://nodejs.org |
| Tauri prerequisites | — | https://tauri.app/start/prerequisites/ |

**macOS:** `xcode-select --install`
**Linux:** `webkit2gtk libssl-dev libayatana-appindicator3-dev`
**Windows:** Visual Studio Build Tools (C++ workload)

---

## Сборка и запуск

```bash
# 1. Распакуй проект
cd site-optimizer

# 2. Зависимости фронтенда
npm install

# 3. Зависимости движка
cd sidecar && npm install && cd ..

# 4. Dev-режим
npm run tauri dev

# 5. Production сборка
npm run tauri build
# Инсталлятор → src-tauri/target/release/bundle/
```

---

## Структура проекта

```
site-optimizer/
├── src/
│   ├── App.tsx          # UI: переключатель вход/выход, прогресс, ревью, экспорт
│   └── App.css          # Industrial dark тема
├── src-tauri/
│   ├── src/main.rs      # Команды Rust: unzip/prepare/optimize/export/cleanup
│   ├── Cargo.toml
│   └── tauri.conf.json
├── sidecar/
│   ├── optimizer.js     # Движок: unzip | optimize | rezip | copyout
│   └── package.json     # sharp + adm-zip
├── index.html
├── vite.config.ts
└── package.json
```

---

## Флоу

```
Пользователь перетаскивает ZIP или папку
           │
    ┌──────┴──────┐
    │ ZIP         │ Folder
    ▼             ▼
unzip_site    prepare_folder
(extract)     (copy to work dir — оригинал не трогается)
           │
           ▼
     optimize_site
     scan → classify → convert → update refs → trash unused
           │
           ▼
     [REVIEW] — пользователь смотрит отчёт и файлы
           │
    ┌──────┴──────┐
    │ ZIP         │ Folder
    ▼             ▼
export_as_zip  export_as_folder
<name>_optimized.zip   <name>_optimized/
           │
           ▼
     cleanup_work_dir
           │
           ▼
         Done
```

---

## Заметки

- Оригинальный файл/папка **никогда не изменяется** — работа идёт в копии
- `.trash/` с удалёнными картинками не попадает в экспорт
- Имя выходного файла: `<оригинал>_optimized.zip` или `<оригинал>_optimized/`
