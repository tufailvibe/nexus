const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

function normalizeBufferLike(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
    if (Array.isArray(value)) return Buffer.from(value);
    if (value && Array.isArray(value.data)) return Buffer.from(value.data);
    if (value && typeof value === 'object' && typeof value.length === 'number') {
        return Buffer.from(Array.from(value));
    }
    if (typeof value === 'string') return value;
    return Buffer.from([]);
}

function toSerializable(value) {
    if (Buffer.isBuffer(value)) {
        return { type: 'buffer', data: Array.from(value) };
    }
    if (value instanceof Uint8Array) {
        return { type: 'buffer', data: Array.from(value) };
    }
    return value;
}

function ensureDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function defaultSavePath(profileDir, defaultPath) {
    const targetName = path.basename(defaultPath || 'output.bin');
    const targetPath = path.join(profileDir, 'dialog-output', targetName);
    ensureDir(targetPath);
    return targetPath;
}

function createDialogController(profileDir) {
    const saveQueue = [];
    const openQueue = [];
    const messageQueue = [];
    const history = {
        open: [],
        save: [],
        message: []
    };

    return {
        queueSaveDialog(result) {
            if (typeof result === 'string') {
                saveQueue.push({ canceled: false, filePath: result });
                return;
            }
            saveQueue.push(result);
        },
        queueOpenDialog(result) {
            if (typeof result === 'string') {
                openQueue.push({ canceled: false, filePaths: [result] });
                return;
            }
            openQueue.push(result);
        },
        queueMessageBox(result) {
            if (typeof result === 'number') {
                messageQueue.push({ response: result });
                return;
            }
            messageQueue.push(result);
        },
        async showSaveDialog(_window, options = {}) {
            const result = saveQueue.shift() || {
                canceled: false,
                filePath: defaultSavePath(profileDir, options.defaultPath)
            };
            history.save.push({ options, result });
            return result;
        },
        async showOpenDialog(_window, options = {}) {
            const result = openQueue.shift() || { canceled: true, filePaths: [] };
            history.open.push({ options, result });
            return result;
        },
        async showMessageBox(_window, options = {}) {
            const result = messageQueue.shift() || { response: 0 };
            history.message.push({ options, result });
            return result;
        },
        history
    };
}

async function createHeadlessMain(projectRoot, profileDir) {
    const mainPath = path.join(projectRoot, 'app-main', 'main.js');
    const source = fs.readFileSync(mainPath, 'utf8');
    const realRequire = createRequire(mainPath);
    const ipcHandlers = new Map();
    const appHandlers = new Map();
    const windows = [];
    const dialogController = createDialogController(profileDir);

    let startupPromise = Promise.resolve();
    let pageBridge = {
        async getPrinters() {
            return [
                {
                    name: 'Headless Printer',
                    displayName: 'Headless Printer',
                    isDefault: true,
                    status: 0
                }
            ];
        },
        async print() {
            return { success: true };
        },
        async printToPDF() {
            throw new Error('Headless page bridge not attached.');
        },
        async openExternal() {
            return { success: true };
        },
        async showItemInFolder() {
            return { success: true };
        },
        async openPath() {
            return { success: true };
        },
        async executeJavaScript() {
            return true;
        }
    };

    class BrowserWindowMock {
        constructor(options = {}) {
            this.options = options;
            this.filePath = null;
            this.url = null;
            this.htmlContent = '';
            this.destroyed = false;
            this.listeners = new Map();
            this.webContents = {
                print: (printOptions, callback) => {
                    Promise.resolve(pageBridge.print(printOptions, this.htmlContent || ''))
                        .then(result => {
                            const success = !result || result.success !== false;
                            callback(success, result && result.error ? result.error : '');
                        })
                        .catch(error => callback(false, error.message));
                },
                printToPDF: (printOptions) => pageBridge.printToPDF(printOptions, this.htmlContent || ''),
                getPrintersAsync: () => pageBridge.getPrinters(),
                executeJavaScript: (script) => pageBridge.executeJavaScript(script, this.htmlContent || '')
            };
            windows.push(this);
        }

        loadFile(filePath) {
            this.filePath = filePath;
            try {
                if (fs.existsSync(filePath) && path.extname(filePath).toLowerCase() === '.html') {
                    this.htmlContent = fs.readFileSync(filePath, 'utf8');
                }
            } catch (_) {
                this.htmlContent = '';
            }
            return Promise.resolve();
        }

        loadURL(url) {
            this.url = url;
            if (typeof url === 'string' && url.startsWith('data:text/html')) {
                const commaIndex = url.indexOf(',');
                this.htmlContent = commaIndex >= 0 ? decodeURIComponent(url.slice(commaIndex + 1)) : '';
            } else {
                this.htmlContent = '';
            }
            return Promise.resolve();
        }

        on(eventName, handler) {
            this.listeners.set(eventName, handler);
        }

        isDestroyed() {
            return this.destroyed;
        }

        destroy() {
            if (this.destroyed) return;
            this.destroyed = true;
            const handler = this.listeners.get('closed');
            const index = windows.indexOf(this);
            if (index >= 0) windows.splice(index, 1);
            if (handler) handler();
        }

        close() {
            const handler = this.listeners.get('close');
            if (handler) {
                let prevented = false;
                handler({
                    preventDefault() {
                        prevented = true;
                    }
                });
                if (prevented) {
                    return;
                }
            }
            this.destroy();
        }

        static getAllWindows() {
            return windows.slice();
        }
    }

    const app = {
        getPath(name) {
            if (name === 'userData') return profileDir;
            return profileDir;
        },
        whenReady() {
            return {
                then(onFulfilled, onRejected) {
                    startupPromise = Promise.resolve().then(onFulfilled, onRejected);
                    return startupPromise;
                }
            };
        },
        on(eventName, handler) {
            if (!appHandlers.has(eventName)) appHandlers.set(eventName, []);
            appHandlers.get(eventName).push(handler);
        },
        quit() {
            return undefined;
        }
    };

    const ipcMain = {
        handle(channel, handler) {
            ipcHandlers.set(channel, handler);
        }
    };

    const dialog = {
        showSaveDialog: (...args) => dialogController.showSaveDialog(...args),
        showOpenDialog: (...args) => dialogController.showOpenDialog(...args),
        showMessageBox: (...args) => dialogController.showMessageBox(...args)
    };

    const shell = {
        openExternal: (url) => pageBridge.openExternal(url),
        showItemInFolder: (filePath) => pageBridge.showItemInFolder(filePath),
        openPath: (filePath) => pageBridge.openPath(filePath)
    };

    const electronMock = {
        app,
        BrowserWindow: BrowserWindowMock,
        ipcMain,
        dialog,
        shell
    };

    function mockRequire(specifier) {
        if (specifier === 'electron') {
            return electronMock;
        }
        return realRequire(specifier);
    }

    const context = {
        exports: {},
        module: { exports: {} },
        require: mockRequire,
        __filename: mainPath,
        __dirname: path.dirname(mainPath),
        Buffer,
        console,
        URL,
        process,
        setInterval,
        clearInterval,
        setTimeout,
        clearTimeout
    };

    const wrapped = new vm.Script(`(function (exports, require, module, __filename, __dirname) {${source}\n})`, {
        filename: mainPath
    });
    const previousRawSqlFlag = process.env.INVENTO_ENABLE_RAW_SQL_IPC;
    const previousHeadlessFlag = process.env.INVENTO_HEADLESS;
    process.env.INVENTO_ENABLE_RAW_SQL_IPC = '1';
    process.env.INVENTO_HEADLESS = '1';
    try {
        wrapped.runInNewContext(context)(context.exports, context.require, context.module, context.__filename, context.__dirname);
        await startupPromise;
    } finally {
        if (typeof previousRawSqlFlag === 'string') {
            process.env.INVENTO_ENABLE_RAW_SQL_IPC = previousRawSqlFlag;
        } else {
            delete process.env.INVENTO_ENABLE_RAW_SQL_IPC;
        }
        if (typeof previousHeadlessFlag === 'string') {
            process.env.INVENTO_HEADLESS = previousHeadlessFlag;
        } else {
            delete process.env.INVENTO_HEADLESS;
        }
    }

    async function invoke(channel, ...args) {
        const handler = ipcHandlers.get(channel);
        if (!handler) {
            throw new Error(`IPC handler not registered: ${channel}`);
        }

        const normalizedArgs = channel === 'write-file'
            ? (() => {
                ensureDir(args[0]);
                return [args[0], normalizeBufferLike(args[1])];
            })()
            : channel === 'save-share-cache-pdf'
                ? [args[0], normalizeBufferLike(args[1])]
                : args;

        const result = await handler({}, ...normalizedArgs);
        return toSerializable(result);
    }

    async function emitAppEvent(eventName, ...args) {
        const handlers = appHandlers.get(eventName) || [];
        for (const handler of handlers) {
            await handler(...args);
        }
    }

    return {
        attachPageBridge(nextBridge) {
            pageBridge = { ...pageBridge, ...nextBridge };
        },
        invoke,
        queueSaveDialog(result) {
            dialogController.queueSaveDialog(result);
        },
        queueOpenDialog(result) {
            dialogController.queueOpenDialog(result);
        },
        queueMessageBox(result) {
            dialogController.queueMessageBox(result);
        },
        getDialogHistory() {
            return dialogController.history;
        },
        getLoadedWindowFile() {
            return windows[0] ? windows[0].filePath : null;
        },
        async dispose() {
            await emitAppEvent('window-all-closed');
        }
    };
}

module.exports = {
    createHeadlessMain
};
