const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');
const { createHeadlessMain } = require('./headless-main');
const { startStaticServer } = require('./static-server');

const BROWSER_CANDIDATES = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);

function ensureProjectRoot() {
    return path.resolve(__dirname, '..', '..', '..');
}

function findBrowserExecutable() {
    for (const candidate of BROWSER_CANDIDATES) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    throw new Error('No local Chromium browser found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH if needed.');
}

function convertPdfOptions(options = {}) {
    const margins = options.margins && options.margins.marginType === 'custom'
        ? {
            top: `${options.margins.top || 0}mm`,
            right: `${options.margins.right || 0}mm`,
            bottom: `${options.margins.bottom || 0}mm`,
            left: `${options.margins.left || 0}mm`
        }
        : { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' };

    return {
        format: typeof options.pageSize === 'string' ? options.pageSize : 'A4',
        landscape: !!options.landscape,
        printBackground: options.printBackground !== false,
        preferCSSPageSize: options.preferCSSPageSize !== false,
        displayHeaderFooter: !!options.displayHeaderFooter,
        scale: typeof options.scale === 'number' ? options.scale : 1,
        margin: margins
    };
}

function ensureHtmlBase(htmlContent, baseHref) {
    if (/<base\s/i.test(htmlContent || '')) {
        return htmlContent;
    }

    if (/<head[^>]*>/i.test(htmlContent || '')) {
        return htmlContent.replace(/<head([^>]*)>/i, `<head$1><base href="${baseHref}">`);
    }

    return `<!DOCTYPE html><html><head><base href="${baseHref}"></head><body>${htmlContent || ''}</body></html>`;
}

function summarizeValue(value, depth = 0) {
    if (depth >= 2) {
        if (Array.isArray(value)) return `[array:${value.length}]`;
        if (value && typeof value === 'object') return '[object]';
    }

    if (Buffer.isBuffer(value)) {
        return { type: 'buffer', bytes: value.length };
    }
    if (value instanceof Uint8Array) {
        return { type: 'uint8array', bytes: value.length };
    }
    if (Array.isArray(value)) {
        return value.slice(0, 8).map((entry) => summarizeValue(entry, depth + 1));
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .slice(0, 12)
                .map(([key, entry]) => [key, summarizeValue(entry, depth + 1)])
        );
    }
    if (typeof value === 'string' && value.length > 240) {
        return `${value.slice(0, 237)}...`;
    }
    return value;
}

function createTelemetryMarker(telemetry, printerJobs) {
    return {
        consoleMessages: telemetry.consoleMessages.length,
        httpErrors: telemetry.httpErrors.length,
        ipcCalls: telemetry.ipcCalls.length,
        pageErrors: telemetry.pageErrors.length,
        requestFailures: telemetry.requestFailures.length,
        printerJobs: printerJobs.length
    };
}

async function createHarness() {
    const projectRoot = ensureProjectRoot();
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invento-headless-'));
    const server = await startStaticServer(projectRoot);
    const electronMain = await createHeadlessMain(projectRoot, profileDir);
    const browser = await chromium.launch({
        executablePath: findBrowserExecutable(),
        headless: true,
        args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check']
    });
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1100 }
    });
    const page = await context.newPage();
    const printerJobs = [];
    const externalActions = [];
    const pageErrors = [];
    const telemetry = {
        consoleMessages: [],
        requestFailures: [],
        httpErrors: [],
        ipcCalls: [],
        pageErrors
    };

    page.on('pageerror', error => {
        pageErrors.push(error);
    });

    page.on('console', message => {
        telemetry.consoleMessages.push({
            type: message.type(),
            text: message.text(),
            location: message.location(),
            createdAt: new Date().toISOString()
        });
    });

    page.on('requestfailed', request => {
        telemetry.requestFailures.push({
            url: request.url(),
            method: request.method(),
            resourceType: request.resourceType(),
            failureText: request.failure() ? request.failure().errorText : 'Request failed',
            createdAt: new Date().toISOString()
        });
    });

    page.on('response', response => {
        if (response.status() < 400) return;
        telemetry.httpErrors.push({
            url: response.url(),
            status: response.status(),
            statusText: response.statusText(),
            createdAt: new Date().toISOString()
        });
    });

    await page.exposeFunction('__electronInvoke', async ({ channel, args }) => {
        const startedAt = Date.now();
        try {
            const result = await electronMain.invoke(channel, ...(args || []));
            telemetry.ipcCalls.push({
                channel,
                args: summarizeValue(args || []),
                durationMs: Date.now() - startedAt,
                success: !(result && result.success === false),
                result: summarizeValue(result),
                createdAt: new Date().toISOString()
            });
            return result;
        } catch (error) {
            telemetry.ipcCalls.push({
                channel,
                args: summarizeValue(args || []),
                durationMs: Date.now() - startedAt,
                success: false,
                error: error.message || String(error),
                createdAt: new Date().toISOString()
            });
            throw error;
        }
    });

    await page.addInitScript(() => {
        const invoke = (channel, ...args) => window.__electronInvoke({ channel, args });
        window.electronAPI = {
            executeCustomPrint: (config) => invoke('execute-custom-print', config || {}),
            generateCustomPrintPdf: (config) => invoke('generate-custom-print-pdf', config || {}),
            getPrinters: () => invoke('get-printers'),
            storeInvoke: (action, payload) => invoke('store-invoke', action, payload || {}),
            showSaveDialog: (opts) => invoke('show-save-dialog', opts || {}),
            showOpenDialog: (opts) => invoke('show-open-dialog', opts || {}),
            writeFile: (filePath, data) => invoke('write-file', filePath, data),
            saveShareCachePdf: (fileName, data) => invoke('save-share-cache-pdf', fileName, data),
            archiveSharePdf: (sourcePath, viewType, fileName) => invoke('archive-share-pdf', sourcePath, viewType, fileName),
            readFile: (filePath) => invoke('read-file', filePath),
            pathExists: (filePath) => invoke('path-exists', filePath),
            openPath: (filePath) => invoke('open-path', filePath),
            openExternalUrl: (url) => invoke('open-external-url', url),
            startAutoShare: (payload) => invoke('start-auto-share', payload || {}),
            showItemInFolder: (filePath) => invoke('show-item-in-folder', filePath),
            backupDB: () => invoke('backup-db'),
            importAllData: (data) => invoke('import-all-data', data),
            getAppPath: () => invoke('get-app-path')
        };

        window.alert = () => undefined;
        window.confirm = () => true;
        window.print = () => undefined;
    });

    async function withPrintDocumentPage(htmlContent, task) {
        const printPage = await context.newPage({
            viewport: { width: 1440, height: 1100 }
        });

        try {
            const hydratedHtml = ensureHtmlBase(htmlContent, `${server.origin}/src/`);
            await printPage.setContent(hydratedHtml, { waitUntil: 'load' });
            await printPage.evaluate(async () => {
                const imageTasks = Array.from(document.images || []).map((image) => {
                    const loadTask = image.complete
                        ? Promise.resolve()
                        : new Promise((resolve) => {
                            image.addEventListener('load', resolve, { once: true });
                            image.addEventListener('error', resolve, { once: true });
                        });
                    const decodeTask = typeof image.decode === 'function'
                        ? image.decode().catch(() => undefined)
                        : Promise.resolve();
                    return Promise.allSettled([loadTask, decodeTask]);
                });

                if (document.fonts && document.fonts.ready) {
                    try {
                        await document.fonts.ready;
                    } catch (_) { }
                }

                await Promise.allSettled(imageTasks);
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            });

            return await task(printPage);
        } finally {
            await printPage.close();
        }
    }

    electronMain.attachPageBridge({
        async getPrinters() {
            return [
                { name: 'Headless Printer', displayName: 'Headless Printer', isDefault: true, status: 0 },
                { name: 'Thermal Label Printer', displayName: 'Thermal Label Printer', isDefault: false, status: 0 }
            ];
        },
        async print(printOptions, htmlContent) {
            await withPrintDocumentPage(htmlContent, async () => undefined);
            printerJobs.push({
                type: 'print',
                options: printOptions,
                createdAt: new Date().toISOString()
            });
            return { success: true };
        },
        async printToPDF(printOptions, htmlContent) {
            const buffer = await withPrintDocumentPage(htmlContent, async (printPage) => {
                try {
                    return await printPage.pdf(convertPdfOptions(printOptions));
                } catch (error) {
                    if (!/Printing failed/i.test(String(error && error.message))) {
                        throw error;
                    }
                    await printPage.waitForTimeout(150);
                    return printPage.pdf(convertPdfOptions(printOptions));
                }
            });
            printerJobs.push({
                type: 'pdf',
                options: printOptions,
                bytes: buffer.length,
                createdAt: new Date().toISOString()
            });
            return buffer;
        },
        async openExternal(url) {
            externalActions.push({
                type: 'openExternal',
                url,
                createdAt: new Date().toISOString()
            });
            return { success: true };
        },
        async showItemInFolder(filePath) {
            externalActions.push({
                type: 'showItemInFolder',
                filePath,
                createdAt: new Date().toISOString()
            });
            return { success: true };
        },
        async openPath(filePath) {
            externalActions.push({
                type: 'openPath',
                filePath,
                createdAt: new Date().toISOString()
            });
            return { success: true };
        }
    });

    async function gotoApp() {
        await page.goto(`${server.origin}/src/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#login-form');
    }

    async function login(username = 'admin', password = 'test-admin') {
        const setupModalVisible = await page.locator('#change-password-modal').evaluate((modal) => {
            return !!modal && getComputedStyle(modal).display !== 'none';
        }).catch(() => false);

        if (setupModalVisible) {
            await page.fill('#cp-new-password', password);
            await page.fill('#cp-confirm-password', password);
            await page.click('#cp-save-btn');
            await page.waitForFunction(() => {
                const modal = document.getElementById('change-password-modal');
                return !!modal && getComputedStyle(modal).display === 'none';
            });
        }

        await page.fill('#login-username', username);
        await page.fill('#login-password', password);
        await page.click('#login-form button[type="submit"]');
        await page.waitForFunction(() => {
            const overlay = document.getElementById('login-overlay');
            const app = document.getElementById('app-container');
            return overlay && app && overlay.style.display === 'none' && app.style.display === 'flex';
        });
        await page.waitForSelector('#sell-workspace .invoice-pages-wrapper');
    }

    async function assertNoFatalError() {
        const fatalText = await getFatalErrorText();

        if (fatalText) {
            throw new Error(`Fatal error overlay shown:\n${fatalText}`);
        }

        if (pageErrors.length > 0) {
            throw pageErrors[0];
        }
    }

    async function getFatalErrorText() {
        const locator = page.locator('#fatal-error');
        if (!(await locator.count())) {
            return '';
        }
        return locator.evaluate(element => {
            const style = window.getComputedStyle(element);
            return style.display === 'none' ? '' : element.textContent.trim();
        });
    }

    async function getTelemetrySince(marker = createTelemetryMarker(telemetry, printerJobs)) {
        return {
            consoleMessages: telemetry.consoleMessages.slice(marker.consoleMessages),
            requestFailures: telemetry.requestFailures.slice(marker.requestFailures),
            httpErrors: telemetry.httpErrors.slice(marker.httpErrors),
            ipcCalls: telemetry.ipcCalls.slice(marker.ipcCalls),
            pageErrors: telemetry.pageErrors.slice(marker.pageErrors).map(error => ({
                message: error.message,
                stack: error.stack || ''
            })),
            printerJobs: printerJobs.slice(marker.printerJobs),
            fatalErrorText: await getFatalErrorText()
        };
    }

    async function cleanup() {
        await new Promise(resolve => setTimeout(resolve, 300));
        await electronMain.dispose();
        await context.close();
        await browser.close();
        await server.close();
        fs.rmSync(profileDir, { recursive: true, force: true });
    }

    return {
        browser,
        context,
        electronMain,
        gotoApp,
        login,
        page,
        printerJobs,
        externalActions,
        profileDir,
        projectRoot,
        queueOpenDialog: (value) => electronMain.queueOpenDialog(value),
        queueSaveDialog: (value) => electronMain.queueSaveDialog(value),
        queueMessageBox: (value) => electronMain.queueMessageBox(value),
        createTelemetryMarker: () => createTelemetryMarker(telemetry, printerJobs),
        getTelemetrySince,
        assertNoFatalError,
        cleanup
    };
}

module.exports = {
    createHarness
};
