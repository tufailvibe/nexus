# Nexus - Local-First Desktop Operations App

`Nexus` is a Windows desktop application built for day-to-day business operations. It brings inventory management, invoice generation, barcode workflows, PDF output, and local backup tools into a single offline-first Electron app.

This repository is a public portfolio mirror of the project. Client-specific branding, private reference material, and production data are intentionally masked or omitted, while the core architecture, workflows, and validation setup remain available for review.

Core business workflows run locally on the machine with no cloud dependency. Operational data is stored in Electron `userData`, not inside the repository.

## Overview

Nexus was built to replace a fragmented manual workflow at a small business. The goal was to provide one reliable desktop application for day-to-day operations:

- stock management
- invoice and rapid order sheet creation
- barcode generation and reprint workflows
- print-ready PDF output
- local backup and restore

The result is a self-contained Electron application with local persistence through `SQL.js`, Windows packaging through `electron-builder`, and automated validation through a Playwright-based headless test harness.

This repository contains the source snapshot used for technical review and portfolio presentation.

## What The App Does

### Inventory Management

- Add, edit, search, archive, and restore stock items
- Track stock movement history
- Update stock via manual edits and barcode-assisted flows
- Keep operational records locally on the machine

### Invoice And Order Documents

- Generate professional invoices from stock items
- Create rapid order sheet documents
- Support multi-page document workflows
- Export documents to PDF for print and sharing

### Barcode Generation And Reprint

- Generate barcode labels for products
- Maintain a local barcode reprint library
- Sync barcode card data with stock records
- Print barcode labels directly from the desktop app

### Print And PDF Workflows

- Print preview before final output
- Save print-ready PDFs locally
- Support different document layouts and printer targets

### Backup And Restore

- Export full JSON backups for restore workflows
- Import exported backups back into the app
- Create local raw database snapshots for emergency recovery

### Local-First Storage

- Uses a local SQLite-compatible database via `SQL.js`
- Database is created automatically on first launch
- App data lives in Electron `userData`
- No bundled production database is committed to this repository

## Screenshot

![Login preview](docs/screenshots/login-preview.png)

Additional offline notes are available in [docs/OFFLINE_REVIEW.md](docs/OFFLINE_REVIEW.md).

## Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop shell | Electron |
| Runtime | Node.js |
| Frontend | Vanilla JavaScript, HTML, CSS |
| Local database | SQL.js |
| Barcode generation | bwip-js |
| PDF handling | pdfjs-dist |
| Build system | electron-builder |
| Windows installer | NSIS |
| Validation tooling | Playwright headless harness |

## Project Structure

```text
app-main/        Electron main process, preload bridge, IPC, and local backend logic
src/             Renderer HTML, CSS, assets, and frontend JavaScript
scripts/         Build, metadata, and packaging helper scripts
build/           App icon and build assets
tools/headless/  Headless testing and runtime audit tooling
docs/            Offline review notes and sanitized screenshots
```

## Getting Started

### Prerequisites

- Node.js
- npm
- Windows environment for installer builds

### Run In Development

```powershell
npm install
npm start
```

## Build Windows Installer

```powershell
npm run build:win:x64
```

## Run Validation

```powershell
npm --prefix tools/headless install
npm test
npm run audit
```

## Review Notes

- This repository contains source code only.
- Generated installers, `node_modules`, local databases, test output, and temporary runtime artifacts are excluded.
- The app auto-creates its local database structure on first launch.
- Some client-specific assets, names, and reference files are intentionally masked or omitted for privacy.
- Core workflows are local-first. Some optional share actions may open external apps or web services, but they are not required for the main inventory, invoice, barcode, print, and backup workflows.

## Author

Mohd Tufail Khan
[github.com/tufailvibe](https://github.com/tufailvibe)
