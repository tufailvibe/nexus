/**
 * login.js — Single-user login with optional password
 * Uses custom modal dialogs instead of native prompt/alert.
 */
const Login = (() => {
    const DEFAULT_USER = 'admin';
    const PASSWORD_HASH_PREFIX = 'sha256:';
    const SESSION_ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart'];
    let passwordModalControlsBound = false;
    let passwordFlowMode = 'change';
    let sessionTimeoutHandle = null;
    let sessionActivityBound = false;

    async function init() {
        const form = document.getElementById('login-form');
        if (form) {
            form.addEventListener('submit', handleLogin);
        }
        bindPasswordModalControls();

        showLogin();

        if (await needsInitialPasswordSetup()) {
            openPasswordModal({ mode: 'setup' });
            return;
        }

        const remembered = await checkRememberedSession();
        if (remembered) {
            showApp();
        }
    }

    async function handleLogin(event) {
        event.preventDefault();
        const username = document.getElementById('login-username')?.value || '';
        const password = document.getElementById('login-password')?.value || '';
        const remember = document.getElementById('login-remember')?.checked || false;
        const errorEl = document.getElementById('login-error');

        if (errorEl) {
            errorEl.textContent = '';
            errorEl.classList.remove('shake');
        }

        const storedUser = await Persistence.getSetting('username') || DEFAULT_USER;
        const verification = await verifyPassword(password);

        if (!verification.initialized) {
            if (errorEl) {
                errorEl.textContent = 'Set an admin password before signing in.';
            }
            openPasswordModal({ mode: 'setup' });
            return;
        }

        if (username === storedUser && verification.success) {
            await migratePasswordIfNeeded(verification);
            await Persistence.setSetting('remembered_session', remember ? 'true' : 'false');
            showApp();
            return;
        }

        if (errorEl) {
            errorEl.textContent = 'Invalid credentials. Please try again.';
            errorEl.classList.add('shake');
            setTimeout(() => errorEl.classList.remove('shake'), 500);
        }
        document.getElementById('login-password')?.focus();
    }

    async function needsInitialPasswordSetup() {
        const hasPassword = await Persistence.getSetting('has_password');
        const storedHash = await Persistence.getSetting('password_hash');
        const storedPlain = await Persistence.getSetting('password');
        return hasPassword == null && !storedHash && storedPlain == null;
    }

    async function checkRememberedSession() {
        const val = await Persistence.getSetting('remembered_session');
        return val === 'true';
    }

    function showLogin() {
        stopSessionWatch();
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-container').style.display = 'none';
    }

    function showApp() {
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        if (typeof App !== 'undefined' && App.init) {
            Promise.resolve(App.init()).finally(() => {
                refreshSessionTimeout();
            });
            return;
        }
        refreshSessionTimeout();
    }

    async function logout() {
        await Persistence.setSetting('remembered_session', 'false');
        stopSessionWatch();
        showLogin();
        document.getElementById('login-password')?.focus();
    }

    function bindSessionActivity() {
        if (sessionActivityBound) return;
        sessionActivityBound = true;
        SESSION_ACTIVITY_EVENTS.forEach((eventName) => {
            document.addEventListener(eventName, () => {
                refreshSessionTimeout();
            }, true);
        });
    }

    function getSessionTimeoutMinutes() {
        return Math.max(0, parseInt(Settings?.getSettings?.().sessionTimeoutMinutes, 10) || 0);
    }

    function stopSessionWatch() {
        if (sessionTimeoutHandle) {
            clearTimeout(sessionTimeoutHandle);
            sessionTimeoutHandle = null;
        }
    }

    function scheduleSessionTimeout() {
        stopSessionWatch();
        const timeoutMinutes = getSessionTimeoutMinutes();
        const appVisible = document.getElementById('app-container')?.style.display === 'flex';
        if (!timeoutMinutes || !appVisible) return;

        sessionTimeoutHandle = setTimeout(() => {
            void handleSessionTimeout();
        }, timeoutMinutes * 60 * 1000);
    }

    async function handleSessionTimeout() {
        stopSessionWatch();
        await Persistence.setSetting('remembered_session', 'false');
        showLogin();
        document.getElementById('login-error')?.replaceChildren(document.createTextNode('Session timed out. Sign in again.'));
        document.getElementById('login-password')?.focus();
        if (typeof Notification !== 'undefined' && typeof Notification.show === 'function') {
            Notification.show('Session timed out. Sign in again.', 'warning');
        }
    }

    function refreshSessionTimeout() {
        bindSessionActivity();
        scheduleSessionTimeout();
    }

    async function changePassword() {
        openPasswordModal({ mode: 'change' });
    }

    function bindPasswordModalControls() {
        if (passwordModalControlsBound) return;
        passwordModalControlsBound = true;

        document.getElementById('cp-save-btn')?.addEventListener('click', () => {
            void saveChangedPassword();
        });
        document.getElementById('cp-cancel-btn')?.addEventListener('click', closePasswordModal);
        document.getElementById('cp-modal-close')?.addEventListener('click', closePasswordModal);
    }

    function openPasswordModal({ mode }) {
        passwordFlowMode = mode || 'change';
        const modal = document.getElementById('change-password-modal');
        const title = document.getElementById('cp-modal-title');
        const helper = document.getElementById('cp-helper');
        const newPassInput = document.getElementById('cp-new-password');
        const confirmPassInput = document.getElementById('cp-confirm-password');
        const errorEl = document.getElementById('cp-error');
        const cancelBtn = document.getElementById('cp-cancel-btn');
        const closeBtn = document.getElementById('cp-modal-close');

        if (!modal) return;

        if (title) {
            title.textContent = passwordFlowMode === 'setup' ? 'Set Admin Password' : 'Change Password';
        }
        if (helper) {
            helper.textContent = passwordFlowMode === 'setup'
                ? 'First run requires an admin password before the app can be used.'
                : 'Leave the password blank only if you want password-free login.';
        }
        if (newPassInput) {
            newPassInput.value = '';
            newPassInput.placeholder = passwordFlowMode === 'setup'
                ? 'Create admin password'
                : 'Enter new password (leave empty to disable)';
        }
        if (confirmPassInput) {
            confirmPassInput.value = '';
            confirmPassInput.placeholder = passwordFlowMode === 'setup'
                ? 'Confirm admin password'
                : 'Confirm new password';
        }
        if (errorEl) {
            errorEl.textContent = '';
        }
        if (cancelBtn) {
            cancelBtn.style.display = passwordFlowMode === 'setup' ? 'none' : 'inline-flex';
        }
        if (closeBtn) {
            closeBtn.style.display = passwordFlowMode === 'setup' ? 'none' : 'inline-flex';
        }

        App?.showModal?.(modal);
        newPassInput?.focus();
    }

    function closePasswordModal() {
        if (passwordFlowMode === 'setup') return;
        const modal = document.getElementById('change-password-modal');
        if (modal) {
            App?.hideModal?.(modal);
        }
    }

    async function saveChangedPassword() {
        const modal = document.getElementById('change-password-modal');
        const newPassInput = document.getElementById('cp-new-password');
        const confirmPassInput = document.getElementById('cp-confirm-password');
        const errorEl = document.getElementById('cp-error');

        const newPass = newPassInput?.value || '';
        const confirmPass = confirmPassInput?.value || '';

        if (newPass !== confirmPass) {
            if (errorEl) errorEl.textContent = 'Passwords do not match.';
            return;
        }

        if (passwordFlowMode === 'setup' && newPass.trim().length < 4) {
            if (errorEl) errorEl.textContent = 'Use at least 4 characters for the admin password.';
            return;
        }

        if (passwordFlowMode === 'change' && newPass.trim() !== '' && newPass.trim().length < 4) {
            if (errorEl) errorEl.textContent = 'Use at least 4 characters or leave it blank to disable.';
            return;
        }

        if (newPass === '') {
            await Persistence.setSetting('has_password', 'false');
            await Persistence.setSetting('password', '');
            await Persistence.setSetting('password_hash', '');
        } else {
            await Persistence.setSetting('has_password', 'true');
            await Persistence.setSetting('password', '');
            await Persistence.setSetting('password_hash', await hashPassword(newPass));
        }

        if (modal) {
            App?.hideModal?.(modal);
        }

        if (passwordFlowMode === 'setup') {
            showLogin();
            Notification.show('Admin password created. Sign in to continue.', 'success');
            document.getElementById('login-password')?.focus();
            return;
        }

        Notification.show('Password updated successfully!', 'success');
    }

    async function hashPassword(password) {
        const encoded = new TextEncoder().encode(String(password || ''));
        const digest = await window.crypto.subtle.digest('SHA-256', encoded);
        const hash = Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
        return `${PASSWORD_HASH_PREFIX}${hash}`;
    }

    async function getPasswordState() {
        const hasPassword = await Persistence.getSetting('has_password');
        const storedHash = await Persistence.getSetting('password_hash');
        const storedPlain = await Persistence.getSetting('password');

        if (hasPassword == null && !storedHash && storedPlain == null) {
            return { initialized: false, enabled: false };
        }

        if (hasPassword === 'false') {
            return { initialized: true, enabled: false };
        }

        if (storedHash) {
            return { initialized: true, enabled: true, hash: storedHash };
        }

        return {
            initialized: true,
            enabled: true,
            plainText: storedPlain != null ? storedPlain : ''
        };
    }

    async function verifyPassword(inputPassword) {
        const state = await getPasswordState();
        if (!state.initialized) {
            return { success: false, initialized: false, needsMigration: false };
        }

        if (!state.enabled) {
            return { success: inputPassword === '', initialized: true, needsMigration: false };
        }

        if (state.hash) {
            const inputHash = await hashPassword(inputPassword);
            return { success: inputHash === state.hash, initialized: true, needsMigration: false };
        }

        const success = inputPassword === state.plainText;
        return {
            success,
            initialized: true,
            needsMigration: success,
            plainText: state.plainText
        };
    }

    async function migratePasswordIfNeeded(verification) {
        if (!verification?.needsMigration) return;
        await Persistence.setSetting('has_password', verification.plainText === '' ? 'false' : 'true');
        await Persistence.setSetting('password', '');
        await Persistence.setSetting('password_hash', await hashPassword(verification.plainText));
    }

    return { init, logout, changePassword, showApp, verifyPassword, refreshSessionTimeout };
})();
