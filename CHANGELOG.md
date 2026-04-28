# Changelog

## 0.5.2

- added safe video optimization support for `mp4`, `ogv`, and `webm`
- `mp4` and `webm` are optimized in-place only if the result is smaller
- `ogv` is converted to `webm` only if the result is smaller
- extended scan/report output to include supported video formats
- added an interactive video step in the normal flow: if videos are found, the user can choose `keep / mp4 / webm / gif / delete` per file
- if a site has no videos, optimization continues exactly as before without extra steps

## 0.5.0

- version bump only

## 0.4.8

- fixed quick optimization from the Windows context menu for a single site
- changed single quick launches to auto-optimize, auto-export, and close after a short delay
- refined the 10-second result countdown behavior
- continued UI cleanup for the running and updater flows

## 0.4.7

- fixed the 10-second auto-close countdown on result screens
- simplified optimization-stage control icons and aligned them with the rest of the UI
- removed installer-time context menu questions
- kept context menu management inside app settings only
- refreshed versioning and release metadata

## 0.4.5

- promoted the current stabilization build to the new release line
- keeps improved updater progress, close handling, pause controls, and auto-close flow

## 0.4.4

- added visible in-app updater progress with download state, speed, and ETA
- improved updater modal feedback during download and install
- kept update prompt recurring on each launch of older installed versions

## 0.4.3

- removed tray-first behavior and restored predictable window closing
- added close confirmation while work is still running
- added batch pause/resume controls
- added 10-second auto-close countdown after quick batch results
- improved process stopping flow for active optimization
- prepared quick launch flow for more reliable context-menu behavior

## 0.4.2

- updater validation release for in-app update flow

## 0.4.1

- added tray workflow for quick batch optimization
- quick context menu runs in tray and exits after completion
- regular context menu reuses the already running app instance
- closing the main window now hides the app to tray
- added settings button near the build version
- added in-app toggles for Windows context menu entries
- added updater foundation for GitHub Releases
- added signed update configuration scaffold
- added automatic update check on normal startup
- added update prompt UI
- improved release/documentation setup

## 0.4.0

- added single-instance app behavior
- improved quick batch flow
- improved tray-oriented launch handling
- hidden Node console window during optimization

## 0.3.0

- stabilized packaged build sidecar resolution
- improved image optimization pipeline
- added quick batch optimization
- added RU / EN UI switching
- improved review and running screens
- added Windows context menu integration
