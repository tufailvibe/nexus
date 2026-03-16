/**
 * keyboard-nav.js — Keyboard shortcuts and cell navigation
 */
const KeyboardNav = (() => {

    function init() {
        document.addEventListener('keydown', handleGlobalKeys);
    }

    function handleGlobalKeys(e) {
        // Don't intercept if scanner is likely typing
        if (e.target.tagName === 'INPUT' && e.target.type === 'password') return;

        const ctrl = e.ctrlKey || e.metaKey;

        // Ctrl+N: New document
        if (ctrl && e.key === 'n') {
            e.preventDefault();
            Sell.newDocument();
            return;
        }

        // Ctrl+S: Save document
        if (ctrl && e.key === 's') {
            e.preventDefault();
            Sell.saveDocument();
            return;
        }

        // Ctrl+P: Print/preview
        if (ctrl && e.key === 'p') {
            e.preventDefault();
            PrintManager.startPrintFlow(Sell.getView());
            return;
        }

        // Cell navigation within invoice table
        if (e.target.matches && e.target.matches('[contenteditable="true"]')) {
            handleCellNav(e);
        }
    }

    function handleCellNav(e) {
        const cell = e.target;
        const row = cell.closest('tr');
        const table = cell.closest('table');
        if (!row || !table) return;

        const cells = Array.from(row.querySelectorAll('[contenteditable="true"]'));
        const cellIdx = cells.indexOf(cell);
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        const rowIdx = rows.indexOf(row);

        // Enter: move to next cell (or next row first cell)
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (cellIdx < cells.length - 1) {
                cells[cellIdx + 1].focus();
            } else if (rowIdx < rows.length - 1) {
                const nextCells = rows[rowIdx + 1].querySelectorAll('[contenteditable="true"]');
                if (nextCells.length > 0) nextCells[0].focus();
            }
            return;
        }

        // Shift+Enter: move to previous cell
        if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            if (cellIdx > 0) {
                cells[cellIdx - 1].focus();
            } else if (rowIdx > 0) {
                const prevCells = rows[rowIdx - 1].querySelectorAll('[contenteditable="true"]');
                if (prevCells.length > 0) prevCells[prevCells.length - 1].focus();
            }
            return;
        }

        // Arrow Down
        if (e.key === 'ArrowDown' && !e.shiftKey) {
            if (rowIdx < rows.length - 1) {
                const nextRow = rows[rowIdx + 1];
                const nextCells = nextRow.querySelectorAll('[contenteditable="true"]');
                if (nextCells[cellIdx]) {
                    e.preventDefault();
                    nextCells[cellIdx].focus();
                }
            }
            return;
        }

        // Arrow Up
        if (e.key === 'ArrowUp' && !e.shiftKey) {
            if (rowIdx > 0) {
                const prevRow = rows[rowIdx - 1];
                const prevCells = prevRow.querySelectorAll('[contenteditable="true"]');
                if (prevCells[cellIdx]) {
                    e.preventDefault();
                    prevCells[cellIdx].focus();
                }
            }
            return;
        }

        // PageDown/PageUp for page navigation
        if (e.key === 'PageDown') {
            e.preventDefault();
            const pages = document.querySelectorAll('.inv-page, .inv-page-landscape');
            const currentPage = cell.closest('.inv-page, .inv-page-landscape');
            const pageIdx = Array.from(pages).indexOf(currentPage);
            if (pageIdx < pages.length - 1) {
                pages[pageIdx + 1].scrollIntoView({ behavior: 'smooth' });
                const firstCell = pages[pageIdx + 1].querySelector('[contenteditable="true"]');
                if (firstCell) firstCell.focus();
            }
        }

        if (e.key === 'PageUp') {
            e.preventDefault();
            const pages = document.querySelectorAll('.inv-page, .inv-page-landscape');
            const currentPage = cell.closest('.inv-page, .inv-page-landscape');
            const pageIdx = Array.from(pages).indexOf(currentPage);
            if (pageIdx > 0) {
                pages[pageIdx - 1].scrollIntoView({ behavior: 'smooth' });
                const firstCell = pages[pageIdx - 1].querySelector('[contenteditable="true"]');
                if (firstCell) firstCell.focus();
            }
        }
    }

    return { init };
})();
