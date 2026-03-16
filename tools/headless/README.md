# Headless Validation Harness

This tooling layer runs the real renderer and the real Electron IPC handlers without opening an Electron GUI window.

## What it does

- Starts a local static server for the project files.
- Loads `src/index.html` in headless Chromium.
- Injects `window.electronAPI` before the renderer boots.
- Reuses `app-main/main.js` IPC logic inside a mocked Electron runtime.
- Runs end-to-end tests against login, stocks, sell/invoice flows, barcode generation, settings backup/export, and print/PDF flows.

## Install

```powershell
cd tools\headless
cmd /c npm install
```

## Run

```powershell
cd tools\headless
cmd /c npm test
```

## Deep audit

```powershell
cd tools\headless
cmd /c npm run audit
```

This produces:

- `tools/headless/reports/latest-audit.md` for a human-readable audit report
- `tools/headless/reports/latest-audit.json` for structured consumption

The deep audit adds:

- feature intent tracking by interface and backing entity
- runtime telemetry for console errors, failed requests, IPC failures, print jobs, and fatal UI states
- static heuristics for maintainability and security risks
- improvement suggestions that can be approved and implemented later without coupling them to the app runtime

## Notes

- The harness prefers an existing local Chromium browser. It currently checks Chrome and Edge install locations on Windows.
- All database and exported-file state is isolated under a temporary profile directory created for each run.
- The application source files are not modified by this harness.
