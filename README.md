# nnexus

Recruiter-safe GitHub mirror for the **Al Ghanim Nexus** Electron desktop application.

This copy is intentionally separated from the working project so the original workspace stays untouched. The repository includes the core source code, build configuration, local screenshots, and validation tooling, while leaving out generated installers, `node_modules`, temporary artifacts, local reports, reference PDFs, and the bundled seed database.

## What the app does

- Creates invoice and rapid order sheet documents in a desktop workflow.
- Generates and prints barcode labels.
- Manages local stock records with movement history.
- Supports local print and PDF export flows.
- Keeps operational data on the machine in Electron `userData`, not inside the repo.

## Why this repo is safe to publish

- No packaged `.exe` files are included.
- No `node_modules` folders are included.
- No private reference PDFs are included.
- No local database snapshot is included.
- No test report output or temporary runtime data is included.

On first launch, the app creates its local SQLite database structure automatically. The public repo stays source-only.

## Offline review

Everything needed to review the project structure is in this repository, including local docs and screenshots:

![Login preview](docs/screenshots/login-preview.png)

![Authenticated preview](docs/screenshots/login-preview-auth.png)

Additional offline notes are available in `docs/OFFLINE_REVIEW.md`.

## Tech stack

- Electron
- Vanilla JavaScript
- SQL.js
- bwip-js
- pdfjs-dist
- Playwright-based headless validation tooling

## Project structure

```text
app-main/        Electron main-process and IPC code
src/             Renderer HTML, CSS, and JS
scripts/         Packaging helper scripts
build/           App icon and build assets
tools/headless/  Headless validation harness
docs/            Offline review notes and screenshots
```

## Run locally

```powershell
npm install
npm start
```

## Build Windows installer

```powershell
npm run build:win:x64
```

## Run validation

```powershell
npm --prefix tools/headless install
npm test
npm run audit
```

## Notes for reviewers

- This is a source snapshot prepared for portfolio and recruiter review.
- Some client-specific reference material was intentionally not copied into this public-safe folder.
- The included documentation is written to remain readable even without an active internet connection.
