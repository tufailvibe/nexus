/**
 * notification.js - Low-stock notifications
 */
const NotificationManager = (() => {
    const LOW_STOCK_THRESHOLD = 5;
    let notifications = [];

    function getNotificationQty(product) {
        if (typeof StockHelpers !== 'undefined' && typeof StockHelpers.parsePackQtyValue === 'function') {
            const parsed = StockHelpers.parsePackQtyValue(product?.pack_qty_text);
            if (parsed != null) {
                return Math.max(0, parsed);
            }
        }

        return 0;
    }

    function init() {
        const bell = document.getElementById('notification-bell');
        const dropdown = document.getElementById('notification-dropdown');
        if (bell) {
            bell.addEventListener('click', toggleDropdown);
        }
        if (dropdown) {
            dropdown.addEventListener('click', (event) => {
                void handleDropdownClick(event);
            });
        }
        document.addEventListener('click', (event) => {
            if (!dropdown || !bell) return;
            if (!dropdown.contains(event.target) && !bell.contains(event.target)) {
                dropdown.classList.remove('open');
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && dropdown) {
                dropdown.classList.remove('open');
            }
        });
    }

    function checkLowStock(products) {
        notifications = (Array.isArray(products) ? products : [])
            .map((product) => ({
                ...product,
                _notificationQty: getNotificationQty(product)
            }))
            .filter((product) => product?.id && product?.barcode && product._notificationQty < LOW_STOCK_THRESHOLD)
            .map((product) => ({
                type: product._notificationQty <= 0 ? 'critical' : 'warning',
                productId: product.id || null,
                barcode: product.barcode,
                title: product.name_en || product.barcode,
                meta: `${product._notificationQty} left - reorder at ${LOW_STOCK_THRESHOLD}`
            }))
            .sort((left, right) => {
                if (left.type === right.type) {
                    return String(left.title || '').localeCompare(String(right.title || ''));
                }
                return left.type === 'critical' ? -1 : 1;
            });
        updateBadge();
    }

    function updateBadge() {
        const badge = document.getElementById('notification-badge');
        if (badge) {
            badge.style.display = notifications.length > 0 ? 'block' : 'none';
            badge.textContent = notifications.length;
        }
    }

    function toggleDropdown() {
        const dropdown = document.getElementById('notification-dropdown');
        if (!dropdown) return;

        const isOpen = dropdown.classList.contains('open');
        if (isOpen) {
            dropdown.classList.remove('open');
            return;
        }

        dropdown.innerHTML = notifications.length === 0
            ? '<div class="notif-item" style="text-align:center;color:var(--text-muted)">No notifications</div>'
            : notifications.map((notification) => `
        <button class="notif-item notif-item-action" type="button" data-action="open-low-stock" data-product-id="${escapeHtml(String(notification.productId || ''))}">
          <span class="notif-item-title" style="color:${notification.type === 'critical' ? '#e74c3c' : '#f39c12'}">
            ${notification.type === 'critical' ? '&#128308;' : '&#128993;'} ${escapeHtml(notification.title)}
          </span>
          <span class="notif-item-meta">${escapeHtml(notification.barcode)} - ${escapeHtml(notification.meta)}</span>
        </button>`).join('') +
            '<button class="notif-clear" data-action="clear-notifications">Clear All</button>';

        dropdown.classList.add('open');
    }

    async function handleDropdownClick(event) {
        const clearButton = event.target.closest('[data-action="clear-notifications"]');
        if (clearButton) {
            event.preventDefault();
            clearAll();
            return;
        }

        const openButton = event.target.closest('[data-action="open-low-stock"]');
        if (!openButton) return;

        event.preventDefault();
        const productId = String(openButton.dataset.productId || '').trim();
        const dropdown = document.getElementById('notification-dropdown');
        if (dropdown) dropdown.classList.remove('open');

        if (typeof App !== 'undefined' && typeof App.switchMode === 'function') {
            App.switchMode('stocks');
        }
        if (typeof Stocks !== 'undefined' && typeof Stocks.focusProduct === 'function') {
            await Stocks.focusProduct(productId);
        }
    }

    function clearAll() {
        notifications = [];
        updateBadge();
        const dropdown = document.getElementById('notification-dropdown');
        if (dropdown) dropdown.classList.remove('open');
    }

    function show(message, type = 'info') {
        const toast = document.createElement('div');
        toast.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 9000;
      padding: 12px 20px; border-radius: 8px; font-size: 13px; font-weight: 500;
      box-shadow: 0 10px 26px rgba(0,0,0,0.18);
      transition: opacity 220ms cubic-bezier(0.22, 1, 0.36, 1), transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
      color: #fff;
      background: ${type === 'success' ? '#27ae60' : type === 'warning' ? '#f39c12' : type === 'error' ? '#e74c3c' : '#3498db'};
      opacity: 0;
      transform: translate3d(0, 12px, 0) scale(0.985);
      will-change: opacity, transform;
    `;
        toast.textContent = message;
        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translate3d(0, 0, 0) scale(1)';
        });
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translate3d(0, 8px, 0) scale(0.988)';
            setTimeout(() => toast.remove(), 240);
        }, 3000);
    }

    function escapeHtml(value) {
        const host = document.createElement('div');
        host.textContent = value == null ? '' : String(value);
        return host.innerHTML;
    }

    return { init, checkLowStock, clearAll, show };
})();

const Notification = NotificationManager;
