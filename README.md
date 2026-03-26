# Site Optimizer v0.4.4

Desktop app on Tauri 2 + React for optimizing website image assets from a ZIP archive or a folder.

The app can:
- open a site from a `.zip` archive or a folder
- convert supported images to `webp` when it is actually beneficial
- rewrite image references in code
- review the result before export
- export as a new ZIP or folder
- run quick batch optimization for multiple sites

## Features

- Input modes: `ZIP archive` or `Folder`
- Export modes: `ZIP archive` or `Folder`
- Quick batch optimization for multiple sites
- Context menu integration on Windows:
  - `Оптимизировать сайт`
  - `Быстро оптимизировать сайт`
- Optional safe cleanup:
  - remove unused images
  - deduplicate identical images by content
- RU / EN interface
- Update prompt support through GitHub Releases + Tauri Updater
- In-app update progress with status, speed, and ETA

## Image handling

Supported input formats:
- `png`
- `jpg`
- `jpeg`
- `gif`

Optimization rules:
- images are converted to `webp`
- animated `gif` is kept as original if converted `webp` is larger
- suspicious or dynamic references are skipped instead of blindly rewritten
- collisions like `image.png` and `image.jpg` are handled safely so they do not overwrite each other

## How It Works

### Standard mode

1. Select a ZIP archive or a folder.
2. The app prepares a working copy.
3. Images are scanned, optimized and references are updated.
4. You review the result.
5. Export to ZIP or folder.

### Quick mode

1. Select multiple sites or use the Windows context menu quick action.
2. Sites are processed one by one automatically.
3. Results are saved next to the originals.
4. Quick launches can auto-close shortly after showing the result summary.

## Context Menu

The installer can add Windows context menu entries for:
- ZIP archives
- folders

You can also enable or disable them later from the app settings via the gear button near the build version.

## Auto Updates

The app is prepared for auto updates through GitHub Releases using the Tauri updater plugin.

Important:
- update signing is required
- the private signing key must stay secret
- the public key is stored in app config

## Project Structure

```text
site-optimizer/
├── src/
│   ├── App.tsx
│   └── App.css
├── sidecar/
│   ├── optimizer.js
│   ├── package.json
│   └── node_modules/
├── src-tauri/
│   ├── src/main.rs
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── windows-installer-hooks.nsh
│   └── capabilities/default.json
├── package.json
└── README.md
```

## Development

Install frontend dependencies:

```powershell
npm install
```

Run in development:

```powershell
npm.cmd run tauri dev
```

Build release:

```powershell
npm.cmd run tauri build
```

## Signed Build For Updates

Before building updater-enabled releases:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = ".\src-tauri\signing\site-optimizer.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "your-password"
npm.cmd run tauri build
```

## Security Note

Do not commit:
- `src-tauri/signing/site-optimizer.key`
- any private signing key
- any private password

The `src-tauri/signing/` folder is already ignored in git.

## Output

The app creates:
- `<name>_optimized.zip`
- `<name>_optimized/`

Temporary working directories use:
- `<name>_optimizer_work/`

## Current Version

`v0.4.2`
