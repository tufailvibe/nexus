/**
 * scanner.js — USB HID Scanner (keyboard mode)
 * Detects rapid keystroke sequences ending with Enter.
 */
const Scanner = (() => {
    let buffer = '';
    let lastKeyTime = 0;
    let rapidKeyCount = 0;
    let scanCallback = null;
    let isConnected = false;
    let activeTarget = null;
    let disconnectTimer = null;

    const MAX_KEY_INTERVAL = 80;
    const MIN_BARCODE_LENGTH = 3;
    const DISCONNECT_IDLE_MS = 15000;

    function init(onScan) {
        scanCallback = onScan;
        document.addEventListener('keydown', handleKey);
        setConnected(false);
    }

    function handleKey(event) {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt') return;

        const target = event.target;
        if (!isScannerEligibleTarget(target)) {
            resetSequence();
            return;
        }

        const now = Date.now();
        const timeDiff = now - lastKeyTime;

        if (timeDiff > MAX_KEY_INTERVAL || (activeTarget && target !== activeTarget)) {
            buffer = '';
            rapidKeyCount = 0;
        } else {
            rapidKeyCount += 1;
            if (rapidKeyCount >= 3) {
                setConnected(true);
            }
        }

        if (event.key === 'Enter') {
            if (buffer.length >= MIN_BARCODE_LENGTH && rapidKeyCount >= 2) {
                event.preventDefault();
                event.stopPropagation();
                const code = buffer.trim();
                setConnected(true);
                scheduleDisconnectReset();
                resetSequence();
                if (scanCallback) scanCallback(code);
                return;
            }

            resetSequence();
            lastKeyTime = now;
            return;
        }

        if (event.key.length === 1) {
            buffer += event.key;
            activeTarget = target;
            scheduleDisconnectReset();
        }

        lastKeyTime = now;
    }

    function isScannerEligibleTarget(target) {
        if (!target || target === document.body || target === document.documentElement) {
            return true;
        }

        if (target.closest('#login-overlay, #settings-modal, #change-password-modal, #stock-adjustment-modal, #print-dialog-overlay')) {
            return false;
        }

        if (target.closest('#sell-product-search, #stocks-search, #barcode-library-search, #history-search')) {
            return false;
        }

        if (target.matches?.('input, textarea, select') || target.isContentEditable) {
            return !!target.closest('#sell-workspace, #stocks-tbody, #barcode-new-row');
        }

        return true;
    }

    function resetSequence() {
        buffer = '';
        rapidKeyCount = 0;
        activeTarget = null;
    }

    function scheduleDisconnectReset() {
        if (disconnectTimer) {
            clearTimeout(disconnectTimer);
        }

        disconnectTimer = setTimeout(() => {
            resetSequence();
            setConnected(false);
        }, DISCONNECT_IDLE_MS);
    }

    function setConnected(state) {
        isConnected = state;
        const statusEl = document.getElementById('scanner-status');
        const dot = statusEl ? statusEl.querySelector('.scanner-dot') : null;
        const label = statusEl ? statusEl.querySelector('.scanner-label') : null;
        const statusText = state ? 'Scanner active' : 'Scanner offline';

        if (dot) {
            dot.className = 'scanner-dot ' + (state ? 'connected' : 'disconnected');
        }
        if (label) {
            label.className = 'scanner-label ' + (state ? 'connected' : 'disconnected');
            label.textContent = statusText;
        }
        if (statusEl) {
            statusEl.title = statusText;
        }
    }

    return { init, setConnected };
})();
