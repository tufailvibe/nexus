const electron = require('electron');
if (typeof electron === 'string') {
  // Relaunch in true Electron mode when this process is forced into Node mode.
  const { spawn } = require('child_process');
  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;

  try {
    spawn(process.execPath, process.argv.slice(1), {
      stdio: 'inherit',
      windowsHide: false,
      env: cleanEnv
    });
    process.exit(0);
  } catch (err) {
    console.error('Failed to relaunch Electron:', err.message);
    process.exit(1);
  }
}
const { app, BrowserWindow, ipcMain, dialog, shell } = electron;
const path = require('path');
const fs = require('fs');
const { registerStoreIpc } = require('./store-ipc');
const { registerRawSqlIpc } = require('./debug-sql-ipc');
const { registerShareIpc } = require('./share-ipc');
const { registerImportIpc } = require('./import-ipc');
const { createAppCloseBridge } = require('./app-close-bridge');

let mainWindow;
let db;
let SQL;
const IS_HEADLESS_RUNTIME = process.env.INVENTO_HEADLESS === '1';
const allowedReadPaths = new Set();
const allowedWritePaths = new Set();
const SHARE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let allowWindowClose = false;
let closePromptInProgress = false;
const mainWindowIconPath = path.join(__dirname, '..', 'src', 'assets', 'app-icon.png');
const bundledSeedDbPath = path.join(__dirname, 'seed-data', 'invento.db');
const appCloseBridge = createAppCloseBridge({
  getMainWindow: () => mainWindow
});

function focusExistingWindow() {
  if (!mainWindow) return;
  try {
    if (typeof mainWindow.isMinimized === 'function' && mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    if (typeof mainWindow.show === 'function') {
      mainWindow.show();
    }
    if (typeof mainWindow.focus === 'function') {
      mainWindow.focus();
    }
  } catch (_) { }
}

const hasSingleInstanceSupport = typeof app.requestSingleInstanceLock === 'function';
const gotSingleInstanceLock = IS_HEADLESS_RUNTIME || !hasSingleInstanceSupport
  ? true
  : app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    focusExistingWindow();
  });
}

function normalizeFsPath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return '';
  return path.resolve(filePath);
}

function isInsideDir(targetPath, baseDir) {
  if (!targetPath || !baseDir) return false;
  const relativePath = path.relative(baseDir, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function rememberAllowedPath(collection, filePath) {
  const normalized = normalizeFsPath(filePath);
  if (normalized) {
    collection.add(normalized);
  }
  return normalized;
}

function canRendererAccessPath(filePath, mode) {
  const normalized = normalizeFsPath(filePath);
  const userDataPath = normalizeFsPath(app.getPath('userData'));
  if (!normalized) return false;
  if (isInsideDir(normalized, userDataPath)) return true;
  return mode === 'read'
    ? allowedReadPaths.has(normalized)
    : allowedWritePaths.has(normalized);
}

function getShareCacheDir() {
  return path.join(app.getPath('userData'), 'share-cache');
}

function getSharedDocumentsDir(viewType = '') {
  return path.join(app.getPath('userData'), 'shared-documents', String(viewType || 'general'));
}

function sanitizeShareFileName(fileName) {
  const baseName = String(fileName || 'document.pdf').trim() || 'document.pdf';
  const sanitized = baseName
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/g, '');
  const withExtension = sanitized.toLowerCase().endsWith('.pdf') ? sanitized : `${sanitized}.pdf`;
  return withExtension || 'document.pdf';
}

function cleanupShareCache() {
  const shareCacheDir = getShareCacheDir();
  if (!fs.existsSync(shareCacheDir)) return;

  const now = Date.now();
  fs.readdirSync(shareCacheDir, { withFileTypes: true }).forEach((entry) => {
    if (!entry.isFile()) return;

    const entryPath = path.join(shareCacheDir, entry.name);
    try {
      const stats = fs.statSync(entryPath);
      if ((now - stats.mtimeMs) > SHARE_CACHE_MAX_AGE_MS) {
        fs.unlinkSync(entryPath);
      }
    } catch (_) { }
  });
}

function sanitizeSql(sql) {
  return String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .trim();
}

function getSqlVerb(sql) {
  const normalized = sanitizeSql(sql).replace(/;+\s*$/, '').trim();
  if (!normalized) return '';
  if (normalized.includes(';')) return 'MULTI';
  return normalized.split(/\s+/)[0].toUpperCase();
}

function assertAllowedSql(sql, allowedVerbs) {
  const verb = getSqlVerb(sql);
  if (!allowedVerbs.includes(verb)) {
    throw new Error(`Disallowed SQL operation: ${verb || 'unknown'}`);
  }
  return sanitizeSql(sql);
}

function closeSqlJsDatabase(database) {
  if (database && typeof database.close === 'function') {
    try {
      database.close();
    } catch (_) { }
  }
}

function isDatabaseEffectivelyEmpty(database) {
  if (!database) return true;
  const tables = ['products', 'barcode_library', 'documents', 'templates'];

  try {
    return tables.every((tableName) => {
      const result = database.exec(`SELECT COUNT(*) AS count FROM ${tableName}`);
      const count = result?.[0]?.values?.[0]?.[0] || 0;
      return Number(count) === 0;
    });
  } catch (_) {
    return true;
  }
}

function loadBundledSeedDbBuffer() {
  if (IS_HEADLESS_RUNTIME) return null;
  try {
    if (fs.existsSync(bundledSeedDbPath)) {
      return fs.readFileSync(bundledSeedDbPath);
    }
  } catch (_) { }
  return null;
}

async function getDB() {
  if (db) return db;
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();

  const dbPath = path.join(app.getPath('userData'), 'invento.db');
  // Migration: rename old DB file if it exists
  const oldDbPath = path.join(app.getPath('userData'), 'project_a.db');
  try { if (fs.existsSync(oldDbPath) && !fs.existsSync(dbPath)) fs.renameSync(oldDbPath, dbPath); } catch (_) { }
  let fileBuffer = null;
  const seedBuffer = loadBundledSeedDbBuffer();
  try {
    if (fs.existsSync(dbPath)) {
      fileBuffer = fs.readFileSync(dbPath);
    }
  } catch (e) { /* first run */ }

  let candidateDb = fileBuffer ? new SQL.Database(fileBuffer) : null;
  if (candidateDb) {
    initDB(candidateDb);
  }

  const shouldRestoreSeed = seedBuffer && (!candidateDb || isDatabaseEffectivelyEmpty(candidateDb));
  if (shouldRestoreSeed) {
    closeSqlJsDatabase(candidateDb);
    db = new SQL.Database(seedBuffer);
    initDB(db);
    saveDBToDisk();
    return db;
  }

  db = candidateDb || new SQL.Database();
  initDB(db);
  return db;
}

function saveDBToDisk() {
  if (!db) return;
  try {
    const dbPath = path.join(app.getPath('userData'), 'invento.db');
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (e) {
    console.error('Failed to save DB to disk:', e);
  }
}

// Auto-save DB every 30 seconds
let saveInterval;

function initDB(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT UNIQUE NOT NULL,
      name_en TEXT NOT NULL DEFAULT '',
      name_ar TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      weight TEXT NOT NULL DEFAULT '',
      unit_price_fils INTEGER NOT NULL DEFAULT 0,
      product_by TEXT NOT NULL DEFAULT '',
      pack_qty_text TEXT NOT NULL DEFAULT '',
      stock_qty INTEGER NOT NULL DEFAULT 0,
      reorder_level INTEGER NOT NULL DEFAULT 5,
      display_order INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_type TEXT NOT NULL DEFAULT 'invoice',
      doc_number TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft',
      total_fils INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      document_id INTEGER,
      qty_change INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT 'sale',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (document_id) REFERENCES documents(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filepath TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      doc_type TEXT NOT NULL DEFAULT 'letterhead',
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(name, doc_type)
    );

    CREATE TABLE IF NOT EXISTS barcode_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode_number TEXT NOT NULL UNIQUE,
      format TEXT NOT NULL DEFAULT 'code128',
      name_en TEXT NOT NULL DEFAULT '',
      name_ar TEXT NOT NULL DEFAULT '',
      weight TEXT NOT NULL DEFAULT '',
      unit_price_fils INTEGER NOT NULL DEFAULT 0,
      product_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Migrations ──

  // Migrate old letterhead_templates → templates
  try {
    const oldTable = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='letterhead_templates'");
    if (oldTable.length > 0) {
      db.run(`INSERT OR IGNORE INTO templates (name, doc_type, payload, created_at, updated_at)
              SELECT name, 'letterhead', payload, created_at, updated_at FROM letterhead_templates`);
      db.run("DROP TABLE IF EXISTS letterhead_templates");
    }
  } catch (_) { /* migration already done */ }

  // Add missing columns to products if necessary
  try {
    const cols = db.exec("PRAGMA table_info(products)");
    if (cols.length > 0) {
      const colNames = cols[0].values.map(r => r[1]);
      if (!colNames.includes('product_by')) {
        db.run("ALTER TABLE products ADD COLUMN product_by TEXT NOT NULL DEFAULT ''");
      }
      if (!colNames.includes('unit_price_fils')) {
        db.run("ALTER TABLE products ADD COLUMN unit_price_fils INTEGER NOT NULL DEFAULT 0");
      }
      if (!colNames.includes('archived_at')) {
        db.run("ALTER TABLE products ADD COLUMN archived_at TEXT DEFAULT NULL");
      }
      if (!colNames.includes('pack_qty_text')) {
        db.run("ALTER TABLE products ADD COLUMN pack_qty_text TEXT NOT NULL DEFAULT ''");
      }
      if (!colNames.includes('display_order')) {
        db.run("ALTER TABLE products ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0");
      }
      db.run("UPDATE products SET display_order = id WHERE display_order IS NULL OR display_order <= 0");
    }

    const movementCols = db.exec("PRAGMA table_info(stock_movements)");
    if (movementCols.length > 0) {
      const movementColNames = movementCols[0].values.map(r => r[1]);
      if (!movementColNames.includes('note')) {
        db.run("ALTER TABLE stock_movements ADD COLUMN note TEXT NOT NULL DEFAULT ''");
      }
    }
  } catch (e) { console.error("Migration error:", e); }

  // Ensure settings exist
  const row = db.exec("SELECT value FROM settings WHERE key = 'next_invoice_number'");
  if (row.length === 0) {
    db.run("INSERT INTO settings (key, value) VALUES ('next_invoice_number', '1')");
  }
  const fmt = db.exec("SELECT value FROM settings WHERE key = 'invoice_format'");
  if (fmt.length === 0) {
    db.run("INSERT INTO settings (key, value) VALUES ('invoice_format', 'INV-{NUM}')");
  }

  saveDBToDisk();
}

function createWindow() {
  allowWindowClose = false;
  closePromptInProgress = false;
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    icon: fs.existsSync(mainWindowIconPath) ? mainWindowIconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false,
      sandbox: true
    },
    title: 'Al Ghanim Nexus - Invoice & Rapid Order Sheet',
    autoHideMenuBar: true
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  mainWindow.on('close', async (event) => {
    if (allowWindowClose || closePromptInProgress) {
      return;
    }

    event.preventDefault();
    closePromptInProgress = true;

    try {
      const closeState = await appCloseBridge.getRendererAppCloseState();
      if (!closeState?.hasPending) {
        closePromptInProgress = false;
        allowWindowClose = true;
        mainWindow.close();
        return;
      }

      const hasDirtyViews = Array.isArray(closeState.dirtyViews) && closeState.dirtyViews.length > 0;
      const buttons = hasDirtyViews
        ? ['Save Drafts and Exit', 'Discard and Exit', 'Cancel']
        : ['Keep Drafts and Exit', 'Discard Drafts and Exit', 'Cancel'];
      const message = hasDirtyViews
        ? 'Current work is not fully saved.'
        : 'Recoverable drafts are still stored.';
      const detail = String(closeState.summary || '').trim()
        || 'Choose whether to keep the draft data for the next launch or discard it now.';

      const response = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons,
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        title: 'Close Al Ghanim Nexus',
        message,
        detail
      });

      if (response.response === 2) {
        closePromptInProgress = false;
        return;
      }

      const action = response.response === 1 ? 'discard' : 'save';
      await appCloseBridge.finalizeRendererAppClose(action);
      closePromptInProgress = false;
      allowWindowClose = true;
      mainWindow.close();
    } catch (error) {
      console.error('Window close guard failed:', error);
      closePromptInProgress = false;
      allowWindowClose = true;
      mainWindow.close();
    }
  });
  mainWindow.on('closed', () => {
    allowWindowClose = false;
    closePromptInProgress = false;
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await getDB();
  createWindow();
  // Auto-save DB every 30s
  saveInterval = setInterval(saveDBToDisk, 30000);
});

app.on('window-all-closed', () => {
  clearInterval(saveInterval);
  saveDBToDisk();
  if (db) { db.close(); db = null; }
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Helper: convert sql.js result to array of objects
function resultToObjects(result) {
  if (!result || result.length === 0) return [];
  const res = result[0];
  return res.values.map(row => {
    const obj = {};
    res.columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

function resultToObject(result) {
  const arr = resultToObjects(result);
  return arr.length > 0 ? arr[0] : null;
}

function normalizeMargins(input) {
  const marginType = (input && input.marginType) || 'none';
  const mappedType = marginType === 'minimum' ? 'printableArea' : marginType;

  if (mappedType !== 'custom') {
    return { marginType: mappedType };
  }

  return {
    marginType: 'custom',
    top: Math.max(0, Number(input.top) || 0),
    bottom: Math.max(0, Number(input.bottom) || 0),
    left: Math.max(0, Number(input.left) || 0),
    right: Math.max(0, Number(input.right) || 0)
  };
}

function normalizePageSize(pageSize) {
  if (!pageSize) return 'A4';
  if (typeof pageSize === 'string') return pageSize;
  return pageSize;
}

function normalizePageRanges(pageRanges) {
  if (!Array.isArray(pageRanges) || pageRanges.length === 0) return undefined;
  return pageRanges
    .map(range => ({
      from: Math.max(0, Number(range.from) || 0),
      to: Math.max(0, Number(range.to) || 0)
    }))
    .filter(range => range.to >= range.from);
}

function createPrintableHtmlFile(htmlContent) {
  const printDir = path.join(app.getPath('userData'), 'print-jobs');
  fs.mkdirSync(printDir, { recursive: true });

  const fileName = `print_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.html`;
  const filePath = path.join(printDir, fileName);
  fs.writeFileSync(filePath, htmlContent || '', 'utf8');
  return filePath;
}

function normalizePrintConfig(input = {}) {
  return {
    htmlContent: typeof input.htmlContent === 'string' ? input.htmlContent : '',
    orientation: input.orientation === 'landscape' ? 'landscape' : 'portrait',
    color: input.color !== false,
    pageSize: normalizePageSize(input.pageSize),
    silent: !!input.silent,
    printBackground: input.printBackground ?? true,
    displayHeaderFooter: !!input.displayHeaderFooter,
    preferCSSPageSize: input.preferCSSPageSize ?? true,
    margins: normalizeMargins(input.margins),
    copies: Math.max(1, Number(input.copies) || 1),
    collate: !!input.collate,
    pagesPerSheet: Math.max(1, Number(input.pagesPerSheet) || 1),
    scale: typeof input.scale === 'number' ? input.scale : 1,
    scaleFactor: typeof input.scaleFactor === 'number'
      ? Math.max(10, Math.min(200, Math.round(input.scaleFactor)))
      : undefined,
    deviceName: typeof input.deviceName === 'string' ? input.deviceName : '',
    pageRanges: normalizePageRanges(input.pageRanges),
    pageRangesText: typeof input.pageRangesText === 'string' ? input.pageRangesText.trim() : ''
  };
}

async function waitForPrintablePage(printWindow) {
  try {
    await printWindow.webContents.executeJavaScript(`
      (async () => {
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
        return true;
      })();
    `, true);
  } catch (error) {
    console.warn('Printable page readiness check failed:', error.message || error);
  }
}

async function withPrintWindow(htmlContent, task) {
  const printWindow = new BrowserWindow({
    show: false,
    width: 1280,
    height: 960,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  let tempHtmlPath = '';

  try {
    tempHtmlPath = createPrintableHtmlFile(htmlContent);
    await printWindow.loadFile(tempHtmlPath);
    await waitForPrintablePage(printWindow);
    return await task(printWindow.webContents);
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.destroy();
    }
    if (tempHtmlPath) {
      try {
        fs.unlinkSync(tempHtmlPath);
      } catch (_) { }
    }
  }
}

function isTransientPrintToPdfError(error) {
  const message = String(error && error.message ? error.message : error || '');
  return /printing failed|print job failed|target closed|ERR_FAILED/i.test(message);
}

// ── Print ──
ipcMain.handle('execute-custom-print', async (_event, input = {}) => {
  const config = normalizePrintConfig(input);
  if (!config.htmlContent.trim()) {
    return { success: false, error: 'Printable HTML content is required.' };
  }

  const printOptions = {
    silent: config.silent,
    printBackground: config.printBackground,
    deviceName: config.silent ? config.deviceName : '',
    color: config.color,
    margins: config.margins,
    landscape: config.orientation === 'landscape',
    pagesPerSheet: config.pagesPerSheet,
    collate: config.collate,
    copies: config.copies,
    pageSize: config.pageSize
  };

  if (typeof config.scaleFactor === 'number') {
    printOptions.scaleFactor = config.scaleFactor;
  }

  if (config.pageRanges && config.pageRanges.length > 0) {
    printOptions.pageRanges = config.pageRanges;
  }

  try {
    return await withPrintWindow(config.htmlContent, (webContents) => new Promise((resolve) => {
      webContents.print(printOptions, (success, failureReason) => {
        if (success) {
          resolve({ success: true });
          return;
        }

        resolve({
          success: false,
          error: failureReason || 'Print failed.'
        });
      });
    }));
  } catch (error) {
    console.error('execute-custom-print error:', error);
    return { success: false, error: error.message || 'Print failed.' };
  }
});

ipcMain.handle('generate-custom-print-pdf', async (_event, input = {}) => {
  const config = normalizePrintConfig(input);
  if (!config.htmlContent.trim()) return null;

  const printOptions = {
    printBackground: config.printBackground,
    pageSize: config.pageSize,
    landscape: config.orientation === 'landscape',
    margins: config.margins,
    scale: config.scale,
    displayHeaderFooter: config.displayHeaderFooter,
    preferCSSPageSize: config.preferCSSPageSize
  };

  if (config.pageRangesText) {
    printOptions.pageRanges = config.pageRangesText;
  }

  try {
    return await withPrintWindow(config.htmlContent, async (webContents) => {
      let lastError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await webContents.printToPDF(printOptions);
        } catch (error) {
          lastError = error;
          if (attempt === 0 && isTransientPrintToPdfError(error)) {
            continue;
          }
          throw error;
        }
      }
      throw lastError || new Error('printToPDF failed.');
    });
  } catch (error) {
    console.error('generate-custom-print-pdf error:', error);
    return null;
  }
});

ipcMain.handle('get-printers', async () => {
  if (!mainWindow) return [];
  try {
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map(p => ({
      name: p.name,
      displayName: p.displayName || p.name,
      isDefault: p.isDefault,
      status: p.status
    }));
  } catch (e) { return []; }
});

// ── DB Operations (sql.js API) ──
registerStoreIpc({
  ipcMain,
  getDB,
  resultToObject,
  resultToObjects,
  saveDBToDisk
});

if (process.env.INVENTO_ENABLE_RAW_SQL_IPC === '1') {
  registerRawSqlIpc({
    ipcMain,
    getDB,
    assertAllowedSql,
    resultToObject,
    resultToObjects,
    saveDBToDisk
  });
}

// ── File dialogs ──
ipcMain.handle('show-save-dialog', async (_event, opts) => {
  opts = opts || {};
  const result = await dialog.showSaveDialog(mainWindow, {
    title: opts.title || 'Save File',
    defaultPath: opts.defaultPath || 'backup.json',
    filters: opts.filters || [{ name: 'JSON Files', extensions: ['json'] }]
  });
  if (result && !result.canceled && result.filePath) {
    rememberAllowedPath(allowedWritePaths, result.filePath);
  }
  return result;
});

ipcMain.handle('show-open-dialog', async (_event, opts) => {
  opts = opts || {};
  const result = await dialog.showOpenDialog(mainWindow, {
    title: opts.title || 'Open File',
    filters: opts.filters || [{ name: 'JSON Files', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (result && !result.canceled && Array.isArray(result.filePaths)) {
    result.filePaths.forEach(filePath => rememberAllowedPath(allowedReadPaths, filePath));
  }
  return result;
});

ipcMain.handle('write-file', async (_event, filePath, data) => {
  try {
    const normalized = normalizeFsPath(filePath);
    if (!canRendererAccessPath(normalized, 'write')) {
      throw new Error('Access denied for the selected save location.');
    }
    fs.mkdirSync(path.dirname(normalized), { recursive: true });
    fs.writeFileSync(normalized, data);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('save-share-cache-pdf', async (_event, fileName, data) => {
  try {
    cleanupShareCache();
    const shareCacheDir = getShareCacheDir();
    fs.mkdirSync(shareCacheDir, { recursive: true });
    const sanitizedName = sanitizeShareFileName(fileName);
    const targetPath = path.join(shareCacheDir, sanitizedName);
    const binary = Buffer.isBuffer(data)
      ? data
      : Buffer.from(
        data instanceof Uint8Array
          ? data
          : Array.isArray(data)
            ? data
            : (data && Array.isArray(data.data) ? data.data : [])
      );

    fs.writeFileSync(targetPath, binary);
    rememberAllowedPath(allowedReadPaths, targetPath);
    rememberAllowedPath(allowedWritePaths, targetPath);
    return { success: true, filePath: targetPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('archive-share-pdf', async (_event, sourcePath, viewType, fileName) => {
  try {
    const normalizedSource = normalizeFsPath(sourcePath);
    if (!normalizedSource || !fs.existsSync(normalizedSource)) {
      throw new Error('The source PDF file could not be found.');
    }
    if (!canRendererAccessPath(normalizedSource, 'read') && !canRendererAccessPath(normalizedSource, 'write')) {
      throw new Error('Access denied for the selected share PDF.');
    }

    const targetDir = getSharedDocumentsDir(viewType);
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, sanitizeShareFileName(fileName));
    fs.copyFileSync(normalizedSource, targetPath);
    rememberAllowedPath(allowedReadPaths, targetPath);
    rememberAllowedPath(allowedWritePaths, targetPath);
    return { success: true, filePath: targetPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('read-file', async (_event, filePath) => {
  try {
    const normalized = normalizeFsPath(filePath);
    if (!canRendererAccessPath(normalized, 'read')) {
      throw new Error('Access denied for the selected file.');
    }
    const data = fs.readFileSync(normalized, 'utf-8');
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Backup DB ──
ipcMain.handle('path-exists', async (_event, filePath) => {
  try {
    const normalized = normalizeFsPath(filePath);
    if (!normalized) {
      return { success: true, exists: false };
    }
    if (!canRendererAccessPath(normalized, 'read') && !canRendererAccessPath(normalized, 'write')) {
      return { success: true, exists: false };
    }
    return {
      success: true,
      exists: fs.existsSync(normalized)
    };
  } catch (e) {
    return { success: false, error: e.message, exists: false };
  }
});

ipcMain.handle('open-path', async (_event, filePath) => {
  try {
    const normalized = normalizeFsPath(filePath);
    if (!normalized) {
      throw new Error('A file path is required.');
    }
    if (!canRendererAccessPath(normalized, 'read') && !canRendererAccessPath(normalized, 'write')) {
      throw new Error('Access denied for the requested file.');
    }
    const errorMessage = await shell.openPath(normalized);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('backup-db', async () => {
  try {
    saveDBToDisk();
    const backupDir = path.join(app.getPath('userData'), 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `backup_${ts}.db`);
    const srcPath = path.join(app.getPath('userData'), 'invento.db');
    fs.copyFileSync(srcPath, backupPath);
    const stats = fs.statSync(backupPath);

    const database = await getDB();
    database.run("INSERT INTO backups (filepath, size_bytes) VALUES (?, ?)", [backupPath, stats.size]);
    saveDBToDisk();

    // Cleanup old backups (keep last 30)
    const allBackups = resultToObjects(database.exec("SELECT id, filepath FROM backups ORDER BY created_at DESC"));
    if (allBackups.length > 30) {
      const toDelete = allBackups.slice(30);
      for (const b of toDelete) {
        try { fs.unlinkSync(b.filepath); } catch (_) { }
        database.run("DELETE FROM backups WHERE id = ?", [b.id]);
      }
      saveDBToDisk();
    }
    return { success: true, path: backupPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

registerShareIpc({
  ipcMain,
  shell,
  normalizeFsPath,
  canRendererAccessPath,
  isHeadlessRuntime: IS_HEADLESS_RUNTIME
});

registerImportIpc({
  ipcMain,
  getDB,
  resultToObject,
  saveDBToDisk
});

ipcMain.handle('get-app-path', () => app.getPath('userData'));
