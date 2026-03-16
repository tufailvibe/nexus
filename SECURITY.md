# Security Notes

## Scope

This repository is a public-safe source snapshot of a local-first Electron application.

## Safe publishing rules

- Do not commit generated installers, archives, or release folders.
- Do not commit `node_modules`, runtime caches, or local report output.
- Do not commit customer documents, internal PDFs, or real inventory databases.
- Do not commit Electron `userData` exports, backups, or shared-document cache files.

## Local data handling

- The application stores operational data in the local Electron profile directory.
- The bundled seed database was intentionally omitted from this public copy.
- The app can recreate its schema on first run, which keeps the repository source-only.

## Reporting a vulnerability

If you discover a security issue, do not publish sensitive details in a public issue first. Share the finding privately with the repository owner through a direct contact method attached to the GitHub profile or a private advisory workflow.
