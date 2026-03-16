/**
 * stocks.js - My Stocks CRUD plus stock movement history.
 */
const Stocks = (() => {
    const ADJUSTMENT_REASON_LABELS = {
        sale: 'Sale deduction',
        'stock-scan': 'Scanner stock-in',
        'manual-adjustment': 'Manual adjustment',
        'manual-count': 'Stock count correction',
        'supplier-restock': 'Supplier restock',
        'customer-return': 'Customer return',
        'damage-loss': 'Damage / loss',
        'opening-stock': 'Opening stock'
    };
    let items = [];
    let searchTerm = '';
    let currentHistoryProductId = null;
    let showArchived = false;
    let pendingAdjustment = null;
    let adjustmentModalBound = false;
    let saveStatusTimer = null;
    let saveStatus = {
        state: 'idle',
        message: 'Changes save automatically'
    };
    const {
        createStockItem,
        normalizeStockItem,
        parsePackQtyValue,
        setPackQtyValue,
        adjustPackQtyText,
        isArchived,
        identifyItem,
        getEffectiveDisplayOrder,
        getNextDisplayOrder: getNextDisplayOrderForItems
    } = StockHelpers;

    async function init() {
        ensureToolbarControls();
        document.getElementById('stocks-add-row')?.addEventListener('click', addRow);
        document.getElementById('stocks-delete-selected')?.addEventListener('click', removeSelected);
        document.getElementById('stocks-restore-selected')?.addEventListener('click', restoreSelected);
        document.getElementById('stocks-view-history')?.addEventListener('click', openSelectedHistory);
        bindAdjustmentModal();
        document.getElementById('stocks-search')?.addEventListener('input', (event) => {
            searchTerm = event.target.value || '';
            render();
        });
        document.getElementById('stocks-show-archived')?.addEventListener('change', async (event) => {
            showArchived = !!event.target.checked;
            await loadItems({ preserveSelection: true });
            render();
        });
        document.getElementById('stocks-toggle-archived')?.addEventListener('click', async () => {
            showArchived = !showArchived;
            const archivedCheckbox = document.getElementById('stocks-show-archived');
            if (archivedCheckbox) {
                archivedCheckbox.checked = showArchived;
            }
            await loadItems({ preserveSelection: true });
            render();
        });
        document.getElementById('stocks-select-all')?.addEventListener('change', toggleSelectAll);

        await loadItems();
        render();
        syncNotifications();
    }

    function getNextDisplayOrder() {
        return getNextDisplayOrderForItems(items);
    }

    function getStockQuantityValue(product) {
        const parsed = parsePackQtyValue(product?.pack_qty_text);
        return Math.max(0, parsed == null ? 0 : parsed);
    }

    function syncItemQuantityMirror(item) {
        item.stock_qty = getStockQuantityValue(item);
        return item;
    }

    function adjustItemQuantityText(item, qtyDelta) {
        item.pack_qty_text = adjustPackQtyText(item.pack_qty_text, qtyDelta);
        syncItemQuantityMirror(item);
        return item;
    }

    function getDeductionDisplayQty(product) {
        return getStockQuantityValue(product);
    }

    function getDeductionDisplayLabel(product, qtyDelta = 0) {
        const packQtyText = String(product?.pack_qty_text || '').trim();
        if (packQtyText) {
            return adjustPackQtyText(packQtyText, qtyDelta);
        }

        const baseQty = getStockQuantityValue(product);
        return String(baseQty + (parseInt(qtyDelta, 10) || 0));
    }

    function ensureToolbarControls() {
        const toolbar = document.querySelector('#panel-stocks .stocks-toolbar');
        if (!toolbar) return;

        const primary = toolbar.querySelector('.stocks-toolbar-primary') || toolbar.firstElementChild;
        const existingSearch = document.getElementById('stocks-search');
        const existingArchiveToggle = toolbar.querySelector('.stocks-archive-toggle');
        if (primary && !primary.classList.contains('stocks-toolbar-primary')) {
            primary.classList.add('stocks-toolbar-primary');
        }

        const legacyDraftButton = document.getElementById('stocks-remove-drafts');
        if (legacyDraftButton) {
            legacyDraftButton.remove();
        }

        const deleteBtn = document.getElementById('stocks-remove-selected');
        if (deleteBtn) {
            deleteBtn.id = 'stocks-delete-selected';
            const textNode = deleteBtn.querySelector('.btn-text');
            if (textNode) textNode.textContent = 'Delete Selected';
            const iconNode = deleteBtn.querySelector('.btn-icon');
            if (iconNode) iconNode.innerHTML = '&#128465;';
        }

        if (!document.getElementById('stocks-save-status') && primary) {
            const status = document.createElement('div');
            status.id = 'stocks-save-status';
            status.className = 'stocks-save-status';
            status.setAttribute('aria-live', 'polite');
            primary.appendChild(status);
        }

        let secondary = toolbar.querySelector('.stocks-toolbar-secondary');
        if (!secondary) {
            secondary = document.createElement('div');
            secondary.className = 'stocks-toolbar-secondary';
            toolbar.appendChild(secondary);
        }

        if (!document.getElementById('stocks-toggle-archived')) {
            const button = document.createElement('button');
            button.id = 'stocks-toggle-archived';
            button.className = 'toolbar-btn toolbar-btn-compact';
            button.type = 'button';
            secondary.appendChild(button);
        }

        if (existingSearch && existingSearch.parentElement !== secondary) {
            secondary.appendChild(existingSearch);
        }
        if (existingArchiveToggle) {
            existingArchiveToggle.style.display = 'none';
        }

        updateArchivedToggleButton();
        renderSaveStatus();
    }

    async function loadItems(options = {}) {
        const selectedIds = options.preserveSelection
            ? new Set(items.filter((item) => item._selected && item.id).map((item) => item.id))
            : new Set();
        const products = await Persistence.getAllProducts({ includeArchived: true });
        items = products.map((item) => normalizeStockItem({
            ...item,
            _selected: selectedIds.has(item.id)
        }));
        updateSelectAllCheckbox();
    }

    function getActiveItems() {
        return items.filter((item) => !isArchived(item));
    }

    function getVisibleItems() {
        const source = showArchived ? items : getActiveItems();
        if (!searchTerm) return source;

        const query = searchTerm.toLowerCase();
        return source.filter((item) =>
            (item.barcode || '').toLowerCase().includes(query)
            || (item.name_en || '').toLowerCase().includes(query)
            || (item.name_ar || '').includes(query)
            || (item.product_by || '').toLowerCase().includes(query)
            || (item.pack_qty_text || '').toLowerCase().includes(query)
        );
    }

    function getSelectedItems() {
        return items.filter((item) => item._selected);
    }

    function syncNotifications() {
        NotificationManager.checkLowStock(getActiveItems());
        updateToolbarState();
        updateSelectAllCheckbox();
        updateArchivedToggleButton();
        renderSaveStatus();
    }

    function updateToolbarState() {
        const restoreBtn = document.getElementById('stocks-restore-selected');
        const deleteBtn = document.getElementById('stocks-delete-selected');
        const selected = getSelectedItems();
        const selectedArchived = selected.filter(isArchived);
        const selectedSaved = selected.filter((item) => item.id);

        if (deleteBtn) {
            deleteBtn.disabled = selected.length === 0;
        }

        if (restoreBtn) {
            restoreBtn.disabled = selectedArchived.length === 0;
        }
    }

    function updateArchivedToggleButton() {
        const button = document.getElementById('stocks-toggle-archived');
        if (!button) return;

        button.textContent = showArchived ? 'Archived: On' : 'Archived: Off';
        button.setAttribute('aria-pressed', showArchived ? 'true' : 'false');
    }

    function renderSaveStatus() {
        const node = document.getElementById('stocks-save-status');
        if (!node) return;

        node.dataset.state = saveStatus.state || 'idle';
        node.textContent = saveStatus.message || 'Changes save automatically';
    }

    function setSaveStatus(state, message, options = {}) {
        if (saveStatusTimer) {
            clearTimeout(saveStatusTimer);
            saveStatusTimer = null;
        }

        saveStatus = {
            state: state || 'idle',
            message: message || 'Changes save automatically'
        };
        renderSaveStatus();

        if (options.autoReset !== false && state && state !== 'idle') {
            saveStatusTimer = setTimeout(() => {
                saveStatus = {
                    state: 'idle',
                    message: 'Changes save automatically'
                };
                renderSaveStatus();
            }, options.durationMs || 2200);
        }
    }

    function updateSelectAllCheckbox() {
        const selectAll = document.getElementById('stocks-select-all');
        if (!selectAll) return;

        const visible = getVisibleItems();
        selectAll.checked = visible.length > 0 && visible.every((item) => item._selected);
        selectAll.indeterminate = visible.some((item) => item._selected) && !selectAll.checked;
    }

    async function addRow() {
        items.unshift(createStockItem({ _new: true, display_order: getNextDisplayOrder() }));
        setSaveStatus('idle', 'Draft row ready');
        render();
        syncNotifications();
    }

    async function removeSelected() {
        const selected = getSelectedItems();
        if (selected.length === 0) {
            Notification.show('Select at least one stock row to delete.', 'info');
            return;
        }

        const persistedRows = selected.filter((item) => item.id);
        const draftRows = selected.filter((item) => !item.id);

        const confirmed = window.confirm(
            persistedRows.length > 0
                ? `Delete ${selected.length} selected row(s)? Saved rows and their stock history will be permanently removed.`
                : `Delete ${draftRows.length} selected draft row(s)?`
        );
        if (!confirmed) return;

        for (const item of persistedRows) {
            await Persistence.destroyProduct(item.id);
        }

        if (draftRows.length > 0) {
            items = items.filter((item) => !draftRows.includes(item));
        }

        await loadItems();
        render();
        syncNotifications();
        await refreshHistoryIfOpen(currentHistoryProductId);
    }

    async function removeDraftRows() {
        const draftRows = getSelectedItems().filter((item) => !item.id);
        if (draftRows.length === 0) {
            Notification.show('Select at least one unsaved draft row to remove.', 'info');
            return;
        }

        items = items.filter((item) => !draftRows.includes(item));
        render();
        syncNotifications();
    }

    async function restoreSelected() {
        const archivedItems = getSelectedItems().filter((item) => item.id && isArchived(item));
        if (archivedItems.length === 0) {
            Notification.show('Select archived stock items to restore.', 'info');
            return;
        }

        for (const item of archivedItems) {
            await Persistence.restoreProduct(item.id);
        }

        await loadItems();
        render();
        syncNotifications();
        await refreshHistoryIfOpen(currentHistoryProductId);
    }

    function bindAdjustmentModal() {
        if (adjustmentModalBound) return;
        adjustmentModalBound = true;

        document.getElementById('stock-adjustment-confirm')?.addEventListener('click', () => {
            void confirmAdjustment();
        });
        document.getElementById('stock-adjustment-cancel')?.addEventListener('click', () => {
            closeAdjustmentModal({ revert: true });
        });
        document.getElementById('stock-adjustment-close')?.addEventListener('click', () => {
            closeAdjustmentModal({ revert: true });
        });
    }

    function isPendingOpeningStock(item, previousState, nextQty) {
        return !!item?._pendingOpeningStock
            && getStockQuantityValue(previousState) === 0
            && nextQty > 0;
    }

    function shouldPromptForStockAdjustment(item, previousState, nextQty) {
        return !!item?.id
            && nextQty !== getStockQuantityValue(previousState)
            && !isPendingOpeningStock(item, previousState, nextQty);
    }

    function defaultAdjustmentReason(qtyChange) {
        if (qtyChange > 0) return 'supplier-restock';
        if (qtyChange < 0) return 'damage-loss';
        return 'manual-adjustment';
    }

    function openAdjustmentModal(item, previousState, nextQty) {
        const modal = document.getElementById('stock-adjustment-modal');
        const summary = document.getElementById('stock-adjustment-summary');
        const reasonSelect = document.getElementById('stock-adjustment-reason');
        const noteInput = document.getElementById('stock-adjustment-note');
        const errorEl = document.getElementById('stock-adjustment-error');
        if (!modal || !summary || !reasonSelect || !noteInput || !errorEl) return;

        const previousQty = getStockQuantityValue(previousState);
        const qtyChange = nextQty - previousQty;
        pendingAdjustment = {
            item,
            previousState,
            nextQty
        };

        summary.innerHTML = [
            buildAdjustmentStat('Previous', String(previousQty)),
            buildAdjustmentStat('New Qty', String(nextQty)),
            buildAdjustmentStat('Change', `${qtyChange > 0 ? '+' : ''}${qtyChange}`, qtyChange)
        ].join('');
        reasonSelect.value = defaultAdjustmentReason(qtyChange);
        noteInput.value = '';
        errorEl.textContent = '';
        App?.showModal?.(modal);
        reasonSelect.focus();
    }

    function buildAdjustmentStat(label, value, qtyChange = 0) {
        const deltaClass = qtyChange > 0 ? 'positive' : (qtyChange < 0 ? 'negative' : '');
        return `
            <div class="stock-adjustment-stat">
                <span class="stock-adjustment-stat-label">${esc(label)}</span>
                <span class="stock-adjustment-stat-value ${deltaClass}">${esc(value)}</span>
            </div>
        `;
    }

    function closeAdjustmentModal({ revert }) {
        const modal = document.getElementById('stock-adjustment-modal');
        const errorEl = document.getElementById('stock-adjustment-error');

        if (modal) {
            App?.hideModal?.(modal);
        }
        if (errorEl) {
            errorEl.textContent = '';
        }

        if (revert && pendingAdjustment?.item) {
            render();
        }

        pendingAdjustment = null;
    }

    async function confirmAdjustment() {
        const reasonSelect = document.getElementById('stock-adjustment-reason');
        const noteInput = document.getElementById('stock-adjustment-note');
        const errorEl = document.getElementById('stock-adjustment-error');
        if (!pendingAdjustment || !reasonSelect || !noteInput || !errorEl) return;

        const reason = reasonSelect.value || 'manual-adjustment';
        const note = (noteInput.value || '').trim();
        const { item, previousState, nextQty } = pendingAdjustment;

        if (!reason) {
            errorEl.textContent = 'Select an adjustment reason.';
            return;
        }

        try {
            item.pack_qty_text = setPackQtyValue(
                pendingAdjustment.inputValue || previousState.pack_qty_text,
                nextQty
            );
            syncItemQuantityMirror(item);
            await persistItem(item, 'pack_qty_text', previousState, { reason, note });
            closeAdjustmentModal({ revert: false });
            render();
            await refreshHistoryIfOpen(item.id || previousState.id);
            Notification.show('Stock adjustment saved.', 'success');
        } catch (error) {
            item.pack_qty_text = previousState.pack_qty_text || item.pack_qty_text || '';
            syncItemQuantityMirror(item);
            render();
            errorEl.textContent = error?.message || 'Unable to save this stock adjustment.';
        }
    }

    function toggleSelectAll(event) {
        const checked = !!event.target.checked;
        getVisibleItems().forEach((item) => {
            item._selected = checked;
        });
        render();
        syncNotifications();
    }

    function render() {
        const tbody = document.getElementById('stocks-tbody');
        const table = document.querySelector('.stocks-table');
        const thead = table?.querySelector('thead');
        const tableWrap = document.querySelector('.stocks-table-wrap');
        if (!tbody) return;

        const filtered = getVisibleItems();
        const orderedItems = showArchived ? items : getActiveItems();
        const serialMap = new Map(orderedItems.map((item, position) => [item, position + 1]));
        const isEmpty = filtered.length === 0;
        if (table) table.classList.toggle('stocks-table-empty', isEmpty);
        if (tableWrap) tableWrap.classList.toggle('stocks-table-wrap-empty', isEmpty);
        if (thead) thead.hidden = isEmpty;
        if (filtered.length === 0) {
            const emptyMessage = showArchived
                ? 'No stock items match this filter.'
                : 'No stock items. Click "Add Row" or scan a barcode.';
            tbody.innerHTML = `
                <tr class="stocks-empty-row">
                    <td colspan="9">
                        <div class="stocks-empty-state">
                            <strong>No stock rows to show</strong>
                            <span>${emptyMessage}</span>
                        </div>
                    </td>
                </tr>
            `;
            syncNotifications();
            return;
        }

        tbody.innerHTML = filtered.map((item) => {
            const index = items.indexOf(item);
            const archived = isArchived(item);
            const serialNumber = serialMap.get(item) || (index + 1);
            const unitPriceKD = InvoiceMath.filsToKD(item.unit_price_fils || 0);
            const rowClassName = archived ? 'stock-row-archived' : '';
            const disabledAttr = archived ? 'disabled aria-disabled="true"' : '';
            const archivedBadge = archived ? '<span class="stock-archived-badge">Archived</span>' : '';

            return `
        <tr data-idx="${index}" class="${rowClassName}">
          <td class="col-checkbox"><input type="checkbox" ${item._selected ? 'checked' : ''} data-role="select-row" /></td>
          <td class="stock-serial">${esc(String(serialNumber))}</td>
          <td>
            <input type="text" value="${esc(item.barcode)}" data-field="barcode" ${disabledAttr} />
            ${archivedBadge}
          </td>
          <td><input type="text" value="${esc(item.product_by || '')}" data-field="product_by" ${disabledAttr} /></td>
          <td><input type="text" value="${esc(item.name_en)}" data-field="name_en" ${disabledAttr} /></td>
          <td><input type="text" value="${esc(item.name_ar)}" dir="rtl" data-field="name_ar" ${disabledAttr} /></td>
          <td><input type="text" value="${esc(item.weight)}" data-field="weight" ${disabledAttr} /></td>
          <td><input type="text" value="${esc(item.pack_qty_text || '')}" data-field="pack_qty_text" ${disabledAttr} /></td>
          <td><input type="text" value="${unitPriceKD}" data-field="unit_price" ${disabledAttr} /></td>
        </tr>`;
        }).join('');

        bindTableEvents(tbody);
        syncNotifications();
    }

    function bindTableEvents(tbody) {
        tbody.querySelectorAll('input[data-field]:not([disabled])').forEach((input) => {
            const applyPendingCaretStart = () => {
                if (input.dataset.pendingCaretStart !== 'true' || typeof input.setSelectionRange !== 'function') return;
                if (document.activeElement !== input) return;

                delete input.dataset.pendingCaretStart;
                input.setSelectionRange(0, 0);
            };

            input.addEventListener('mousedown', () => {
                if (document.activeElement !== input && typeof input.setSelectionRange === 'function') {
                    input.dataset.pendingCaretStart = 'true';
                }
            });

            input.addEventListener('click', applyPendingCaretStart);

            input.addEventListener('blur', async () => {
                const row = input.closest('tr');
                const index = parseInt(row?.dataset.idx, 10);
                const field = input.dataset.field;
                const item = items[index];
                if (!item || isArchived(item)) return;

                const previousState = {
                    id: item.id || null,
                    stock_qty: getStockQuantityValue(item),
                    pack_qty_text: item.pack_qty_text || ''
                };

                if (field === 'pack_qty_text' || field === 'reorder_level') {
                    const nextValue = field === 'reorder_level'
                        ? Math.max(0, parseInt(input.value, 10) || 0)
                        : Math.max(0, parsePackQtyValue(input.value) || 0);
                    if (field === 'pack_qty_text' && shouldPromptForStockAdjustment(item, previousState, nextValue)) {
                        openAdjustmentModal(item, previousState, nextValue);
                        pendingAdjustment.inputValue = input.value;
                        return;
                    }
                    if (field === 'pack_qty_text') {
                        item.pack_qty_text = input.value;
                        syncItemQuantityMirror(item);
                    } else {
                        item[field] = nextValue;
                    }
                } else if (field === 'unit_price') {
                    item.unit_price_fils = InvoiceMath.parseFils(input.value);
                } else {
                    item[field] = input.value;
                }

                try {
                    if (item.barcode) {
                        setSaveStatus('saving', `Saving ${identifyItem(item)}...`, { autoReset: false });
                        await persistItem(item, field, previousState);
                        setSaveStatus('saved', `${identifyItem(item)} saved`);
                    } else {
                        setSaveStatus('idle', 'Draft row updated');
                    }
                } catch (error) {
                    console.error('Stock save failed:', error);
                    setSaveStatus('error', error?.message || 'Stock save failed.');
                    Notification.show(error?.message || 'Unable to save this stock item.', 'error');
                }

                render();
                await refreshHistoryIfOpen(item.id || previousState.id);
            });
        });

        tbody.querySelectorAll('input[data-role="select-row"]').forEach((input) => {
            input.addEventListener('change', () => {
                const row = input.closest('tr');
                const index = parseInt(row?.dataset.idx, 10);
                _toggleSelect(index, input.checked);
            });
        });

        tbody.querySelectorAll('td:not(.col-checkbox)').forEach((cell) => {
            cell.addEventListener('mousedown', (event) => {
                const input = cell.querySelector('input[data-field]');
                if (!input || input.disabled) return;

                if (event.target !== input) {
                    event.preventDefault();
                    input.dataset.pendingCaretStart = 'true';
                    input.focus();
                }
            });

            cell.addEventListener('click', () => {
                const input = cell.querySelector('input[data-field]');
                if (!input || input.disabled) return;

                if (input.dataset.pendingCaretStart === 'true' && document.activeElement === input && typeof input.setSelectionRange === 'function') {
                    delete input.dataset.pendingCaretStart;
                    input.setSelectionRange(0, 0);
                }
            });
        });
    }

    async function persistItem(item, field, previousState, movementDetails = {}) {
        const hadId = !!item.id;
        syncItemQuantityMirror(item);
        const saved = await Persistence.upsertProduct(item);
        if (!saved) return;

        Object.assign(item, normalizeStockItem({ ...saved, ...item, id: saved.id || item.id, archived_at: null }));
        delete item._new;
        if (!hadId && item.id) {
            item._pendingOpeningStock = true;
        }

        const currentQty = getStockQuantityValue(item);
        if (!hadId && item.id && currentQty !== 0) {
            await logStockMovement(item.id, currentQty, 'opening-stock', null, movementDetails.note || '');
            delete item._pendingOpeningStock;
            return;
        }

        if (field === 'pack_qty_text' && item.id) {
            const qtyChange = getStockQuantityValue(item) - getStockQuantityValue(previousState);
            if (qtyChange !== 0) {
                const reason = isPendingOpeningStock(item, previousState, getStockQuantityValue(item))
                    ? 'opening-stock'
                    : (movementDetails.reason || 'manual-adjustment');
                await logStockMovement(item.id, qtyChange, reason, null, movementDetails.note || '');
                delete item._pendingOpeningStock;
            }
        }
    }

    function buildBarcodeLibraryPayload(scanData, entry) {
        if (!entry) return null;

        return {
            barcode: entry.barcode || entry.barcode_number || entry.barcodeNumber || scanData,
            name_en: entry.name_en || entry.itemNameEN || '',
            name_ar: entry.name_ar || entry.itemNameAR || '',
            country: entry.country || '',
            weight: entry.weight || '',
            unit_price_fils: Number(entry.unit_price_fils ?? entry.unitPriceFils ?? 0) || 0,
            product_by: entry.product_by || entry.productBy || '',
            reorder_level: Math.max(0, parseInt(entry.reorder_level, 10) || 5)
        };
    }

    async function findBarcodeLibraryMatch(scanData) {
        const generatedMatch = typeof BarcodeGen !== 'undefined' && typeof BarcodeGen.lookupByBarcodeNumber === 'function'
            ? BarcodeGen.lookupByBarcodeNumber(scanData)
            : null;
        if (generatedMatch) {
            return buildBarcodeLibraryPayload(scanData, generatedMatch);
        }

        const persistedMatches = await Persistence.getBarcodeLibrary(scanData);
        const exactMatch = Array.isArray(persistedMatches)
            ? persistedMatches.find((entry) => String(entry.barcode_number || '') === String(scanData))
            : null;
        return buildBarcodeLibraryPayload(scanData, exactMatch);
    }

    async function incrementScannedItem(item) {
        item.archived_at = null;
        adjustItemQuantityText(item, 1);
        syncItemQuantityMirror(item);
        const saved = await Persistence.upsertProduct(item);
        if (saved?.id) {
            Object.assign(item, normalizeStockItem({ ...saved, ...item, id: saved.id, archived_at: null }));
        }
        if (item.id) {
            await logStockMovement(item.id, 1, 'stock-scan');
        }
        await refreshHistoryIfOpen(item.id);
    }

    async function handleScan(scanData) {
        const existing = items.find((item) => item.barcode === scanData);

        if (existing) {
            await incrementScannedItem(existing);
        } else {
            const persistedProduct = await Persistence.getProductByBarcode(scanData);
            const productPayload = persistedProduct
                ? normalizeStockItem(persistedProduct)
                : await findBarcodeLibraryMatch(scanData);
            const newItem = normalizeStockItem(createStockItem({
                ...productPayload,
                barcode: productPayload?.barcode || scanData,
                _selected: false
            }));
            adjustItemQuantityText(newItem, 1);
            syncItemQuantityMirror(newItem);

            const saved = await Persistence.upsertProduct(newItem);
            if (saved?.id) {
                Object.assign(newItem, normalizeStockItem({ ...saved, ...newItem, id: saved.id, archived_at: null }));
                await logStockMovement(newItem.id, 1, 'stock-scan');
            }
            items.unshift(newItem);
            await refreshHistoryIfOpen(newItem.id);
        }

        render();
    }

    async function deductStock(invoiceItems) {
        const results = [];
        for (const item of invoiceItems) {
            if (!item.barcode) continue;
            const product = await Persistence.getProductByBarcode(item.barcode);
            if (!product) continue;

            const qty = parseInt(item.qty, 10) || 0;
            const beforeQty = getDeductionDisplayQty(product);
            const afterQty = beforeQty - qty;

            results.push({
                barcode: item.barcode,
                name_en: product.name_en,
                before: beforeQty,
                beforeLabel: getDeductionDisplayLabel(product),
                deduct: qty,
                after: afterQty,
                afterLabel: getDeductionDisplayLabel(product, -qty),
                insufficient: afterQty < 0
            });
        }
        return results;
    }

    async function confirmDeduction(deductions, documentId) {
        for (const deduction of deductions) {
            const product = await Persistence.getProductByBarcode(deduction.barcode);
            if (product) {
                const currentQty = getStockQuantityValue(product);
                const updatedProduct = {
                    ...product,
                    pack_qty_text: setPackQtyValue(product.pack_qty_text, currentQty - deduction.deduct)
                };
                syncItemQuantityMirror(updatedProduct);
                await Persistence.upsertProduct(updatedProduct);
                await Persistence.addStockMovement(product.id, documentId || null, -deduction.deduct, 'sale');
            }
        }

        await loadItems({ preserveSelection: true });
        render();
        await refreshHistoryIfOpen(currentHistoryProductId);
    }

    async function openSelectedHistory() {
        const selected = getSelectedItems().filter((item) => item.id);
        if (selected.length === 0) {
            Notification.show('Select one stock item to view movement history.', 'info');
            return;
        }

        if (selected.length > 1) {
            Notification.show('Select only one stock item to view movement history.', 'warning');
            return;
        }

        await openHistoryForProduct(selected[0].id);
    }

    async function focusProduct(productId) {
        const targetId = String(productId || '').trim();
        if (!targetId) return false;

        if (showArchived) {
            showArchived = false;
            const archivedCheckbox = document.getElementById('stocks-show-archived');
            if (archivedCheckbox) {
                archivedCheckbox.checked = false;
            }
            await loadItems({ preserveSelection: true });
        }

        let product = items.find((item) => String(item.id || '') === targetId);
        if (!product) {
            await loadItems({ preserveSelection: true });
            product = items.find((item) => String(item.id || '') === targetId);
        }
        if (!product) return false;

        searchTerm = String(product.barcode || product.name_en || '').trim();
        const searchInput = document.getElementById('stocks-search');
        if (searchInput) {
            searchInput.value = searchTerm;
        }

        items.forEach((item) => {
            item._selected = String(item.id || '') === targetId;
        });
        render();

        await new Promise((resolve) => requestAnimationFrame(resolve));
        const row = document.querySelector('#stocks-tbody tr[data-idx]');
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
    }

    async function openHistoryForProduct(productId) {
        const product = items.find((item) => item.id === productId);
        if (!product) return;

        currentHistoryProductId = productId;
        const movements = await Persistence.getStockMovements(productId);
        renderHistoryModal(product, movements);

        const modal = document.getElementById('stock-history-modal');
        if (modal) App?.showModal?.(modal);
    }

    function renderHistoryModal(product, movements) {
        const summary = document.getElementById('stock-history-summary');
        const list = document.getElementById('stock-history-list');
        if (!summary || !list) return;

        const latest = movements[0] || null;
        summary.innerHTML = [
            buildHistoryStat('Barcode', product.barcode || '-'),
            buildHistoryStat('Current Stock', String(getStockQuantityValue(product))),
            buildHistoryStat('Status', isArchived(product) ? 'Archived' : 'Active'),
            buildHistoryStat('Last Movement', latest ? formatHistoryTimestamp(latest.created_at) : 'No history')
        ].join('');

        if (!movements.length) {
            list.innerHTML = '<div class="stock-history-empty">No stock movements recorded for this item yet.</div>';
            return;
        }

        list.innerHTML = movements.map((movement) => {
            const qtyChange = Number(movement.qty_change || 0);
            const positive = qtyChange > 0;
            const changeLabel = `${positive ? '+' : ''}${qtyChange}`;
            const reasonLabel = describeMovementReason(movement.reason, movement.doc_number);
            const linkedDocument = movement.doc_number
                ? `${movement.doc_type || 'document'} ${movement.doc_number}`
                : 'No linked document';

            return `
                <div class="stock-history-row">
                    <div class="stock-history-row-main">
                        <div class="stock-history-row-title">${esc(reasonLabel)}</div>
                        <div class="stock-history-row-meta">${esc(formatHistoryTimestamp(movement.created_at))} - ${esc(linkedDocument)}</div>
                        ${movement.note ? `<div class="stock-history-row-note">${esc(movement.note)}</div>` : ''}
                    </div>
                    <div class="stock-history-row-change ${positive ? 'positive' : 'negative'}">${esc(changeLabel)}</div>
                </div>
            `;
        }).join('');
    }

    function buildHistoryStat(label, value) {
        return `
            <div class="stock-history-stat">
                <span class="stock-history-stat-label">${esc(label)}</span>
                <span class="stock-history-stat-value">${esc(value)}</span>
            </div>
        `;
    }

    function describeMovementReason(reason, docNumber) {
        switch (String(reason || '')) {
            case 'sale':
                return docNumber ? `Sale from ${docNumber}` : 'Sale deduction';
            default:
                return ADJUSTMENT_REASON_LABELS[String(reason || '')] || String(reason || 'Stock movement');
        }
    }

    async function logStockMovement(productId, qtyChange, reason, documentId = null, note = '') {
        if (!productId || !qtyChange) return;
        await Persistence.addStockMovement(productId, documentId, qtyChange, reason, note);
    }

    async function refreshHistoryIfOpen(productId) {
        if (!productId || currentHistoryProductId !== productId) return;
        await loadItems({ preserveSelection: true });
        await openHistoryForProduct(productId);
    }

    function formatHistoryTimestamp(value) {
        if (!value) return 'Recently updated';
        const date = new Date(String(value).replace(' ', 'T'));
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function _toggleSelect(index, checked) {
        if (items[index]) items[index]._selected = checked;
        render();
    }

    function getItems() {
        return items;
    }

    function esc(str) {
        const host = document.createElement('div');
        host.textContent = str || '';
        return host.innerHTML;
    }

    return {
        init,
        addRow,
        removeSelected,
        removeDraftRows,
        handleScan,
        deductStock,
        confirmDeduction,
        openSelectedHistory,
        focusProduct,
        _toggleSelect,
        getItems,
        render
    };
})();
