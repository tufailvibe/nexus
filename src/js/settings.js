/**
 * settings.js — App settings management
 */
const Settings = (() => {
    const THEME_PREMIUM_LIGHT = 'premium-light';
    const THEME_GOLDEN_WHITE = 'golden-white';
    const THEME_EXECUTIVE_DARK = 'executive-dark';
    const THEME_SEQUENCE = [
        THEME_PREMIUM_LIGHT,
        THEME_GOLDEN_WHITE,
        THEME_EXECUTIVE_DARK
    ];

    function normalizePrintPresets(value) {
        const source = value && typeof value === 'object' ? value : {};
        const items = Array.isArray(source.items) ? source.items : [];
        const selectedByView = source.selectedByView && typeof source.selectedByView === 'object'
            ? source.selectedByView
            : {};

        return {
            items: items
                .map((item) => ({
                    id: String(item?.id || '').trim(),
                    viewType: String(item?.viewType || '').trim(),
                    name: String(item?.name || '').trim(),
                    settings: item?.settings && typeof item.settings === 'object' ? item.settings : {}
                }))
                .filter((item) => item.id && item.viewType && item.name),
            selectedByView: {
                invoice: String(selectedByView.invoice || '').trim(),
                letterhead: String(selectedByView.letterhead || '').trim(),
                barcode: String(selectedByView.barcode || '').trim()
            }
        };
    }

    function normalizeTheme(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'dark' || normalized === THEME_EXECUTIVE_DARK) {
            return THEME_EXECUTIVE_DARK;
        }
        if (normalized === THEME_GOLDEN_WHITE || normalized === 'golden' || normalized === 'gold') {
            return THEME_GOLDEN_WHITE;
        }
        return THEME_PREMIUM_LIGHT;
    }

    function isDarkTheme(value = settings.theme) {
        return normalizeTheme(value) === THEME_EXECUTIVE_DARK;
    }

    function getThemeDisplayName(value = settings.theme) {
        const normalized = normalizeTheme(value);
        if (normalized === THEME_GOLDEN_WHITE) {
            return 'Golden White';
        }
        if (normalized === THEME_EXECUTIVE_DARK) {
            return 'Executive Dark';
        }
        return 'Premium Light';
    }

    function getNextTheme(value = settings.theme) {
        const normalized = normalizeTheme(value);
        const currentIndex = THEME_SEQUENCE.indexOf(normalized);
        if (currentIndex < 0) {
            return THEME_SEQUENCE[0];
        }
        return THEME_SEQUENCE[(currentIndex + 1) % THEME_SEQUENCE.length];
    }

    let settings = {
        printers: { invoicePrinter: '', barcodePrinter: '' },
        autoSerial: { onScan: true, onBarcodeGen: false },
        theme: THEME_PREMIUM_LIGHT,
        backupSchedule: 'daily',
        invoiceFormat: 'INV-{NUM}',
        sessionTimeoutMinutes: 0,
        printPresets: normalizePrintPresets()
    };
    let pendingImportData = null;
    let controlsBound = false;

    async function init() {
        await loadSettings();
        applyTheme();
        updateThemeButton();
        updateThemeMenuButton();
        bindSettingsControls();

        document.getElementById('btn-manage-settings')?.addEventListener('click', openSettingsModal);
        initImportReviewControls();
    }

    async function loadSettings() {
        const keys = ['printers', 'autoSerial', 'theme', 'backupSchedule', 'invoiceFormat', 'sessionTimeoutMinutes', 'printPresets'];
        for (const key of keys) {
            const val = await Persistence.getSetting(`settings_${key}`);
            if (val) {
                try { settings[key] = JSON.parse(val); } catch (_) { settings[key] = val; }
            }
        }

        settings.printPresets = normalizePrintPresets(settings.printPresets);
        settings.theme = normalizeTheme(settings.theme);

        const invoiceFormat = await Persistence.getSetting('invoice_format');
        if (invoiceFormat) {
            settings.invoiceFormat = invoiceFormat;
        }
    }

    async function saveSetting(key, value) {
        settings[key] = key === 'printPresets' ? normalizePrintPresets(value) : value;
        await Persistence.setSetting(`settings_${key}`, typeof value === 'object' ? JSON.stringify(value) : value);
    }

    function getSettings() { return settings; }

    function getPrintPresets() {
        return normalizePrintPresets(settings.printPresets);
    }

    async function savePrintPresets(value) {
        const normalized = normalizePrintPresets(value);
        await saveSetting('printPresets', normalized);
    }

    function applyTheme() {
        settings.theme = normalizeTheme(settings.theme);
        document.documentElement.setAttribute('data-theme', settings.theme);
        const themeStyle = document.getElementById('settings-theme-style');
        if (themeStyle) {
            themeStyle.value = settings.theme;
        }
    }

    function bindSettingsControls() {
        if (controlsBound) return;
        controlsBound = true;

        document.getElementById('settings-invoice-printer')?.addEventListener('change', async (event) => {
            await saveSetting('printers', {
                ...settings.printers,
                invoicePrinter: event.target.value
            });
        });

        document.getElementById('settings-barcode-printer')?.addEventListener('change', async (event) => {
            await saveSetting('printers', {
                ...settings.printers,
                barcodePrinter: event.target.value
            });
        });

        document.getElementById('settings-autoserial-scan')?.addEventListener('change', async (event) => {
            await saveSetting('autoSerial', {
                ...settings.autoSerial,
                onScan: !!event.target.checked
            });
        });

        document.getElementById('settings-autoserial-gen')?.addEventListener('change', async (event) => {
            await saveSetting('autoSerial', {
                ...settings.autoSerial,
                onBarcodeGen: !!event.target.checked
            });
        });

        document.getElementById('settings-invoice-format')?.addEventListener('change', async (event) => {
            await saveSetting('invoiceFormat', event.target.value);
            await Persistence.setSetting('invoice_format', event.target.value);
        });

        document.getElementById('settings-session-timeout')?.addEventListener('change', async (event) => {
            const minutes = Math.max(0, parseInt(event.target.value, 10) || 0);
            await saveSetting('sessionTimeoutMinutes', minutes);
            if (typeof Login !== 'undefined' && typeof Login.refreshSessionTimeout === 'function') {
                Login.refreshSessionTimeout();
            }
        });

        document.getElementById('settings-theme-style')?.addEventListener('change', async (event) => {
            settings.theme = normalizeTheme(event.target.value);
            await saveSetting('theme', settings.theme);
            applyTheme();
            updateThemeButton();
            updateThemeMenuButton();
        });

        document.getElementById('settings-export-btn')?.addEventListener('click', exportBackup);
        document.getElementById('settings-import-btn')?.addEventListener('click', importBackup);
        document.getElementById('settings-backup-now')?.addEventListener('click', () => {
            void createBackupNow();
        });
    }

    async function toggleTheme() {
        settings.theme = getNextTheme(settings.theme);
        await saveSetting('theme', settings.theme);
        applyTheme();
        updateThemeButton();
        updateThemeMenuButton();
    }

    function updateThemeButton() {
        const btn = document.getElementById('theme-toggle');
        if (!btn) return;
        const currentTheme = normalizeTheme(settings.theme);
        const nextTheme = getNextTheme(currentTheme);
        const symbols = {
            [THEME_PREMIUM_LIGHT]: 'PL',
            [THEME_GOLDEN_WHITE]: 'GW',
            [THEME_EXECUTIVE_DARK]: 'ED'
        };
        btn.textContent = symbols[currentTheme] || 'PL';
        btn.title = `Current theme: ${getThemeDisplayName(currentTheme)} | Next: ${getThemeDisplayName(nextTheme)}`;
    }

    function updateThemeMenuButton() {
        const menuBtn = document.getElementById('btn-toggle-theme');
        if (menuBtn) {
            const nextTheme = getNextTheme(settings.theme);
            menuBtn.textContent = `Switch to ${getThemeDisplayName(nextTheme)}`;
            menuBtn.title = `Current theme: ${getThemeDisplayName()}`;
        }
    }

    async function openSettingsModal() {
        const modal = document.getElementById('settings-modal');
        if (!modal) return;

        // Detect printers
        let printers = [];
        if (window.electronAPI?.getPrinters) {
            printers = await window.electronAPI.getPrinters();
        }

        const invoiceSelect = document.getElementById('settings-invoice-printer');
        const barcodeSelect = document.getElementById('settings-barcode-printer');

        if (invoiceSelect && barcodeSelect) {
            const optsHTML = '<option value="">System Default</option>' +
                printers.map(p => `<option value="${esc(p.name)}">${esc(p.displayName)}${p.isDefault ? ' (Default)' : ''}</option>`).join('');
            invoiceSelect.innerHTML = optsHTML;
            barcodeSelect.innerHTML = optsHTML;
            invoiceSelect.value = (settings.printers || {}).invoicePrinter || '';
            barcodeSelect.value = (settings.printers || {}).barcodePrinter || '';
        }

        // Auto-serial toggles
        const scanToggle = document.getElementById('settings-autoserial-scan');
        const genToggle = document.getElementById('settings-autoserial-gen');
        if (scanToggle) {
            scanToggle.checked = (settings.autoSerial || {}).onScan !== false;
        }
        if (genToggle) {
            genToggle.checked = (settings.autoSerial || {}).onBarcodeGen === true;
        }

        // Invoice format
        const fmtInput = document.getElementById('settings-invoice-format');
        if (fmtInput) {
            fmtInput.value = settings.invoiceFormat || 'INV-{NUM}';
        }

        const sessionTimeout = document.getElementById('settings-session-timeout');
        if (sessionTimeout) {
            sessionTimeout.value = String(Math.max(0, parseInt(settings.sessionTimeoutMinutes, 10) || 0));
        }

        const themeStyle = document.getElementById('settings-theme-style');
        if (themeStyle) {
            themeStyle.value = normalizeTheme(settings.theme);
        }

        App?.showModal?.(modal);
    }

    async function createBackupNow() {
        const r = await Persistence.createBackup();
        Notification.show(
            r.success ? 'Backup created!' : 'Backup failed: ' + r.error,
            r.success ? 'success' : 'error'
        );
    }

    function initImportReviewControls() {
        document.getElementById('import-review-cancel')?.addEventListener('click', closeImportReviewModal);
        document.getElementById('import-review-confirm')?.addEventListener('click', () => {
            void confirmImportBackup();
        });
        document.querySelector('#import-review-modal .modal-close')?.addEventListener('click', closeImportReviewModal);
    }

    async function exportBackup() {
        if (!window.electronAPI) { Notification.show('Export requires the desktop app.', 'warning'); return; }
        const result = await window.electronAPI.showSaveDialog({
            title: 'Export Backup',
            defaultPath: `Al_Ghanim_Nexus_Backup_${new Date().toISOString().slice(0, 10)}.json`,
            filters: [{ name: 'JSON Files', extensions: ['json'] }]
        });
        if (result.canceled || !result.filePath) return;

        const allData = await Persistence.exportAllData();
        const json = JSON.stringify(allData, null, 2);
        const writeResult = await window.electronAPI.writeFile(result.filePath, json);
        Notification.show(writeResult.success ? 'Backup exported!' : 'Export failed: ' + writeResult.error, writeResult.success ? 'success' : 'error');
    }

    async function importBackup() {
        if (!window.electronAPI) { Notification.show('Import requires the desktop app.', 'warning'); return; }
        const result = await window.electronAPI.showOpenDialog({
            title: 'Import Backup',
            filters: [{ name: 'JSON Files', extensions: ['json'] }]
        });
        if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;

        const readResult = await window.electronAPI.readFile(result.filePaths[0]);
        if (!readResult.success) { Notification.show('Import failed: ' + readResult.error, 'error'); return; }

        try {
            const data = JSON.parse(readResult.data);
            const preview = await Persistence.previewImportData(data);
            pendingImportData = data;
            renderImportPreview(preview);
            const modal = document.getElementById('import-review-modal');
            if (modal) {
                App?.showModal?.(modal);
            }
        } catch (e) {
            Notification.show('Invalid backup: ' + e.message, 'error');
        }
    }

    function closeImportReviewModal() {
        pendingImportData = null;
        const modal = document.getElementById('import-review-modal');
        if (modal) {
            App?.hideModal?.(modal);
        }
    }

    function renderImportPreview(preview) {
        const summary = document.getElementById('import-review-summary');
        const details = document.getElementById('import-review-details');
        if (!summary || !details) return;

        const totals = preview?.totals || { total: 0, inserts: 0, updates: 0, unchanged: 0 };
        summary.innerHTML = [
            ['Incoming Records', totals.total],
            ['New Inserts', totals.inserts],
            ['Updates', totals.updates],
            ['Unchanged', totals.unchanged]
        ].map(([label, value]) => `
            <div class="import-review-card">
                <div class="import-review-card-label">${esc(String(label))}</div>
                <div class="import-review-card-value">${esc(String(value))}</div>
            </div>
        `).join('');

        details.innerHTML = (preview?.categories || []).map((category) => {
            const stats = `${category.inserts} insert · ${category.updates} update · ${category.unchanged} unchanged`;
            const sampleMarkup = category.samples.length
                ? category.samples.map((sample) => `
                    <div class="import-review-sample">
                        <span class="import-review-sample-badge ${esc(sample.status)}">${esc(sample.status)}</span>
                        <span>${esc(sample.label)}</span>
                    </div>
                `).join('')
                : '<div class="import-review-empty">No records in this section.</div>';

            return `
                <section class="import-review-section">
                    <div class="import-review-section-header">
                        <div class="import-review-section-title">${esc(category.label)}</div>
                        <div class="import-review-section-stats">${esc(stats)}</div>
                    </div>
                    <div class="import-review-sample-list">${sampleMarkup}</div>
                </section>
            `;
        }).join('');
    }

    async function confirmImportBackup() {
        if (!pendingImportData) {
            closeImportReviewModal();
            return;
        }

        try {
            await Persistence.importAllData(pendingImportData);
            await loadSettings();
            Notification.show('Backup imported! Reloading...', 'success');
            location.reload();
        } catch (error) {
            Notification.show('Import failed: ' + error.message, 'error');
        } finally {
            closeImportReviewModal();
        }
    }

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }

    return {
        init,
        getSettings,
        getPrintPresets,
        savePrintPresets,
        toggleTheme,
        updateThemeButton,
        openSettingsModal,
        exportBackup,
        importBackup
    };
})();
