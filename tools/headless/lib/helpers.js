const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function fillAndBlur(page, selector, value) {
    const locator = page.locator(selector);
    await locator.fill(String(value));
    await locator.blur();
    await page.waitForTimeout(120);
}

async function waitForDbRow(mainProcess, sql, params = [], predicate = (row) => row != null) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const result = await mainProcess.invoke('db-get', sql, params);
        if (result && result.success && predicate(result.data)) {
            return result.data;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
}

async function waitForSettingValue(mainProcess, key, predicate = (value) => value != null) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const result = await mainProcess.invoke(
            'db-get',
            'SELECT value FROM settings WHERE key = ?',
            [key]
        );
        if (result && result.success && result.data && predicate(result.data.value)) {
            return result.data.value;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
}

async function waitForFile(filePath) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (fs.existsSync(filePath)) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
}

async function inspectPdf(filePath, rootDir = path.join(__dirname, '..', '..', '..')) {
    const pdfJsPath = path.join(
        rootDir,
        'node_modules',
        'pdfjs-dist',
        'legacy',
        'build',
        'pdf.mjs'
    );
    const pdfjsLib = await import(pathToFileURL(pdfJsPath).href);
    const data = new Uint8Array(fs.readFileSync(filePath));
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const text = await page.getTextContent();
        pages.push(text.items.map(item => item.str).join(' '));
    }

    return {
        pageCount: pdf.numPages,
        text: pages.join('\n'),
        pages
    };
}

async function waitForPreviewReady(page) {
    await page.waitForFunction(() => {
        const frame = document.getElementById('print-preview-frame');
        return !!frame
            && !!frame.contentDocument
            && frame.contentDocument.body?.dataset?.previewReady === 'true';
    });
}

async function waitForPreviewSheetCount(page, expectedCount) {
    await page.waitForFunction((count) => {
        const frame = document.getElementById('print-preview-frame');
        const doc = frame && frame.contentDocument;
        return !!doc && doc.querySelectorAll('.print-sheet').length === count;
    }, expectedCount);
}

async function waitForPreviewSheetCountAtLeast(page, minimumCount) {
    await page.waitForFunction((count) => {
        const frame = document.getElementById('print-preview-frame');
        const doc = frame && frame.contentDocument;
        return !!doc && doc.querySelectorAll('.print-sheet').length >= count;
    }, minimumCount);
}

async function ensureAdvancedPrintSettingsVisible(page) {
    const isVisible = await page.locator('#pd-advanced-settings').evaluate(element => {
        return window.getComputedStyle(element).display !== 'none';
    });

    if (!isVisible) {
        await page.click('#pd-more-settings-toggle');
        await page.waitForFunction(() => {
            const element = document.getElementById('pd-advanced-settings');
            return !!element && window.getComputedStyle(element).display !== 'none';
        });
    }
}

async function isSelectorVisible(page, selector) {
    return page.evaluate((targetSelector) => {
        const element = document.querySelector(targetSelector);
        if (!element) return false;
        const styles = window.getComputedStyle(element);
        return styles.display !== 'none'
            && styles.visibility !== 'hidden'
            && element.getAttribute('aria-hidden') !== 'true'
            && !element.hidden;
    }, selector);
}

async function hideSelectorImmediately(page, selector) {
    await page.evaluate((targetSelector) => {
        const element = document.querySelector(targetSelector);
        if (!element) return;

        if (window.App?.hideModal) {
            window.App.hideModal(element, { immediate: true });
            return;
        }

        element.classList.remove('is-visible', 'is-closing');
        element.style.display = 'none';
        element.setAttribute('aria-hidden', 'true');
    }, selector);
}

async function dismissConfirmNewIfVisible(page) {
    const isVisible = await page.locator('#confirm-new-modal').evaluate(element => {
        return window.getComputedStyle(element).display !== 'none';
    });

    if (isVisible) {
        await page.click('#cn-discard-btn');
    }
}

async function dismissDraftRecoveryIfVisible(page) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const isVisible = await page.locator('#draft-recovery-modal').evaluate(element => {
            return window.getComputedStyle(element).display !== 'none';
        });

        if (isVisible) {
            await page.click('#draft-recovery-dismiss');
            await page.waitForSelector('#draft-recovery-modal', { state: 'hidden' });
            return;
        }

        await page.waitForTimeout(100);
    }
}

async function handleInvoiceBarcodeUpdateIfVisible(page, action = 'skip') {
    if (!(await isSelectorVisible(page, '#invoice-barcode-update-modal'))) {
        return false;
    }

    const actionSelector = {
        update: '#invoice-barcode-update-confirm',
        cancel: '#invoice-barcode-update-cancel',
        skip: '#invoice-barcode-update-skip'
    }[action] || '#invoice-barcode-update-skip';

    try {
        await page.click(actionSelector);
    } catch (_) {
        await hideSelectorImmediately(page, '#invoice-barcode-update-modal');
    }

    await page.waitForTimeout(50);
    if (await isSelectorVisible(page, '#invoice-barcode-update-modal')) {
        await hideSelectorImmediately(page, '#invoice-barcode-update-modal');
    }
    return true;
}

async function dismissModalIfVisible(page, modalSelector, dismissSelector) {
    if (!(await isSelectorVisible(page, modalSelector))) {
        return false;
    }

    try {
        await page.click(dismissSelector);
    } catch (_) {
        await hideSelectorImmediately(page, modalSelector);
    }

    await page.waitForTimeout(50);
    if (await isSelectorVisible(page, modalSelector)) {
        await hideSelectorImmediately(page, modalSelector);
    }
    return true;
}

async function resetTransientUiState(page) {
    await dismissDraftRecoveryIfVisible(page);
    await dismissConfirmNewIfVisible(page);
    await dismissModalIfVisible(page, '#template-modal', '#template-modal .modal-close');
    await dismissModalIfVisible(page, '#save-template-modal', '#save-template-modal .modal-close');
    await dismissModalIfVisible(page, '#settings-modal', '#settings-modal .modal-close');
    await handleInvoiceBarcodeUpdateIfVisible(page, 'cancel');
    await dismissModalIfVisible(page, '#stock-deduction-modal', '#deduction-cancel-btn');
    await dismissModalIfVisible(page, '#admin-override-modal', '#ao-cancel-btn');
    await dismissModalIfVisible(page, '#stock-adjustment-modal', '#stock-adjustment-cancel');
    await dismissModalIfVisible(page, '#stock-history-modal', '#stock-history-modal .modal-close');
    await dismissModalIfVisible(page, '#history-open-guard-modal', '#history-open-guard-cancel');
    await dismissModalIfVisible(page, '#print-dialog-overlay', '#pd-cancel-btn');

    await page.evaluate(() => {
        [
            { id: 'stocks-search', dispatch: true },
            { id: 'history-search', dispatch: false },
            { id: 'sell-product-search', dispatch: true },
            { id: 'barcode-library-search', dispatch: true }
        ].forEach(({ id, dispatch }) => {
            const input = document.getElementById(id);
            if (!input) return;
            input.value = '';
            if (!dispatch) return;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
    });
    await page.waitForTimeout(100);
}

module.exports = {
    dismissConfirmNewIfVisible,
    dismissDraftRecoveryIfVisible,
    ensureAdvancedPrintSettingsVisible,
    fillAndBlur,
    handleInvoiceBarcodeUpdateIfVisible,
    inspectPdf,
    resetTransientUiState,
    waitForDbRow,
    waitForFile,
    waitForPreviewReady,
    waitForPreviewSheetCount,
    waitForPreviewSheetCountAtLeast,
    waitForSettingValue
};
