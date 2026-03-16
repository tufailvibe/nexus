const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Print
    executeCustomPrint: (config) => ipcRenderer.invoke('execute-custom-print', config || {}),
    generateCustomPrintPdf: (config) => ipcRenderer.invoke('generate-custom-print-pdf', config || {}),
    getPrinters: () => ipcRenderer.invoke('get-printers'),

    // Database
    storeInvoke: (action, payload) => ipcRenderer.invoke('store-invoke', action, payload || {}),

    // File dialogs
    showSaveDialog: (opts) => ipcRenderer.invoke('show-save-dialog', opts || {}),
    showOpenDialog: (opts) => ipcRenderer.invoke('show-open-dialog', opts || {}),
    writeFile: (path, data) => ipcRenderer.invoke('write-file', path, data),
    saveShareCachePdf: (fileName, data) => ipcRenderer.invoke('save-share-cache-pdf', fileName, data),
    archiveSharePdf: (sourcePath, viewType, fileName) => ipcRenderer.invoke('archive-share-pdf', sourcePath, viewType, fileName),
    readFile: (path) => ipcRenderer.invoke('read-file', path),
    pathExists: (path) => ipcRenderer.invoke('path-exists', path),
    openPath: (path) => ipcRenderer.invoke('open-path', path),
    openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
    startAutoShare: (payload) => ipcRenderer.invoke('start-auto-share', payload || {}),
    showItemInFolder: (path) => ipcRenderer.invoke('show-item-in-folder', path),

    // Backup
    backupDB: () => ipcRenderer.invoke('backup-db'),
    importAllData: (data) => ipcRenderer.invoke('import-all-data', data),
    getAppPath: () => ipcRenderer.invoke('get-app-path')
});
