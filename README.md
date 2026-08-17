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
- [Node.js](https://nodejs.org/) 18+ installed on a **Windows machine**

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

Don't want to install Node or build locally? Let GitHub build the `.exe` for you:

1. **Create a GitHub repo** (github.com → New repository). It can be private.
2. **Push this project** to it:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
3. GitHub automatically runs the workflow in `.github/workflows/build-windows.yml` on a Windows machine.
4. Go to the repo's **Actions** tab → click the latest run → scroll to **Artifacts** → download **`Jot-Windows-Installer`**.
5. Unzip it, then double-click `JotSetup.exe` to install.

You can also trigger a build manually anytime: **Actions** tab → *Build Windows App* → **Run workflow**.

The workflow produces two artifacts:
- **Jot-Windows-Installer** — the `.exe` installer
- **Jot-Windows-Portable** — a zipped app you can run without installing

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
