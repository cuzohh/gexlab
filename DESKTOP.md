# Desktop Build

GEXLAB can now be packaged as a local desktop app instead of only running in a browser.

## What was added

- Electron desktop shell that opens the React UI in a native window.
- Background startup for the FastAPI backend on a local loopback port.
- PyInstaller build step that turns the Python backend into `gexlab-backend.exe` for packaging.
- NSIS installer output through `electron-builder`.
- Branded app icons in `desktop/assets`.
- Cross-platform targets for macOS and Linux in the Electron Builder config.

## Build a downloadable installer

1. Install the new desktop dependencies at the repo root: `npm install`
2. Install backend packaging support in your backend virtual environment: `backend\venv\Scripts\python.exe -m pip install pyinstaller`
3. Make sure the backend requirements are installed: `backend\venv\Scripts\python.exe -m pip install -r backend\requirements.txt`
4. Build the installer: `npm run desktop:build`

The Windows installer is written to `desktop-dist\GEXLAB-Setup-1.0.0.exe`.

## Cross-platform targets

- Windows: `nsis`
- macOS: `dmg`, `zip`
- Linux: `AppImage`, `deb`

Windows can be built directly from this machine. macOS and Linux targets are configured, but they should be built and validated on those platforms or in CI.

## Run from source as an app window

1. Build the frontend once: `npm run desktop:build:frontend`
2. Start the desktop shell: `run_desktop_app.bat`

For source mode, the Electron shell will use `backend\venv\Scripts\python.exe` when it exists, otherwise it falls back to `python` on `PATH`.
