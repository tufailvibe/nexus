# Chrome-Parity Print System for Electron

This module replaces the default Electron print behavior with a custom, feature-rich dialog that perfectly replicates the Google Chrome printing experience.

## Installation & Setup

1.  **Dependencies**:
    *   `pdfjs-dist`: Used for high-fidelity on-screen previews and shipped through the local project dependencies.
2.  **Files**:
    *   `src/js/print.js`: The core logic for preview generation, setting synchronization, and printer communication.
    *   `src/css/print-dialog.css`: Premium styling for the dialog, sidebar, and preview pane.
    *   `app-main/main.js`: Updated IPC handlers for binary file saving and advanced print options.

## Features

*   **Ctrl+P Support**: Use the standard browser shortcut to open the print dialog from any active workplace (Invoice or Rapid Order Sheet).
*   **Live Preview**: Real-time rendering of multiple pages. Any change in margins, scale, or layout reflects instantly.
*   **High-Quality PDF**: "Save as PDF" produces vector-perfect, high-resolution PDF files (fixing the "Save failed" and "Blank page" issues).
*   **System Printer Access**: Lists all physical printers. Supports silent printing directly to the selected destination with full options (Copies, Collate, Paper Size, etc.).
*   **Advanced Settings**:
    *   **Page Ranges**: Support for "All", "Odd", "Even", or Custom strings (e.g., `1, 3-5`).
    *   **Custom Margins**: Precise numeric control for Top, Bottom, Left, and Right.
    *   **Fit to Page**: Automatic scaling to ensure content never bleeds off the paper.

## Technical Details

*   **Headless Capture**: The system uses `webContents.printToPDF` in the background to generate a raw buffer, which is then rendered by `PDF.js`. This guarantees that the preview is 100% identical to the final physical output.
*   **Binary Safety**: The `main.js` implementation ensures that PDF buffers are written to disk without string encoding, preventing file corruption.
*   **Pagination**: The preview automatically scales and stacks multiple canvases to show the entire document, regardless of page count.

## Instructions for Use

1.  **Opening**: Press `Ctrl+P` or click the Print buttons in the "Sell" workspace.
2.  **Settings**: Adjust your desired settings in the right-hand panel. The preview will update after a short debounce delay (350ms).
3.  **Printing**:
    *   Select a printer and click **Print Document**.
    *   Select **Save as PDF** and click **Save Document**.

---
*Built for Pixel-Perfect Accuracy & Professional Utility.*
