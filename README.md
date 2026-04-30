# Site Optimizer v0.6.0

`Site Optimizer` — десктоп-приложение на `Tauri 2 + React` для оптимизации сайтов из `ZIP`-архива или папки.

## Возможности

- Вход: `ZIP-архив` или `папка`
- Экспорт: `ZIP-архив` или `папка`
- Оптимизация изображений (`png`, `jpg`, `jpeg`, `gif`) в `webp`, только если файл становится меньше
- Оптимизация видео (`mp4`, `webm`) без смены формата, только если размер уменьшается
- Конвертация `ogv` в `webm`, только если это уменьшает размер
- Обновление ссылок на медиа в коде
- Подробный отчет с визуальной аналитикой
- Быстрый пакетный режим для нескольких сайтов
- RU / EN интерфейс
- Автообновление через GitHub Releases (Tauri Updater)

## Что нужно для сборки из исходного кода

- `Node.js`
- `npm`
- `Rust` (stable)
- `Microsoft Visual Studio C++ Build Tools` (или Visual Studio с Desktop C++ workload)
- `WebView2`

## Сборка из исходного кода

1. Установить зависимости:

```powershell
npm install
```

2. Собрать приложение:

```powershell
npm.cmd run tauri build
```

Готовые файлы обычно появляются в:

- `src-tauri/target/release/bundle/nsis`
- `src-tauri/target/release/bundle/msi`

## Результат работы

Приложение создает:

- `<имя>_optimized.zip`
- `<имя>_optimized/`

Временная рабочая папка:

- `<имя>_optimizer_work/`
