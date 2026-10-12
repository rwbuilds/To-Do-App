# Jot — Windows Desktop App

A draggable, always-on-top todo & notes widget built with Electron.

## Features
- 🪟 **Real always-on-top** — stays above all other windows (even fullscreen apps)
- 🖱️ **Native dragging** — drag the widget or the title bar anywhere on screen
- 📌 **System tray** — minimize hides it to the tray; click the tray icon to bring it back
- 🚀 **Launch at Windows startup** — toggle in the title bar (🚀) or the tray menu; when auto-started it opens hidden in the tray
- 🔵 **Widget / expanded modes** — collapses to a small floating button
- ✅ Tasks with groups, WIP status, priorities, due dates, tags
- 📝 Notes with live word count
- 🗂️ Multi-select copy (numbered) and bulk delete
- 💾 Data persists locally (localStorage)

## Requirements
- [Node.js](https://nodejs.org/) 22.12 or later installed on a **Windows machine** (Electron 44 needs it)

## Run it (development)
```bash
npm install
npm start
```

## Build the Windows installer (.exe)
```bash
npm install
npm run make
```
The installer will be created at:
```
out\make\squirrel.windows\x64\JotSetup.exe
```
Double-click that `.exe` to install. The app then runs from the Start Menu and lives in your system tray.

> **Note:** The `.exe` must be built on Windows (Squirrel/Windows installer tooling requires it).
> Building on macOS/Linux requires Wine and is not recommended.

## Build in the cloud with GitHub Actions (no local setup)

Don't want to install Node or build locally? Let GitHub build the `.exe` for you.

The repo already includes `.github/workflows/build-windows.yml`. On every push to
`main` (or `master`), it builds the installer on a Windows runner and publishes a
version-tagged **GitHub Release**.

> **The repo must be public.** Auto-update relies on the free
> [update.electronjs.org](https://update.electronjs.org) service, which cannot read
> private repositories.

To ship a build:

1. Bump `version` in `package.json` **and** the `APP_VERSION` constant in `index.html`
   (keep them in sync — there's no build step wiring them together).
2. Commit and push to `main`:
   ```bash
   git add .
   git commit -m "Release vX.Y.Z"
   git push origin main
   ```
3. GitHub runs the workflow on a Windows machine. When it finishes, a new Release
   titled **`Jot vX.Y.Z`** (tag `vX.Y.Z`) appears under the repo's **Releases** section.

You can also trigger a build manually: **Actions** tab → *Build Windows App* →
**Run workflow**.

Each Release contains the Squirrel distribution files:
- **`JotSetup.exe`** — the Windows installer
- **`*.nupkg`** and **`RELEASES`** — the Squirrel update feed that `update-electron-app`
  reads to detect and apply new versions

Installed clients auto-update from the latest Release; new users download
`JotSetup.exe` from the newest Release.

## Optional: custom icon
Drop a 256×256 PNG named `icon.png` in this folder before building to set the app + tray icon. Without it, a blank tray icon is used.

## Window controls
- `🚀` — toggle "Launch at Windows startup" (bright = on, dim = off)
- `⊟` — collapse to the small widget
- `—` — minimize to system tray (hidden until you click the tray icon)
- `✕` — collapse to widget
- Tray → **Quit** to fully exit
- Tray → **Always on Top** toggle
- Tray → **Launch at Startup** toggle

## Auto-launch notes
- Uses Windows' registry Run key via Electron's built-in `setLoginItemSettings` — no extra dependency.
- When Windows starts the app automatically, it launches **hidden in the tray** (passes a `--hidden` flag). Click the tray icon to open it.
- Toggle it any time from the 🚀 title-bar button or the tray menu.
