/**
 * app.js — Application Orchestrator
 * Initializes all modules, manages mode switching, routes barcode scans
 * Wrapped in try/catch to prevent cascading initialization failures
 */
const App = (() => {
    const MODAL_HIDE_DELAY_MS = 240;
    let currentMode = 'sell';
    let initialized = false;

    function resolveModalTarget(target) {
        if (!target) return null;
        if (typeof target === 'string') {
            return document.getElementById(target);
        }
        return target;
    }

    function showModal(target) {
        const modal = resolveModalTarget(target);
        if (!modal) return null;

        if (modal.dataset.hideTimerId) {
            clearTimeout(Number(modal.dataset.hideTimerId));
            delete modal.dataset.hideTimerId;
        }

        modal.classList.remove('is-closing');
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => {
            modal.classList.add('is-visible');
        });
        return modal;
    }

    function hideModal(target, options = {}) {
        const modal = resolveModalTarget(target);
        if (!modal) return null;

        if (modal.dataset.hideTimerId) {
            clearTimeout(Number(modal.dataset.hideTimerId));
            delete modal.dataset.hideTimerId;
        }

        const finishHide = () => {
            modal.classList.remove('is-visible', 'is-closing');
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
            delete modal.dataset.hideTimerId;
        };

        if (options.immediate || getComputedStyle(modal).display === 'none') {
            finishHide();
            return modal;
        }

        modal.classList.remove('is-visible');
        modal.classList.add('is-closing');
        modal.dataset.hideTimerId = String(setTimeout(finishHide, MODAL_HIDE_DELAY_MS));
        return modal;
    }

    async function init() {
        if (initialized) return;
        initialized = true;

        normalizeUiGlyphs();

        try {
            Navigation.init();
        } catch (e) { console.error('Navigation init failed:', e); }

        try {
            KeyboardNav.init();
        } catch (e) { console.error('KeyboardNav init failed:', e); }

        try {
            NotificationManager.init();
        } catch (e) { console.error('NotificationManager init failed:', e); }

        try {
            await Settings.init();
            Settings.updateThemeButton();
        } catch (e) { console.error('Settings init failed:', e); }

        try {
            Scanner.init(handleScan);
        } catch (e) { console.error('Scanner init failed:', e); }

        try {
            await Sell.init();
        } catch (e) { console.error('Sell init failed:', e); }

        try {
            await Stocks.init();
        } catch (e) { console.error('Stocks init failed:', e); }

        try {
            if (typeof BarcodeGen !== 'undefined') {
                BarcodeGen.init();
            }
        } catch (e) { console.error('BarcodeGen init failed:', e); }

        document.querySelectorAll('.segment-btn').forEach((button) => {
            button.addEventListener('click', () => {
                currentMode = button.dataset.mode || 'sell';
                updateScanTargetBadge();
            });
        });


        // Theme toggle
        ['theme-toggle', 'btn-toggle-theme'].forEach((id) => {
            document.getElementById(id)?.addEventListener('click', () => {
                Settings.toggleTheme();
            });
        });

        // User dropdown
        const userBtn = document.getElementById('user-btn');
        const userDropdown = document.getElementById('user-dropdown');
        if (userBtn && userDropdown) {
            userBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const shouldOpen = !userDropdown.classList.contains('open');
                userDropdown.classList.toggle('open', shouldOpen);
                userBtn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
            });

            document.addEventListener('click', () => {
                userDropdown.classList.remove('open');
                userBtn.setAttribute('aria-expanded', 'false');
            });
        }

        // Modal close buttons (generic handler)
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                const modal = btn.closest('.modal-overlay');
                if (modal) hideModal(modal);
            });
        });

        // Logout button
        document.getElementById('btn-logout')?.addEventListener('click', () => {
            Login.logout();
        });

        // Change password button
        document.getElementById('btn-manage-creds')?.addEventListener('click', () => {
            Login.changePassword();
        });

        // Check low stock
        try {
            const allProducts = await Persistence.getAllProducts();
            NotificationManager.checkLowStock(allProducts);
        } catch (e) { console.error('Low stock check failed:', e); }

        updateScanTargetBadge();
    }

    function switchMode(mode) {
        if (['sell', 'barcode', 'stocks'].indexOf(mode) === -1) return;
        currentMode = mode;
        Navigation.switchMode(mode);
        updateScanTargetBadge();
    }

    async function handleScan(scanData) {
        if (!scanData) return;

        switch (getCurrentMode()) {
            case 'sell':
                await Sell.handleScan(scanData);
                break;
            case 'stocks':
                await Stocks.handleScan(scanData);
                break;
            case 'barcode':
                if (typeof BarcodeGen !== 'undefined' && typeof BarcodeGen.prefillFromScan === 'function') {
                    await BarcodeGen.prefillFromScan(scanData);
                } else {
                    const bcInput = document.getElementById('bc-new-barcode-num');
                    if (bcInput) bcInput.value = scanData;
                }
                break;
        }
    }

    function getCurrentMode() {
        const activeButton = document.querySelector('.segment-btn.active');
        return activeButton?.dataset?.mode || currentMode;
    }

    function updateScanTargetBadge() {
        const valueEl = document.getElementById('scan-target-value');
        if (!valueEl) return;

        const mode = getCurrentMode();
        let label = 'Sell / Invoice';

        if (mode === 'sell') {
            const sellView = typeof Sell !== 'undefined' && typeof Sell.getView === 'function'
                ? Sell.getView()
                : 'invoice';
            label = sellView === 'invoice' ? 'Sell / Invoice' : 'Sell / Rapid Order Sheet';
        } else if (mode === 'stocks') {
            label = 'My Stocks';
        } else if (mode === 'barcode') {
            label = 'Barcode Generator';
        }

        valueEl.textContent = label;
    }

    function normalizeUiGlyphs() {
        const iconMap = [
            ['#btn-new-doc .btn-icon', '&#128196;'],
            ['#btn-save-template .btn-icon', '&#128190;'],
            ['#btn-load-template .btn-icon', '&#128193;'],
            ['#btn-add-page .btn-icon', '&#9776;'],
            ['.sell-search-icon', '&#128269;'],
            ['#btn-print-doc .btn-icon', '&#128424;'],
            ['#barcode-gen-btn .btn-icon', '+'],
            ['#barcode-print-btn .btn-icon', '&#128424;'],
            ['#stocks-add-row .btn-icon', '+'],
            ['#stocks-archive-selected .btn-icon', '&#128465;'],
            ['#stocks-remove-drafts .btn-icon', '&#10005;'],
            ['#stocks-view-history .btn-icon', '&#128340;']
        ];

        iconMap.forEach(([selector, markup]) => {
            const node = document.querySelector(selector);
            if (node) node.innerHTML = markup;
        });

        const saveModalTitle = document.getElementById('save-template-modal-title');
        if (saveModalTitle) saveModalTitle.textContent = 'Save Document';

        const saveModalLabel = document.querySelector('#save-template-modal label');
        if (saveModalLabel) saveModalLabel.textContent = 'Document Name';

        const saveModalInput = document.getElementById('st-template-name');
        if (saveModalInput) saveModalInput.placeholder = 'Enter document name';
    }

    return {
        init, switchMode, handleScan, refreshScanTarget: updateScanTargetBadge,
        showModal, hideModal
    };
})();

// ── Bootstrap: Login first, then App.init() is called from Login.showApp() ──
document.addEventListener('DOMContentLoaded', () => {
    Login.init();
});
