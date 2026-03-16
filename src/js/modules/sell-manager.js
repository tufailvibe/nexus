/**
 * sell.js - Sell mode orchestration
 * Handles editable invoice/letterhead workspaces, saved-document history,
 * page management, and print snapshot capture.
 */
const Sell = (() => {
    const RAPID_ORDER_SHEET_LABEL = 'Rapid Order Sheet';
    const RAPID_ORDER_SHEET_LABEL_LOWER = 'rapid order sheet';
    const VIEW_TYPES = ['invoice', 'letterhead'];
    let currentView = 'invoice';
    let manualPagination = false;
    const dirtyFlags = {
        invoice: false,
        letterhead: false
    };
    let scanQueue = [];
    let scanProcessing = false;
    let selectedHistoryId = null;
    let historySearchTimer = null;
    let historyModalMode = 'saved';

    const currentDocumentIds = {
        invoice: null,
        letterhead: null
    };
    const currentDocumentLabels = {
        invoice: '',
        letterhead: ''
    };
    const documentSessions = {
        invoice: createDocumentSessionState(),
        letterhead: createDocumentSessionState()
    };
    const draftSaveTimers = {
        invoice: null,
        letterhead: null
    };
    const lastDraftSnapshots = {
        invoice: '',
        letterhead: ''
    };
    let recoveryDrafts = [];
    const selectedPageIndexes = {
        invoice: 0,
        letterhead: 0
    };
    const draftStatus = {
        invoice: { state: 'idle', savedAt: null, message: '' },
        letterhead: { state: 'idle', savedAt: null, message: '' }
    };
    let shareMenuOpen = false;
    let historyShareMenuId = null;
    let pageScrollSyncFrame = null;
    let selectedPageLockUntil = 0;
    const sharePdfCache = {
        invoice: createSharePdfCacheState(),
        letterhead: createSharePdfCacheState()
    };
    const shareContactOverrides = {
        invoice: createShareContactOverride(),
        letterhead: createShareContactOverride()
    };
    const historyShareContactOverrides = new Map();

    function createDocumentSessionState() {
        return {
            mode: 'edit',
            sourceId: null,
            sourceLabel: '',
            suggestedCopyLabel: ''
        };
    }

    function createSharePdfCacheState() {
        return {
            signature: '',
            filePath: '',
            pending: null
        };
    }

    function emptyShareContact() {
        return { email: '', whatsapp: '' };
    }

    function createShareContactOverride() {
        return { email: null, whatsapp: null };
    }

    async function init() {
        initDraftRecoveryControls();

        const viewSelect = document.getElementById('sell-view-type');
        if (viewSelect) {
            viewSelect.value = currentView;
            viewSelect.addEventListener('change', () => {
                const nextView = viewSelect.value;
                if (nextView === currentView) return;

                syncCurrentViewState();
                if (hasUnsavedChanges(currentView)) {
                    void persistDraft(currentView, { syncCurrentView: false }).catch((error) => {
                        console.error('Draft persistence failed during view switch:', error);
                    });
                }

                currentView = nextView;
                updateToolbar();
                render();
            });
        }

        document.getElementById('btn-new-doc')?.addEventListener('click', newDocument);
        document.getElementById('btn-save-template')?.addEventListener('click', () => {
            void promptSaveDocument();
        });
        document.getElementById('btn-load-template')?.addEventListener('click', () => openHistoryModal());
        document.getElementById('btn-print-doc')?.addEventListener('click', () => {
            const options = isReadOnlyView(currentView)
                ? {
                    snapshot: getPrintSnapshot(currentView),
                    skipDeduction: true
                }
                : {};
            void PrintManager.startPrintFlow(currentView, options);
        });
        document.getElementById('btn-share-whatsapp')?.addEventListener('click', () => {
            void shareCurrentDocument('whatsapp');
        });
        document.getElementById('btn-share-gmail')?.addEventListener('click', () => {
            void shareCurrentDocument('gmail');
        });
        document.getElementById('btn-share-copy-message')?.addEventListener('click', () => {
            void copyCurrentShareHelper('message');
        });
        document.getElementById('btn-share-copy-email')?.addEventListener('click', () => {
            void copyCurrentShareHelper('email');
        });
        document.getElementById('btn-share-copy-whatsapp')?.addEventListener('click', () => {
            void copyCurrentShareHelper('whatsapp');
        });
        document.getElementById('btn-share-reveal-pdf')?.addEventListener('click', () => {
            closeShareMenu();
            void openSharedHistoryModal();
        });
        initPageActionsControls();
        initShareMenuControls();
        bindShareControls();
        document.getElementById('btn-manage-settings-toolbar')?.addEventListener('click', () => Settings.openSettingsModal());

        const pagToggle = document.getElementById('pagination-manual');
        if (pagToggle) {
            pagToggle.addEventListener('change', (e) => {
                manualPagination = e.target.checked;
                render();
            });
        }

        const historySearch = document.getElementById('history-search');
        if (historySearch) {
            historySearch.addEventListener('input', () => {
                if (historySearchTimer) clearTimeout(historySearchTimer);
                historySearchTimer = setTimeout(() => {
                    if (historyModalMode === 'shared') {
                        openSharedHistoryModal(historySearch.value.trim(), { preserveSelection: true });
                    } else {
                        openHistoryModal(historySearch.value.trim(), { preserveSelection: true });
                    }
                }, 180);
            });
        }

        const invNum = await Persistence.getNextInvoiceNumber();
        const data = Invoice.getData();
        if (!data.invoiceNumber) {
            data.invoiceNumber = invNum.formatted;
        }

        updateToolbar();
        render();
        initSearch();
        await maybePromptDraftRecovery();
    }

    function initSearch() {
        const searchInput = document.getElementById('sell-product-search');
        const resultsBox = document.getElementById('sell-search-results');
        if (!searchInput || !resultsBox) return;
        let activeResultIndex = -1;

        const getResultItems = () => Array.from(resultsBox.querySelectorAll('.search-result-item'));
        const clearActiveResult = () => {
            activeResultIndex = -1;
            getResultItems().forEach((item) => {
                item.classList.remove('is-active');
                item.removeAttribute('aria-selected');
            });
        };
        const setActiveResult = (index) => {
            const items = getResultItems();
            if (!items.length) {
                clearActiveResult();
                return;
            }

            const safeIndex = Math.max(0, Math.min(index, items.length - 1));
            activeResultIndex = safeIndex;
            items.forEach((item, itemIndex) => {
                const isActive = itemIndex === safeIndex;
                item.classList.toggle('is-active', isActive);
                if (isActive) {
                    item.setAttribute('aria-selected', 'true');
                    item.scrollIntoView({ block: 'nearest' });
                } else {
                    item.removeAttribute('aria-selected');
                }
            });
        };
        const hideResults = () => {
            clearActiveResult();
            resultsBox.style.display = 'none';
        };
        const selectResult = (item) => {
            if (!item?.dataset?.barcode) return;
            handleScan(item.dataset.barcode);
            searchInput.value = '';
            hideResults();
        };

        searchInput.addEventListener('input', async () => {
            if (isReadOnlyView(currentView)) {
                hideResults();
                return;
            }

            const query = searchInput.value.trim();
            if (query.length < 2) {
                hideResults();
                return;
            }

            const results = await Persistence.searchProducts(query);
            if (results.length === 0) {
                resultsBox.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:12px">No products found.</div>';
                clearActiveResult();
            } else {
                resultsBox.innerHTML = results.map((product) => `
                    <div class="search-result-item" data-barcode="${product.barcode}">
                        <div class="sri-name">${esc(product.name_en)}</div>
                        <div class="sri-meta">
                            <span class="sri-barcode">${esc(product.barcode)}</span>
                            <span>${InvoiceMath.filsToKD(product.unit_price_fils)} KD.</span>
                        </div>
                    </div>
                `).join('');
                clearActiveResult();
            }

            resultsBox.style.display = 'block';
        });

        searchInput.addEventListener('keydown', (event) => {
            const items = getResultItems();
            if (resultsBox.style.display === 'none' || !items.length) {
                return;
            }

            if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveResult(activeResultIndex < 0 ? 0 : (activeResultIndex + 1) % items.length);
                return;
            }

            if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveResult(activeResultIndex < 0 ? items.length - 1 : (activeResultIndex - 1 + items.length) % items.length);
                return;
            }

            if (event.key === 'Enter' && activeResultIndex >= 0) {
                event.preventDefault();
                selectResult(items[activeResultIndex]);
                return;
            }

            if (event.key === 'Escape') {
                event.preventDefault();
                hideResults();
            }
        });

        resultsBox.addEventListener('mousemove', (event) => {
            const item = event.target.closest('.search-result-item');
            if (!item) return;
            const index = getResultItems().indexOf(item);
            if (index >= 0 && index !== activeResultIndex) {
                setActiveResult(index);
            }
        });

        resultsBox.addEventListener('click', (event) => {
            const item = event.target.closest('.search-result-item');
            if (!item) return;
            selectResult(item);
        });

        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !resultsBox.contains(e.target)) {
                hideResults();
            }
        });
    }

    function updateToolbar() {
        const readOnly = isReadOnlyView(currentView);
        const printBtn = document.getElementById('btn-print-doc');
        if (printBtn) {
            const label = printBtn.querySelector('.btn-text');
            if (label) label.textContent = 'Print / Save';
            printBtn.title = currentView === 'invoice'
                ? 'Print or save this invoice'
                : `Print or save this ${RAPID_ORDER_SHEET_LABEL_LOWER}`;
        }

        const saveBtn = document.getElementById('btn-save-template');
        if (saveBtn) {
            const label = saveBtn.querySelector('.btn-text');
            if (label) label.textContent = 'Save';
            saveBtn.disabled = readOnly;
            saveBtn.title = readOnly
                ? 'Open this saved document in edit mode before saving.'
                : `Save the current ${getViewTypeLabel(currentView)}`;
        }

        const loadBtn = document.getElementById('btn-load-template');
        if (loadBtn) {
            const label = loadBtn.querySelector('.btn-text');
            if (label) label.textContent = currentView === 'invoice' ? 'Saved Invoices' : 'Saved Sheets';
            loadBtn.title = `Open saved ${currentView === 'invoice' ? 'invoices' : 'rapid order sheets'}`;
        }

        const addBtn = document.getElementById('btn-add-page');
        if (addBtn) {
            const label = addBtn.querySelector('.btn-text');
            if (label) label.textContent = `Pages - P${getSelectedPageIndex(currentView) + 1}`;
            addBtn.title = `Manage page actions for page ${getSelectedPageIndex(currentView) + 1}`;
            addBtn.disabled = readOnly;
        }

        const pagBar = document.getElementById('sell-pagination-bar');
        if (pagBar) pagBar.style.display = currentView === 'invoice' ? 'flex' : 'none';

        const searchInput = document.getElementById('sell-product-search');
        const searchResults = document.getElementById('sell-search-results');
        if (searchInput) {
            searchInput.disabled = readOnly;
            searchInput.placeholder = readOnly
                ? 'View-only mode: choose Edit Original or Edit Copy to add items'
                : 'Search name / barcode...';
        }
        if (readOnly && searchResults) {
            searchResults.style.display = 'none';
        }

        renderShareControls();
        renderPageActionsState();
        renderDraftStatus();
        if (typeof App !== 'undefined' && typeof App.refreshScanTarget === 'function') {
            App.refreshScanTarget();
        }
    }

    function render() {
        const workspace = document.getElementById('sell-workspace');
        if (!workspace) return;

        closePageActionsMenu();
        closeShareMenu();
        normalizeSelectedPageIndex(currentView);
        updateToolbar();

        workspace.innerHTML = currentView === 'invoice'
            ? Invoice.renderInvoice()
            : Invoice.renderLetterhead();

        renderViewBanner();
        applyWorkspaceInteractionMode(workspace);
        bindInvoiceEvents();
        if (currentView === 'invoice') {
            updateTotalsInPlace();
        }
        bindPageInteractionEvents();
        renderThumbnails();
        updateSelectedPageUi();
        updatePageCount();
    }

    function getDocumentSession(viewType = currentView) {
        if (!documentSessions[viewType]) {
            documentSessions[viewType] = createDocumentSessionState();
        }
        return documentSessions[viewType];
    }

    function setDocumentSession(viewType, updates = {}) {
        documentSessions[viewType] = {
            ...getDocumentSession(viewType),
            ...updates
        };
        return documentSessions[viewType];
    }

    function resetDocumentSession(viewType = currentView) {
        documentSessions[viewType] = createDocumentSessionState();
        return documentSessions[viewType];
    }

    function getViewMode(viewType = currentView) {
        return getDocumentSession(viewType).mode || 'edit';
    }

    function isReadOnlyView(viewType = currentView) {
        return getViewMode(viewType) === 'view';
    }

    function getViewTypeLabel(viewType = currentView) {
        return viewType === 'invoice' ? 'invoice' : RAPID_ORDER_SHEET_LABEL_LOWER;
    }

    function getViewTypeTitle(viewType = currentView) {
        return viewType === 'invoice' ? 'Invoice' : RAPID_ORDER_SHEET_LABEL;
    }

    function getViewTypeTitlePlural(viewType = currentView) {
        return viewType === 'invoice' ? 'Invoices' : `${RAPID_ORDER_SHEET_LABEL}s`;
    }

    function buildSuggestedCopyLabel(label, viewType = currentView) {
        const fallbackLabel = viewType === 'invoice' ? 'Untitled Invoice' : `Untitled ${RAPID_ORDER_SHEET_LABEL}`;
        const baseLabel = String(label || buildSuggestedDocumentLabel(viewType) || fallbackLabel).trim();
        return / copy$/i.test(baseLabel) ? baseLabel : `${baseLabel} Copy`;
    }

    function describeSavedRecord(record) {
        const viewType = record?.doc_type || currentView;
        const payload = record?.payload || {};
        return record?.doc_number
            || buildDocumentNumber(viewType, payload)
            || `Untitled ${getViewTypeLabel(viewType)}`;
    }

    function describeCurrentWorkspace(viewType = currentView) {
        return currentDocumentLabels[viewType]
            || getDocumentSession(viewType).sourceLabel
            || buildSuggestedDocumentLabel(viewType)
            || `Untitled ${getViewTypeLabel(viewType)}`;
    }

    function itemHasMeaningfulContent(item) {
        return [
            item?.barcode,
            item?.name_en,
            item?.name_ar,
            item?.country,
            item?.weight,
            item?.qty_by,
            item?.product_by
        ].some(hasTextInput)
            || Number(item?.qty || 0) !== 0
            || Number(item?.unit_price_fils || 0) !== 0;
    }

    function hasMeaningfulDocumentContent(viewType = currentView) {
        const data = getDocumentData(viewType) || {};
        const pages = Array.isArray(data.pages) ? data.pages : [];
        const items = pages.flatMap((page) => Array.isArray(page?.items) ? page.items : []);
        if (items.some(itemHasMeaningfulContent)) {
            return true;
        }

        if (viewType === 'invoice') {
            const billTo = data.billTo || {};
            return [
                billTo.name,
                billTo.nameAr,
                billTo.person,
                billTo.personAr,
                billTo.area,
                billTo.areaAr,
                billTo.phone,
                data.notes
            ].some(hasTextInput) || InvoiceMath.parseFils(data.discount) !== 0;
        }

        const defaults = Invoice.defaultLetterheadData();
        return [
            data.to,
            data.toAr,
            data.area,
            data.areaAr,
            data.notes
        ].some(hasTextInput)
            || (hasTextInput(data.subject) && String(data.subject) !== String(defaults.subject))
            || (hasTextInput(data.subjectAr) && String(data.subjectAr) !== String(defaults.subjectAr));
    }

    function getRecoveryDraftViewTypes() {
        return recoveryDrafts
            .map((draft) => String(draft?.viewType || '').trim())
            .filter((viewType) => VIEW_TYPES.includes(viewType));
    }

    function getPendingAppCloseState() {
        syncCurrentViewState();

        const dirtyViews = VIEW_TYPES.filter((viewType) => hasUnsavedChanges(viewType));
        const recoveryViews = getRecoveryDraftViewTypes();
        const pendingViews = Array.from(new Set([...dirtyViews, ...recoveryViews]));

        return {
            pendingViews,
            dirtyViews,
            recoveryViews
        };
    }

    function getViewTypeCloseLabel(viewType) {
        return viewType === 'invoice' ? 'Invoice' : RAPID_ORDER_SHEET_LABEL;
    }

    function joinLabels(labels) {
        if (labels.length <= 1) return labels[0] || 'document';
        if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
        return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
    }

    function buildAppCloseSummary(state = getPendingAppCloseState()) {
        const summaryLabel = joinLabels(state.pendingViews.map(getViewTypeCloseLabel));
        if (state.dirtyViews.length > 0) {
            return `Unsaved work is still open in ${summaryLabel}. Save it as a draft before exit, or discard it so it will not appear again next time.`;
        }

        return `Recoverable drafts are still stored for ${summaryLabel}. Keep them for the next launch, or discard them now so the recovery prompt does not return.`;
    }

    async function getAppCloseState() {
        const state = getPendingAppCloseState();
        return {
            hasPending: state.pendingViews.length > 0,
            pendingViews: state.pendingViews,
            dirtyViews: state.dirtyViews,
            recoveryViews: state.recoveryViews,
            summary: buildAppCloseSummary(state)
        };
    }

    async function finalizeAppClose(action = 'discard') {
        const state = getPendingAppCloseState();
        if (!state.pendingViews.length) {
            return {
                success: true,
                action: 'none',
                pendingViews: []
            };
        }

        if (action === 'save') {
            for (const viewType of state.dirtyViews) {
                await persistDraft(viewType, {
                    force: true,
                    syncCurrentView: currentView === viewType
                });
            }
            closeDraftRecoveryModal();
            return {
                success: true,
                action: 'save',
                pendingViews: state.pendingViews
            };
        }

        for (const viewType of VIEW_TYPES) {
            await clearDraft(viewType);
            setDirtyState(viewType, false);
        }
        recoveryDrafts = [];
        closeDraftRecoveryModal();

        return {
            success: true,
            action: 'discard',
            pendingViews: state.pendingViews
        };
    }

    function renderViewBanner() {
        const banner = document.getElementById('sell-view-banner');
        if (!banner) return;

        if (!isReadOnlyView(currentView)) {
            banner.style.display = 'none';
            banner.innerHTML = '';
            return;
        }

        const session = getDocumentSession(currentView);
        const sourceLabel = esc(session.sourceLabel || describeCurrentWorkspace(currentView));
        const docLabel = getViewTypeLabel(currentView);
        banner.innerHTML = `
            <div class="sell-view-banner-copy">
                Viewing saved ${docLabel}: <strong>${sourceLabel}</strong>
            </div>
            <div class="sell-view-banner-actions">
                <button type="button" id="sell-view-edit-original" class="btn-primary">Edit Original</button>
                <button type="button" id="sell-view-edit-copy" class="btn-secondary">Edit Copy</button>
                <button type="button" id="sell-view-close" class="btn-secondary">Close View</button>
            </div>
        `;
        banner.style.display = 'flex';
        banner.querySelector('#sell-view-edit-original')?.addEventListener('click', () => {
            void enterEditOriginalMode();
        });
        banner.querySelector('#sell-view-edit-copy')?.addEventListener('click', () => {
            void enterEditCopyMode();
        });
        banner.querySelector('#sell-view-close')?.addEventListener('click', () => {
            void closeReadOnlyView();
        });
    }

    function applyWorkspaceInteractionMode(workspace) {
        const readOnly = isReadOnlyView(currentView);
        workspace.dataset.readOnly = readOnly ? 'true' : 'false';
        workspace.classList.toggle('sell-workspace-readonly', readOnly);

        if (!readOnly) return;

        workspace.querySelectorAll('[contenteditable]').forEach((element) => {
            element.setAttribute('contenteditable', 'false');
            element.setAttribute('tabindex', '-1');
            element.removeAttribute('spellcheck');
        });

        workspace.querySelectorAll('input, textarea, select, button').forEach((control) => {
            control.setAttribute('disabled', 'disabled');
            control.setAttribute('aria-disabled', 'true');
        });
    }

    function showReadOnlyActionBlocked(action = 'make changes') {
        Notification.show(
            `This saved ${getViewTypeLabel(currentView)} is open in view-only mode. Choose Edit Original or Edit Copy to ${action}.`,
            'warning'
        );
    }

    function ensureEditableSession(action = 'make changes', viewType = currentView) {
        if (!isReadOnlyView(viewType)) return true;
        showReadOnlyActionBlocked(action);
        return false;
    }

    function initPageActionsControls() {
        const trigger = document.getElementById('btn-add-page');
        const menu = document.getElementById('page-actions-menu');
        if (!trigger || !menu) return;

        trigger.addEventListener('click', (event) => {
            event.stopPropagation();
            togglePageActionsMenu();
        });

        menu.querySelectorAll('[data-page-action]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                const action = button.dataset.pageAction;
                if (!action || button.disabled) return;

                if (action === 'add') {
                    addPage();
                } else if (action === 'duplicate') {
                    duplicatePageAt(getSelectedPageIndex(currentView));
                } else if (action === 'delete') {
                    deletePageAt(getSelectedPageIndex(currentView));
                }
            });
        });

        document.addEventListener('click', (event) => {
            if (!menu.contains(event.target) && !trigger.contains(event.target)) {
                closePageActionsMenu();
            }
        });
    }

    function initShareMenuControls() {
        const trigger = document.getElementById('btn-share-menu');
        const menu = document.getElementById('sell-share-menu');
        if (!trigger || !menu) return;

        trigger.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleShareMenu();
        });

        menu.addEventListener('click', (event) => {
            event.stopPropagation();
        });

        document.addEventListener('click', (event) => {
            if (!menu.contains(event.target) && !trigger.contains(event.target)) {
                closeShareMenu();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeShareMenu();
            }
        });
    }

    function getPageCount(viewType = currentView) {
        const pages = getDocumentData(viewType)?.pages || [];
        return Math.max(1, pages.length || 1);
    }

    function normalizeSelectedPageIndex(viewType = currentView) {
        const maxIndex = Math.max(0, getPageCount(viewType) - 1);
        const currentIndex = Number(selectedPageIndexes[viewType] || 0);
        selectedPageIndexes[viewType] = Math.min(Math.max(currentIndex, 0), maxIndex);
        return selectedPageIndexes[viewType];
    }

    function getSelectedPageIndex(viewType = currentView) {
        return normalizeSelectedPageIndex(viewType);
    }

    function setSelectedPageIndex(index, options = {}) {
        const viewType = options.viewType || currentView;
        const maxIndex = Math.max(0, getPageCount(viewType) - 1);
        const nextIndex = Math.min(Math.max(Number(index) || 0, 0), maxIndex);
        selectedPageIndexes[viewType] = nextIndex;
        if (options.lockSelection) {
            selectedPageLockUntil = Date.now() + 700;
        }

        if (viewType !== currentView) return;

        updateSelectedPageUi();
        if (options.scrollIntoView) {
            const page = document.querySelector(`.inv-page[data-page="${nextIndex + 1}"]`);
            if (page) {
                page.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    }

    function bindPageInteractionEvents() {
        const workspace = document.getElementById('sell-workspace');
        if (!workspace) return;

        const pages = Array.from(workspace.querySelectorAll('.inv-page'));
        pages.forEach((page, index) => {
            page.addEventListener('click', () => {
                setSelectedPageIndex(index, { lockSelection: true });
            });
            page.addEventListener('focusin', () => {
                setSelectedPageIndex(index, { lockSelection: true });
            });
        });

        if (workspace.dataset.pageScrollBound !== 'true') {
            workspace.dataset.pageScrollBound = 'true';
            workspace.addEventListener('scroll', handleWorkspaceScroll);
        }

        syncSelectedPageFromScroll();
    }

    function handleWorkspaceScroll() {
        if (pageScrollSyncFrame) {
            cancelAnimationFrame(pageScrollSyncFrame);
        }
        pageScrollSyncFrame = requestAnimationFrame(() => {
            pageScrollSyncFrame = null;
            syncSelectedPageFromScroll();
        });
    }

    function syncSelectedPageFromScroll() {
        const workspace = document.getElementById('sell-workspace');
        if (!workspace) return;
        if (Date.now() < selectedPageLockUntil) return;

        const pages = Array.from(workspace.querySelectorAll('.inv-page'));
        if (!pages.length) return;

        const workspaceRect = workspace.getBoundingClientRect();
        const targetTop = workspaceRect.top + 24;
        let bestIndex = getSelectedPageIndex(currentView);
        let bestDistance = Number.POSITIVE_INFINITY;

        pages.forEach((page, index) => {
            const rect = page.getBoundingClientRect();
            if (rect.bottom < workspaceRect.top + 40) return;
            const distance = Math.abs(rect.top - targetTop);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = index;
            }
        });

        if (bestIndex !== selectedPageIndexes[currentView]) {
            selectedPageIndexes[currentView] = bestIndex;
            updateSelectedPageUi();
        }
    }

    function updateSelectedPageUi() {
        const workspace = document.getElementById('sell-workspace');
        if (workspace) {
            workspace.querySelectorAll('.inv-page').forEach((page, index) => {
                page.classList.toggle('page-selected', index === getSelectedPageIndex(currentView));
            });
        }

        document.querySelectorAll('.page-thumb[data-page-index]').forEach((thumb) => {
            const isActive = Number(thumb.dataset.pageIndex) === getSelectedPageIndex(currentView);
            thumb.classList.toggle('active', isActive);
            thumb.querySelector('.page-thumb-label')?.classList.toggle('current', isActive);
            const detail = thumb.querySelector('.page-thumb-detail');
            if (detail) {
                detail.textContent = isActive ? 'Current Page' : 'Page Overview';
            }
        });

        renderPageActionsState();
    }

    function renderPageActionsState() {
        const context = document.getElementById('page-actions-context');
        const addActionBtn = document.querySelector('[data-page-action="add"]');
        const duplicateBtn = document.querySelector('[data-page-action="duplicate"]');
        const deleteBtn = document.querySelector('[data-page-action="delete"]');
        const addBtn = document.getElementById('btn-add-page');
        const selectedPageNumber = getSelectedPageIndex(currentView) + 1;
        const pageCount = getPageCount(currentView);
        const readOnly = isReadOnlyView(currentView);

        if (context) {
            context.textContent = readOnly
                ? `Viewing page ${selectedPageNumber} of ${pageCount}`
                : `Page ${selectedPageNumber} selected of ${pageCount}`;
        }
        if (addActionBtn) {
            addActionBtn.disabled = readOnly;
        }
        if (duplicateBtn) {
            duplicateBtn.disabled = readOnly || pageCount < 1;
        }
        if (deleteBtn) {
            deleteBtn.disabled = readOnly || pageCount <= 1;
        }
        if (addBtn) {
            const label = addBtn.querySelector('.btn-text');
            if (label) label.textContent = `Pages - P${selectedPageNumber}`;
            addBtn.title = `Manage page actions for page ${selectedPageNumber}`;
            addBtn.disabled = readOnly;
        }
    }

    function togglePageActionsMenu(forceOpen) {
        const menu = document.getElementById('page-actions-menu');
        if (!menu) return;

        const shouldOpen = typeof forceOpen === 'boolean'
            ? forceOpen
            : !menu.classList.contains('is-open');

        if (shouldOpen && !ensureEditableSession('manage pages')) {
            closePageActionsMenu();
            return;
        }

        menu.classList.toggle('is-open', shouldOpen);
        if (shouldOpen) {
            renderPageActionsState();
        }
    }

    function closePageActionsMenu() {
        const menu = document.getElementById('page-actions-menu');
        if (menu) {
            menu.classList.remove('is-open');
        }
    }

    function bindInvoiceEvents() {
        const workspace = document.getElementById('sell-workspace');
        if (!workspace) return;
        if (isReadOnlyView(currentView)) return;

        workspace.querySelectorAll('[contenteditable="true"]').forEach((element) => {
            element.addEventListener('blur', async () => {
                const wasHydrated = await hydrateRowFromBarcodeCell(element);
                const fieldPath = element.dataset.field || '';
                if (isManualOverrideField(fieldPath) && !hasTextInput(readElementValue(element))) {
                    element.dataset.manualOverride = 'false';
                }
                syncCurrentViewState();
                if (wasHydrated || isManualTotalsField(fieldPath) || isItemField(fieldPath)) {
                    updateTotalsInPlace();
                }
                setDirtyState(currentView, true);
                scheduleDraftPersist(currentView, 150);
            });
            element.addEventListener('input', () => {
                const fieldPath = element.dataset.field || '';
                if (isManualOverrideField(fieldPath)) {
                    element.dataset.manualOverride = 'true';
                }
                setDirtyState(currentView, true);
                if (!isManualOverrideField(fieldPath)) {
                    debounceRecalcTotals();
                }
                scheduleDraftPersist(currentView);
            });
        });
    }

    let recalcTimer = null;
    function debounceRecalcTotals() {
        clearTimeout(recalcTimer);
        recalcTimer = setTimeout(() => {
            updateTotalsInPlace();
        }, 400);
    }

    function hasTextInput(value) {
        return String(value || '').trim() !== '';
    }

    function isManualTotalsField(fieldPath) {
        return [
            'amountWordsText',
            'totalsOverride.subtotal',
            'totalsOverride.previousPagesTotal',
            'totalsOverride.totalPayable'
        ].includes(String(fieldPath || ''));
    }

    function normalizeInvoiceTotalsOverride(value = {}) {
        return {
            subtotal: '',
            previousPagesTotal: '',
            totalPayable: '',
            ...(value || {})
        };
    }

    function resolveInvoiceTotalsText(overrideText, autoText) {
        const override = String(overrideText || '').trim();
        return override || autoText || '';
    }

    function parseDocumentUnitPriceFils(value) {
        if (typeof value === 'number') return Math.round(value);
        const raw = String(value || '').trim();
        if (!raw) return 0;

        const numeric = InvoiceMath.extractNumericText(raw);
        if (!numeric) return 0;

        if (numeric.includes('.')) {
            return InvoiceMath.parseFils(numeric);
        }

        return parseInt(numeric, 10) || 0;
    }

    function formatDocumentUnitPriceFils(unitPriceFils) {
        return Number(unitPriceFils || 0) > 0
            ? `${InvoiceMath.filsToKD(unitPriceFils)} FILS`
            : '';
    }

    function setEditableCellText(cell, value) {
        if (!cell) return false;
        const nextValue = String(value || '').trim();
        if (!nextValue) return false;
        if (String(cell.textContent || '').trim()) return false;
        cell.textContent = nextValue;
        return true;
    }

    async function hydrateRowFromBarcodeCell(element) {
        if ((element?.dataset?.field || '') !== 'barcode') return false;

        const row = element.closest('tr');
        const barcode = element.textContent.trim();
        if (!row || !barcode) return false;

        const product = await Persistence.getProductByBarcode(barcode);
        if (!product) return false;

        let changed = false;
        changed = setEditableCellText(row.querySelector('[data-field="product_by"]'), product.product_by || '') || changed;
        changed = setEditableCellText(row.querySelector('[data-field="name_en"]'), product.name_en || '') || changed;
        changed = setEditableCellText(row.querySelector('[data-field="name_ar"]'), product.name_ar || '') || changed;
        changed = setEditableCellText(row.querySelector('[data-field="weight"]'), product.weight || '') || changed;
        changed = setEditableCellText(
            row.querySelector('[data-field="unit_price"]'),
            formatDocumentUnitPriceFils(product.unit_price_fils || 0)
        ) || changed;
        return changed;
    }

    function rowHasVisibleAmount(qtyText, unitPriceText) {
        return hasTextInput(qtyText) && InvoiceMath.hasNumericInput(unitPriceText);
    }

    function isManualItemTotalField(fieldPath) {
        return String(fieldPath || '') === 'total';
    }

    function isManualOverrideField(fieldPath) {
        return isManualTotalsField(fieldPath) || isManualItemTotalField(fieldPath);
    }

    function parseDocumentRowTotalFils(value) {
        return InvoiceMath.parseFils(value);
    }

    function getInvoiceRowDisplayState(row) {
        const qtyEl = row.querySelector('[data-field="qty"]');
        const priceEl = row.querySelector('[data-field="unit_price"]');
        const totalEl = row.querySelector('[data-field="total"]');
        if (!qtyEl || !priceEl || !totalEl) return null;

        const qtyText = qtyEl.textContent.trim();
        const priceText = priceEl.textContent.trim();
        const totalText = totalEl.textContent.trim();
        const qty = parseInt(qtyText, 10) || 0;
        const priceFils = parseDocumentUnitPriceFils(priceText);
        const autoRowTotalFils = InvoiceMath.rowTotal(qty, priceFils);
        const hasManualTotal = totalEl.dataset.manualOverride === 'true' && InvoiceMath.hasNumericInput(totalText);
        const rowTotalFils = hasManualTotal ? parseDocumentRowTotalFils(totalText) : autoRowTotalFils;
        const shouldShowTotal = hasManualTotal || (rowHasVisibleAmount(qtyText, priceText) && priceFils !== 0);

        return {
            totalEl,
            rowTotalFils,
            shouldShowTotal
        };
    }

    function updateTotalsInPlace() {
        if (currentView !== 'invoice') return;
        const workspace = document.getElementById('sell-workspace');
        if (!workspace) return;
        const data = Invoice.getData();
        const discountFils = InvoiceMath.parseFils(data?.discount);
        const totalsOverride = normalizeInvoiceTotalsOverride(data?.totalsOverride);
        const amountWordsOverride = String(data?.amountWordsText || '').trim();

        const pages = Array.from(workspace.querySelectorAll('.inv-page'));
        let allPagesTotal = 0;
        let hasAnyAmounts = false;

        pages.forEach((page) => {
            const rows = page.querySelectorAll('.inv-table tbody tr:not(.inv-subtotal-row)');
            let pageTotal = 0;
            let hasPageAmounts = false;

            rows.forEach((row) => {
                const rowState = getInvoiceRowDisplayState(row);
                if (!rowState) return;

                rowState.totalEl.textContent = rowState.shouldShowTotal
                    ? `${InvoiceMath.filsToKD(rowState.rowTotalFils)} KD.`
                    : '';
                pageTotal += rowState.rowTotalFils;
                hasPageAmounts = hasPageAmounts || rowState.shouldShowTotal;
            });

            const subtotalEl = page.querySelector('[data-field="page-subtotal"]');
            if (subtotalEl) {
                subtotalEl.innerHTML = `<strong>${hasPageAmounts ? `${InvoiceMath.filsToKD(pageTotal)} KD.` : ''}</strong>`;
            }

            allPagesTotal += pageTotal;
            hasAnyAmounts = hasAnyAmounts || hasPageAmounts;
        });

        const totalsTable = workspace.querySelector('.inv-totals-table');
        if (!totalsTable) return;

        const lastTotalsPage = Array.from(pages).reverse().find((page) => page.querySelector('.inv-totals-table'));
        const lastPageRows = lastTotalsPage
            ? lastTotalsPage.querySelectorAll('.inv-table tbody tr:not(.inv-subtotal-row)')
            : [];
        let lastPageTotal = 0;
        let hasLastPageAmounts = false;
        lastPageRows.forEach((row) => {
            const rowState = getInvoiceRowDisplayState(row);
            if (!rowState) return;
            lastPageTotal += rowState.rowTotalFils;
            hasLastPageAmounts = hasLastPageAmounts || rowState.shouldShowTotal;
        });

        const previousPagesTotal = allPagesTotal - lastPageTotal;
        const rows = Array.from(totalsTable.querySelectorAll('tr'));
        const subtotalRow = rows.find((row) => row.textContent.includes('Subtotal'));
        const previousRow = rows.find((row) => row.textContent.includes('Prev. Pages Total'));
        const discountRow = rows.find((row) => row.textContent.includes('Discount'));
        const grandRow = totalsTable.querySelector('.inv-tot-grand');

        if (subtotalRow) {
            const cell = subtotalRow.querySelector('.inv-tot-value');
            if (cell) {
                cell.textContent = resolveInvoiceTotalsText(
                    totalsOverride.subtotal,
                    hasLastPageAmounts ? `${InvoiceMath.filsToKD(lastPageTotal)} KD.` : ''
                );
            }
        }

        if (previousRow) {
            const cell = previousRow.querySelector('.inv-tot-value');
            if (cell) {
                cell.textContent = resolveInvoiceTotalsText(
                    totalsOverride.previousPagesTotal,
                    hasAnyAmounts ? `${InvoiceMath.filsToKD(previousPagesTotal)} KD.` : ''
                );
            }
        }

        if (discountRow) {
            const cell = discountRow.querySelector('.inv-tot-value');
            if (cell) cell.textContent = hasAnyAmounts && discountFils > 0 ? `${InvoiceMath.filsToKD(discountFils)} KD.` : '';
        }

        if (grandRow) {
            const cell = grandRow.querySelector('.inv-tot-value');
            const payableFils = Math.max(0, allPagesTotal - discountFils);
            if (cell) {
                cell.textContent = resolveInvoiceTotalsText(
                    totalsOverride.totalPayable,
                    hasAnyAmounts ? `${InvoiceMath.filsToKD(payableFils)} KD.` : ''
                );
            }
        }

        const wordsEl = workspace.querySelector('.inv-aw-text');
        if (wordsEl) {
            wordsEl.textContent = amountWordsOverride
                || (hasAnyAmounts ? InvoiceMath.amountInWords(Math.max(0, allPagesTotal - discountFils)) : '');
        }
    }

    function syncDataFromDOM() {
        const workspace = document.getElementById('sell-workspace');
        if (!workspace) return;

        const data = currentView === 'letterhead' ? Invoice.getLetterheadData() : Invoice.getData();
        const emailInput = document.getElementById('sell-share-email');
        const whatsappInput = document.getElementById('sell-share-whatsapp');
        if (!isReadOnlyView(currentView)) {
            const shareContact = getShareContact(currentView);
            if (emailInput) shareContact.email = emailInput.value.trim();
            if (whatsappInput) shareContact.whatsapp = whatsappInput.value.trim();
        }
        const pages = Array.from(workspace.querySelectorAll('.inv-page'));
        data.pages = [];

        pages.forEach((page) => {
            const pageData = { items: [] };
            if (page.querySelector('[data-page-scope="page"]')) {
                pageData.meta = {};
            }

            const rows = page.querySelectorAll('.inv-table tbody tr:not(.inv-subtotal-row)');
            rows.forEach((row) => {
                const totalEl = row.querySelector('[data-field="total"]');
                const cells = {
                    barcode: row.querySelector('[data-field="barcode"]')?.textContent?.trim() || '',
                    name_en: row.querySelector('[data-field="name_en"]')?.textContent?.trim() || '',
                    name_ar: row.querySelector('[data-field="name_ar"]')?.textContent?.trim() || '',
                    country: row.querySelector('[data-field="country"]')?.textContent?.trim() || '',
                    weight: row.querySelector('[data-field="weight"]')?.textContent?.trim() || '',
                    unit_price: row.querySelector('[data-field="unit_price"]')?.textContent?.trim() || '',
                    total: totalEl?.textContent?.trim() || '',
                    qty: row.querySelector('[data-field="qty"]')?.textContent?.trim() || '',
                    qty_by: row.querySelector('[data-field="qty_by"]')?.textContent?.trim() || '',
                    product_by: row.querySelector('[data-field="product_by"]')?.textContent?.trim() || ''
                };
                const hasManualTotal = totalEl?.dataset?.manualOverride === 'true' && InvoiceMath.hasNumericInput(cells.total);

                const hasRowContent = [
                    cells.barcode,
                    cells.name_en,
                    cells.name_ar,
                    cells.country,
                    cells.weight,
                    cells.unit_price,
                    cells.total,
                    cells.qty,
                    cells.qty_by,
                    cells.product_by
                ].some(hasTextInput);

                if (hasRowContent) {
                    pageData.items.push({
                        barcode: cells.barcode,
                        name_en: cells.name_en,
                        name_ar: cells.name_ar,
                        country: cells.country,
                        weight: cells.weight,
                        unit_price_fils: parseDocumentUnitPriceFils(cells.unit_price),
                        qty: parseInt(cells.qty, 10) || 0,
                        qty_by: cells.qty_by,
                        product_by: cells.product_by,
                        total_fils: hasManualTotal
                            ? parseDocumentRowTotalFils(cells.total)
                            : InvoiceMath.rowTotal(cells.qty, parseDocumentUnitPriceFils(cells.unit_price)),
                        total_manual_override: hasManualTotal
                    });
                }
            });

            data.pages.push(pageData);
        });

        syncEditableFieldsToData(workspace, data);
    }

    async function handleScan(scanData) {
        if (!ensureEditableSession('add items')) return;

        scanQueue.push(scanData);
        if (scanProcessing) return;
        scanProcessing = true;

        while (scanQueue.length > 0) {
            const code = scanQueue.shift();
            await processSingleScan(code);
        }

        scanProcessing = false;
    }

    async function processSingleScan(scanData) {
        syncDataFromDOM();
        const data = currentView === 'letterhead' ? Invoice.getLetterheadData() : Invoice.getData();
        const targetPageIndex = getSelectedPageIndex(currentView);
        const targetPage = Array.isArray(data.pages) ? data.pages[targetPageIndex] : null;
        const targetItem = Array.isArray(targetPage?.items)
            ? targetPage.items.find(item => String(item?.barcode || '').trim() === String(scanData || '').trim())
            : null;

        if (targetItem) {
            targetItem.qty = (parseInt(targetItem.qty, 10) || 0) + 1;
            targetItem.total_manual_override = false;
            targetItem.total_fils = InvoiceMath.rowTotal(targetItem.qty, targetItem.unit_price_fils);
        }

        if (!targetItem) {
            const product = await Persistence.getProductByBarcode(scanData);

            if (product) {
                Invoice.addItem({
                    barcode: product.barcode,
                    name_en: product.name_en,
                    name_ar: product.name_ar,
                    country: product.country,
                    weight: product.weight,
                    unit_price_fils: product.unit_price_fils,
                    qty: 1,
                    product_by: product.product_by || ''
                }, currentView, { pageIndex: targetPageIndex });
            } else {
                Invoice.addItem({ barcode: scanData, qty: 1 }, currentView, { pageIndex: targetPageIndex });
            }
        }

        setDirtyState(currentView, true);
        render();
        setSelectedPageIndex(targetPageIndex, { lockSelection: true });
        scheduleDraftPersist(currentView, 150);

        setTimeout(() => {
            const workspace = document.getElementById('sell-workspace');
            if (!workspace) return;
            const allRows = workspace.querySelectorAll('.inv-table tbody tr:not(.inv-subtotal-row)');
            for (let index = allRows.length - 1; index >= 0; index -= 1) {
                const barcodeCell = allRows[index].querySelector('[data-field="barcode"]');
                if (barcodeCell && barcodeCell.textContent.trim() === scanData) {
                    const qtyCell = allRows[index].querySelector('[data-field="qty"]');
                    if (qtyCell) {
                        qtyCell.focus();
                        const range = document.createRange();
                        range.selectNodeContents(qtyCell);
                        const selection = window.getSelection();
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }
                    break;
                }
            }
        }, 100);
    }

    function addPage() {
        if (!ensureEditableSession('add or rearrange pages')) return;

        syncDataFromDOM();
        Invoice.addPage(currentView);
        selectedPageIndexes[currentView] = getPageCount(currentView) - 1;
        setDirtyState(currentView, true);
        render();
        scheduleDraftPersist(currentView, 150);

        const data = currentView === 'letterhead' ? Invoice.getLetterheadData() : Invoice.getData();
        scrollToPage((data.pages || []).length);
    }

    function deletePageAt(idx) {
        if (!ensureEditableSession('remove pages')) return;

        syncDataFromDOM();
        Invoice.deletePage(currentView, idx);
        selectedPageIndexes[currentView] = Math.max(0, Math.min(idx, getPageCount(currentView) - 1));
        setDirtyState(currentView, true);
        render();
        scheduleDraftPersist(currentView, 150);
    }

    function duplicatePageAt(idx) {
        if (!ensureEditableSession('duplicate pages')) return;

        syncDataFromDOM();
        Invoice.duplicatePage(currentView, idx);
        selectedPageIndexes[currentView] = Math.max(0, idx + 1);
        setDirtyState(currentView, true);
        render();
        scheduleDraftPersist(currentView, 150);
    }

    function scrollToPage(pageNum) {
        selectedPageIndexes[currentView] = Math.max(0, pageNum - 1);
        updateSelectedPageUi();
        const page = document.querySelector(`.inv-page[data-page="${pageNum}"]`);
        if (page) {
            page.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    function updatePageCount() {
        const span = document.getElementById('page-count-display');
        const data = currentView === 'letterhead' ? Invoice.getLetterheadData() : Invoice.getData();
        if (span) span.textContent = `${(data.pages || []).length} page(s)`;
    }

    function getDocumentData(viewType = currentView) {
        return viewType === 'letterhead' ? Invoice.getLetterheadData() : Invoice.getData();
    }

    function normalizeShareContact(data) {
        if (!data || typeof data !== 'object') {
            return emptyShareContact();
        }

        if (!data.shareContact || typeof data.shareContact !== 'object') {
            data.shareContact = emptyShareContact();
        } else {
            data.shareContact = { ...emptyShareContact(), ...data.shareContact };
        }
        return data.shareContact;
    }

    function getShareContactOverride(viewType = currentView) {
        if (!shareContactOverrides[viewType]) {
            shareContactOverrides[viewType] = createShareContactOverride();
        }
        return shareContactOverrides[viewType];
    }

    function resetShareContactOverride(viewType = currentView) {
        shareContactOverrides[viewType] = createShareContactOverride();
        return shareContactOverrides[viewType];
    }

    function resolveShareContactValue(overrideValue, fallbackValue = '') {
        return overrideValue == null ? String(fallbackValue || '') : String(overrideValue);
    }

    function getEffectiveShareContact(viewType = currentView, sourceData = getDocumentData(viewType), options = {}) {
        const contact = normalizeShareContact(sourceData);
        const activeOverride = Object.prototype.hasOwnProperty.call(options, 'override')
            ? options.override
            : (isReadOnlyView(viewType) ? getShareContactOverride(viewType) : null);

        if (!activeOverride) {
            return { ...contact };
        }

        return {
            email: resolveShareContactValue(activeOverride.email, contact.email),
            whatsapp: resolveShareContactValue(activeOverride.whatsapp, contact.whatsapp)
        };
    }

    function getHistoryShareContactOverride(id) {
        const key = String(id || '');
        if (!key) {
            return createShareContactOverride();
        }
        if (!historyShareContactOverrides.has(key)) {
            historyShareContactOverrides.set(key, createShareContactOverride());
        }
        return historyShareContactOverrides.get(key);
    }

    function resetHistoryShareState() {
        historyShareMenuId = null;
        historyShareContactOverrides.clear();
    }

    function getShareContact(viewType = currentView) {
        const data = getDocumentData(viewType);
        return normalizeShareContact(data);
    }

    function bindShareControls() {
        const emailInput = document.getElementById('sell-share-email');
        const whatsappInput = document.getElementById('sell-share-whatsapp');
        if (!emailInput || !whatsappInput) return;

        emailInput.addEventListener('input', (event) => {
            handleShareContactInput('email', event.target.value, { trim: false });
        });
        emailInput.addEventListener('blur', (event) => {
            handleShareContactInput('email', event.target.value, { trim: true, syncInput: true });
        });
        whatsappInput.addEventListener('input', (event) => {
            handleShareContactInput('whatsapp', event.target.value, { trim: false });
        });
        whatsappInput.addEventListener('blur', (event) => {
            handleShareContactInput('whatsapp', event.target.value, { trim: true, syncInput: true });
        });
    }

    function handleShareContactInput(field, value, options = {}) {
        const contact = getShareContact(currentView);
        const nextValue = options.trim === false ? String(value || '') : String(value || '').trim();
        if (isReadOnlyView(currentView)) {
            const override = getShareContactOverride(currentView);
            override[field] = nextValue;
        } else {
            contact[field] = nextValue;
            setDirtyState(currentView, true);
            scheduleDraftPersist(currentView);
        }

        if (options.syncInput === true) {
            const input = document.getElementById(field === 'email' ? 'sell-share-email' : 'sell-share-whatsapp');
            if (input && input.value !== nextValue) {
                input.value = nextValue;
            }
        }
    }

    function renderShareControls() {
        const shareTrigger = document.getElementById('btn-share-menu');
        const shareMenu = document.getElementById('sell-share-menu');
        const shareTitle = shareMenu?.querySelector('.share-menu-title');
        const shareSubtitle = shareMenu?.querySelector('.share-menu-subtitle');
        const sharedHistoryBtn = document.getElementById('btn-share-reveal-pdf');
        const emailInput = document.getElementById('sell-share-email');
        const whatsappInput = document.getElementById('sell-share-whatsapp');
        const whatsappBtn = document.getElementById('btn-share-whatsapp');
        const gmailBtn = document.getElementById('btn-share-gmail');
        if (!shareTrigger || !shareMenu || !emailInput || !whatsappInput || !whatsappBtn || !gmailBtn) return;

        const contact = getEffectiveShareContact(currentView);
        const readOnly = isReadOnlyView(currentView);
        shareTrigger.setAttribute('aria-expanded', shareMenuOpen ? 'true' : 'false');
        shareMenu.classList.toggle('is-open', shareMenuOpen);
        shareTrigger.title = currentView === 'invoice'
            ? 'Share this invoice'
            : `Share this ${RAPID_ORDER_SHEET_LABEL_LOWER}`;
        if (shareTitle) {
            shareTitle.textContent = currentView === 'invoice' ? 'Share Invoice' : `Share ${RAPID_ORDER_SHEET_LABEL}`;
        }
        if (shareSubtitle) {
            shareSubtitle.textContent = readOnly
                ? 'Saved document is view-only. Contacts entered here are temporary and will not change the saved file.'
                : 'Gmail tries to paste the PDF automatically. WhatsApp opens faster with the PDF already copied in the background, so you can press Ctrl+V immediately.';
        }
        if (document.activeElement !== emailInput) {
            emailInput.value = String(contact.email || '');
        }
        if (document.activeElement !== whatsappInput) {
            whatsappInput.value = String(contact.whatsapp || '');
        }

        emailInput.disabled = false;
        whatsappInput.disabled = false;
        emailInput.title = readOnly
            ? 'Temporary email for this share only. The saved document will not be changed.'
            : 'Customer email used for Gmail drafts.';
        whatsappInput.title = readOnly
            ? 'Temporary WhatsApp number for this share only. The saved document will not be changed.'
            : 'Customer WhatsApp number used for WhatsApp drafts.';

        const rawPhone = resolveSharePhoneRaw(currentView);
        whatsappBtn.title = rawPhone
            ? 'Open WhatsApp draft'
            : (currentView === 'invoice'
                ? 'Enter a WhatsApp number or use the invoice contact number.'
                : `Enter a WhatsApp number to share this ${RAPID_ORDER_SHEET_LABEL_LOWER}.`);
        gmailBtn.title = String(contact.email || '').trim()
            ? 'Open Gmail draft'
            : 'Enter an email address to open Gmail.';
        if (sharedHistoryBtn) {
            sharedHistoryBtn.textContent = currentView === 'invoice'
                ? 'View Shared Invoices'
                : `View Shared ${RAPID_ORDER_SHEET_LABEL}s`;
            sharedHistoryBtn.title = currentView === 'invoice'
                ? 'See only invoices that were shared through Gmail or WhatsApp.'
                : `See only ${RAPID_ORDER_SHEET_LABEL_LOWER}s that were shared through Gmail or WhatsApp.`;
        }
    }

    function toggleShareMenu(forceOpen) {
        const shouldOpen = typeof forceOpen === 'boolean'
            ? forceOpen
            : !shareMenuOpen;
        if (shareMenuOpen === shouldOpen) return;

        shareMenuOpen = shouldOpen;
        renderShareControls();

        if (shareMenuOpen) {
            setTimeout(() => {
                const focusTarget = document.getElementById('sell-share-email')
                    || document.getElementById('sell-share-whatsapp')
                    || document.getElementById('btn-share-whatsapp')
                    || document.getElementById('btn-share-gmail');
                focusTarget?.focus();
            }, 0);
        }
    }

    function closeShareMenu() {
        if (!shareMenuOpen) {
            const shareMenu = document.getElementById('sell-share-menu');
            const shareTrigger = document.getElementById('btn-share-menu');
            if (shareMenu) shareMenu.classList.remove('is-open');
            if (shareTrigger) shareTrigger.setAttribute('aria-expanded', 'false');
            return;
        }

        shareMenuOpen = false;
        renderShareControls();
    }

    function resolveSharePhoneRaw(viewType = currentView, sourceData = getDocumentData(viewType), options = {}) {
        const contact = getEffectiveShareContact(viewType, sourceData, options);
        const explicit = String(contact.whatsapp || '').trim();
        if (explicit) return explicit;
        if (viewType === 'invoice') {
            return String(sourceData?.billTo?.phone || '').trim();
        }
        return '';
    }

    function normalizeWhatsappTarget(rawValue) {
        let value = String(rawValue || '').trim();
        if (!value) return null;

        value = value.replace(/[\s\-()]+/g, '');
        if (value.startsWith('00')) {
            value = `+${value.slice(2)}`;
        }
        if (/^\d{8}$/.test(value)) {
            value = `+965${value}`;
        }
        if (!/^\+?\d+$/.test(value)) {
            return null;
        }

        const digits = value.replace(/\D/g, '');
        if (!digits) return null;
        return {
            normalized: value.startsWith('+') ? value : `+${digits}`,
            digits
        };
    }

    function isValidEmailAddress(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
    }

    function buildShareRecipientName(viewType = currentView, sourceData = getDocumentData(viewType)) {
        const data = sourceData || {};
        if (viewType === 'invoice') {
            return String(
                data?.billTo?.name
                || data?.billTo?.person
                || data?.billTo?.nameAr
                || data?.billTo?.personAr
                || ''
            ).trim();
        }

        return String(data?.to || data?.toAr || '').trim();
    }

    function buildShareGreeting(viewType = currentView, sourceData = getDocumentData(viewType)) {
        const recipientName = buildShareRecipientName(viewType, sourceData);
        return recipientName ? `Dear ${recipientName},` : 'Dear Customer,';
    }

    function buildShareSubject(viewType = currentView, sourceData = getDocumentData(viewType)) {
        const data = sourceData || getDocumentData(viewType);
        if (viewType === 'invoice') {
            return `Invoice Details - ${String(data.invoiceNumber || describeCurrentWorkspace(viewType) || 'Invoice').trim()}`;
        }

        const targetLabel = String(data.to || data.date || describeCurrentWorkspace(viewType) || RAPID_ORDER_SHEET_LABEL).trim();
        return `${RAPID_ORDER_SHEET_LABEL} - ${targetLabel}`;
    }

    function buildShareBody(viewType = currentView, sourceData = getDocumentData(viewType)) {
        if (viewType === 'invoice') {
            const invoiceNumber = String(
                sourceData?.invoiceNumber
                || describeCurrentWorkspace(viewType)
                || 'your recent order'
            ).trim();
            return [
                buildShareGreeting(viewType, sourceData),
                '',
                `Please find Invoice ${invoiceNumber} for the items you ordered.`,
                'Kindly review it at your convenience, and feel free to contact us if you need any clarification.',
                '',
                'Thank you for your business.'
            ].join('\n');
        }

        return [
            buildShareGreeting(viewType, sourceData),
            '',
            `Please find our latest ${RAPID_ORDER_SHEET_LABEL_LOWER} with the available items.`,
            'Kindly review the details and let us know which items you would like to order.',
            '',
            'We will be glad to assist you.'
        ].join('\n');
    }

    function sanitizeShareFileSegment(value) {
        const sanitized = String(value || '')
            .trim()
            .replace(/[^a-zA-Z0-9._-]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        return sanitized || 'document';
    }

    function buildShareFileName(viewType = currentView) {
        const data = getDocumentData(viewType);
        const label = viewType === 'invoice'
            ? (data.invoiceNumber || describeCurrentWorkspace(viewType))
            : (data.to || data.date || describeCurrentWorkspace(viewType));
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `${viewType}-${sanitizeShareFileSegment(label)}-${timestamp}.pdf`;
    }

    function buildSharedArchiveFileName(viewType = currentView, sourceData = getDocumentData(viewType), channel = '') {
        const label = viewType === 'invoice'
            ? (sourceData?.invoiceNumber || describeCurrentWorkspace(viewType))
            : (sourceData?.to || sourceData?.date || describeCurrentWorkspace(viewType));
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const channelSegment = sanitizeShareFileSegment(channel || 'share');
        return `${viewType}-${sanitizeShareFileSegment(label)}-${channelSegment}-${timestamp}.pdf`;
    }

    async function archiveSharedDocument(filePath, viewType, sourceData, channel, options = {}) {
        if (!window.electronAPI?.archiveSharePdf) return null;

        const archiveResult = await window.electronAPI.archiveSharePdf(
            filePath,
            viewType,
            buildSharedArchiveFileName(viewType, sourceData, channel)
        );
        if (!archiveResult?.success || !archiveResult.filePath) {
            throw new Error(archiveResult?.error || 'The shared PDF archive could not be created.');
        }

        const contact = getEffectiveShareContact(viewType, sourceData, {
            override: options.contactOverride || null
        });
        const recipient = buildShareRecipientName(viewType, sourceData);
        return Persistence.recordSharedHistory(viewType, {
            id: `${viewType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            docLabel: viewType === 'invoice'
                ? String(sourceData?.invoiceNumber || describeCurrentWorkspace(viewType) || 'Invoice').trim()
                : String(sourceData?.to || sourceData?.date || describeCurrentWorkspace(viewType) || RAPID_ORDER_SHEET_LABEL).trim(),
            channel,
            recipient,
            email: String(contact.email || '').trim(),
            whatsapp: String(resolveSharePhoneRaw(viewType, sourceData, {
                override: options.contactOverride || null
            }) || '').trim(),
            filePath: archiveResult.filePath,
            sharedAt: new Date().toISOString()
        });
    }

    function buildGmailUrl(email, subject, body) {
        const params = new URLSearchParams({
            view: 'cm',
            fs: '1',
            to: email,
            su: subject,
            body
        });
        return `https://mail.google.com/mail/?${params.toString()}`;
    }

    function buildWhatsappUrl(numberDigits, body) {
        const params = new URLSearchParams({ text: body });
        return `https://wa.me/${numberDigits}?${params.toString()}`;
    }

    function buildWhatsappDesktopUrl(numberDigits, body) {
        const params = new URLSearchParams({
            phone: numberDigits,
            text: body
        });
        return `whatsapp://send?${params.toString()}`;
    }

    function buildSharePdfSignature(snapshot) {
        const documentData = deepClone(snapshot?.document || {});
        if (documentData && typeof documentData === 'object' && documentData.shareContact) {
            documentData.shareContact = emptyShareContact();
        }

        return JSON.stringify({
            viewType: snapshot?.viewType || currentView,
            manualPagination: !!snapshot?.manualPagination,
            amountWordsText: String(snapshot?.amountWordsText || ''),
            document: documentData
        });
    }

    function resetSharePdfCache(viewType = currentView) {
        sharePdfCache[viewType] = createSharePdfCacheState();
        return sharePdfCache[viewType];
    }

    async function shareFileExists(filePath) {
        const normalized = String(filePath || '').trim();
        if (!normalized) return false;
        if (!window.electronAPI?.pathExists) return true;

        try {
            const result = await window.electronAPI.pathExists(normalized);
            return !!result?.exists;
        } catch (_) {
            return false;
        }
    }

    async function prepareShareFile(snapshot, viewType = currentView, options = {}) {
        const cache = sharePdfCache[viewType] || createSharePdfCacheState();
        sharePdfCache[viewType] = cache;

        const signature = buildSharePdfSignature(snapshot);
        if (!options.forceRefresh && cache.signature === signature && cache.filePath) {
            if (await shareFileExists(cache.filePath)) {
                return cache.filePath;
            }
            cache.filePath = '';
        }
        if (!options.forceRefresh && cache.signature === signature && cache.pending) {
            return cache.pending;
        }

        cache.signature = signature;
        const pending = (async () => {
            const pdfBytes = await PrintManager.exportSnapshotToPdf(snapshot, { preset: 'share' });
            const result = await window.electronAPI?.saveShareCachePdf?.(buildShareFileName(viewType), pdfBytes);
            if (!result?.success || !result.filePath) {
                throw new Error(result?.error || 'The share PDF could not be saved.');
            }
            if (cache.pending === pending && cache.signature === signature) {
                cache.filePath = result.filePath;
            }
            return result.filePath;
        })();

        cache.pending = pending;
        try {
            return await pending;
        } catch (error) {
            cache.signature = '';
            cache.filePath = '';
            throw error;
        } finally {
            if (cache.pending === pending) {
                cache.pending = null;
            }
        }
    }

    function isMissingShareFileError(error) {
        const message = String(error?.message || error || '');
        return /selected pdf file could not be found|share pdf could not be revealed|requested file/i.test(message);
    }

    async function copyTextToClipboard(text) {
        const value = String(text || '');
        if (!value) return false;

        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }

        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, value.length);
        const copied = document.execCommand('copy');
        textarea.remove();
        return copied;
    }

    function getShareHelperValue(kind, viewType = currentView, sourceData = getDocumentData(viewType), options = {}) {
        if (kind === 'message') {
            return buildShareBody(viewType, sourceData);
        }
        if (kind === 'email') {
            return String(getEffectiveShareContact(viewType, sourceData, options).email || '').trim();
        }
        if (kind === 'whatsapp') {
            return String(resolveSharePhoneRaw(viewType, sourceData, options) || '').trim();
        }
        return '';
    }

    async function copyShareHelper(kind, viewType = currentView, sourceData = getDocumentData(viewType), options = {}) {
        const value = getShareHelperValue(kind, viewType, sourceData, options);
        const messages = {
            message: {
                missing: 'No share message is available yet.',
                success: 'Share message copied.'
            },
            email: {
                missing: 'Enter a customer email first.',
                success: 'Customer email copied.'
            },
            whatsapp: {
                missing: 'Enter a WhatsApp number first.',
                success: 'WhatsApp number copied.'
            }
        };
        const labels = messages[kind] || messages.message;

        if (!value) {
            Notification.show(labels.missing, 'warning');
            return false;
        }

        try {
            const copied = await copyTextToClipboard(value);
            if (!copied) {
                throw new Error('Clipboard access was blocked.');
            }
            Notification.show(labels.success, 'success');
            return true;
        } catch (error) {
            Notification.show(`Copy failed: ${error.message}`, 'error');
            return false;
        }
    }

    async function revealShareFileForSnapshot(snapshot, viewType = currentView) {
        if (!window.electronAPI?.showItemInFolder) {
            Notification.show('File reveal is not available in this environment.', 'error');
            return false;
        }

        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const filePath = await prepareShareFile(snapshot, viewType, {
                    forceRefresh: attempt > 0
                });
                const result = await window.electronAPI.showItemInFolder(filePath);
                if (result?.success === false) {
                    throw new Error(result.error || 'The share PDF could not be revealed.');
                }
                Notification.show('Share PDF highlighted. Attach it from the opened folder view.', 'success');
                return true;
            } catch (error) {
                if (attempt === 0 && isMissingShareFileError(error)) {
                    resetSharePdfCache(viewType);
                    continue;
                }
                Notification.show(`Unable to reveal the share PDF: ${error.message}`, 'error');
                return false;
            }
        }

        return false;
    }

    function getSavedDocumentPayload(record, viewType) {
        return deepClone(record.payload || (viewType === 'invoice'
            ? Invoice.defaultInvoiceData()
            : Invoice.defaultLetterheadData()));
    }

    async function loadSavedShareContext(id) {
        const record = await Persistence.getDocument(id);
        if (!record) {
            Notification.show('Saved document could not be loaded.', 'error');
            return null;
        }

        const viewType = record.doc_type || 'letterhead';
        const payload = getSavedDocumentPayload(record, viewType);
        const snapshot = buildPrintSnapshotFromRecord({
            ...record,
            doc_type: viewType,
            payload
        });

        return { record, viewType, payload, snapshot };
    }

    async function shareWithSnapshot(channel, snapshot, viewType, sourceData, options = {}) {
        if (!window.electronAPI?.startAutoShare) {
            Notification.show('Sharing is not available in this environment.', 'error');
            return false;
        }

        if (!snapshot) {
            Notification.show('No document content is available to share.', 'warning');
            return false;
        }

        const shareTarget = buildShareAutomationRequest(channel, viewType, sourceData, {
            override: options.contactOverride || null
        });
        if (!shareTarget) return false;

        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const filePath = await prepareShareFile(snapshot, viewType, {
                    forceRefresh: attempt > 0
                });

                const automationResult = await window.electronAPI.startAutoShare({
                    ...shareTarget,
                    filePath
                });
                if (automationResult?.success === false) {
                    throw new Error(automationResult.error || 'The share draft could not be opened.');
                }

                try {
                    await archiveSharedDocument(filePath, viewType, sourceData, channel, {
                        contactOverride: options.contactOverride || null
                    });
                } catch (archiveError) {
                    console.warn('Shared document archive failed:', archiveError);
                }

                if (options.closeMenu !== false) {
                    closeShareMenu();
                }

                const autoPasted = automationResult?.autoPasted !== false;
                if (channel === 'whatsapp') {
                    Notification.show(
                        'WhatsApp opened. The PDF was prepared and copied in the background. Press Ctrl+V to attach it quickly, then send.',
                        'success'
                    );
                } else {
                    Notification.show(
                        autoPasted
                            ? 'Gmail draft opened. The PDF was prepared in the background and pasted automatically. Review it, then press Send.'
                            : 'Gmail draft opened. The PDF was prepared and copied in the background. If it did not attach automatically, press Ctrl+V and then Send.',
                        autoPasted ? 'success' : 'info'
                    );
                }
                return true;
            } catch (error) {
                if (attempt === 0 && isMissingShareFileError(error)) {
                    resetSharePdfCache(viewType);
                    continue;
                }
                console.error('Share failed:', error);
                Notification.show(`Share failed: ${error.message}`, 'error');
                return false;
            }
        }

        return false;
    }

    async function shareCurrentDocument(channel) {
        syncCurrentViewState();
        const snapshot = getPrintSnapshot(currentView);
        await shareWithSnapshot(channel, snapshot, currentView, getDocumentData(currentView), {
            closeMenu: true,
            contactOverride: isReadOnlyView(currentView) ? getShareContactOverride(currentView) : null
        });
    }

    async function copyCurrentShareHelper(kind) {
        syncCurrentViewState();
        return copyShareHelper(kind, currentView, getDocumentData(currentView), {
            override: isReadOnlyView(currentView) ? getShareContactOverride(currentView) : null
        });
    }

    async function revealCurrentSharePdf() {
        syncCurrentViewState();
        const snapshot = getPrintSnapshot(currentView);
        return revealShareFileForSnapshot(snapshot, currentView);
    }

    async function shareSavedDocumentById(id, channel, options = {}) {
        const context = await loadSavedShareContext(id);
        if (!context) return false;

        return shareWithSnapshot(channel, context.snapshot, context.viewType, context.payload, {
            closeMenu: false,
            contactOverride: options.contactOverride || null
        });
    }

    async function copySavedDocumentShareHelper(id, kind, options = {}) {
        const context = await loadSavedShareContext(id);
        if (!context) return false;

        return copyShareHelper(kind, context.viewType, context.payload, {
            override: options.contactOverride || null
        });
    }

    async function revealSavedDocumentSharePdfById(id) {
        const context = await loadSavedShareContext(id);
        if (!context) return false;
        return revealShareFileForSnapshot(context.snapshot, context.viewType);
    }

    function buildShareAutomationRequest(channel, viewType = currentView, sourceData = getDocumentData(viewType), options = {}) {
        const contact = getEffectiveShareContact(viewType, sourceData, options);
        const subject = buildShareSubject(viewType, sourceData);
        const body = buildShareBody(viewType, sourceData);

        if (channel === 'gmail') {
            const email = String(contact.email || '').trim();
            if (!isValidEmailAddress(email)) {
                Notification.show('Enter a valid customer email address before opening Gmail.', 'warning');
                return null;
            }
            return {
                channel: 'gmail',
                targetUrl: buildGmailUrl(email, subject, body)
            };
        }

        const phone = normalizeWhatsappTarget(resolveSharePhoneRaw(viewType, sourceData, options));
        if (!phone) {
            Notification.show('Enter a valid WhatsApp number before opening WhatsApp.', 'warning');
            return null;
        }
        return {
            channel: 'whatsapp',
            targetUrl: buildWhatsappDesktopUrl(phone.digits, body),
            fallbackUrl: buildWhatsappUrl(phone.digits, body)
        };
    }

    function setDraftStatus(viewType, state, extras = {}) {
        if (!draftStatus[viewType]) return;
        draftStatus[viewType] = {
            ...draftStatus[viewType],
            state,
            ...extras
        };

        if (viewType === currentView) {
            renderDraftStatus();
        }
    }

    function formatDraftStatusTimestamp(value) {
        if (!value) return 'recently';
        const date = value instanceof Date ? value : new Date(String(value));
        if (Number.isNaN(date.getTime())) return 'recently';
        return date.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function renderDraftStatus() {
        const statusEl = document.getElementById('sell-draft-status');
        if (!statusEl) return;

        const state = draftStatus[currentView] || { state: 'idle', savedAt: null, message: '' };
        let text = 'No draft pending';

        if (state.state === 'dirty') {
            text = 'Unsaved changes';
        } else if (state.state === 'saving') {
            text = 'Saving draft...';
        } else if (state.state === 'saved' && state.savedAt) {
            text = `Draft saved ${formatDraftStatusTimestamp(state.savedAt)}`;
        } else if (state.state === 'error') {
            text = state.message || 'Draft save failed';
        }

        statusEl.dataset.state = state.state || 'idle';
        const textNode = statusEl.querySelector('.draft-status-text');
        if (textNode) {
            textNode.textContent = text;
        } else {
            statusEl.textContent = text;
        }
    }

    function setDirtyState(viewType, value) {
        if (Object.prototype.hasOwnProperty.call(dirtyFlags, viewType)) {
            dirtyFlags[viewType] = !!value;
            if (value) {
                setDraftStatus(viewType, 'dirty', { message: '', savedAt: draftStatus[viewType]?.savedAt || null });
            } else if (draftStatus[viewType]?.state === 'dirty') {
                setDraftStatus(viewType, draftStatus[viewType]?.savedAt ? 'saved' : 'idle');
            } else if (viewType === currentView) {
                renderDraftStatus();
            }
        }
    }

    function hasUnsavedChanges(viewType = currentView) {
        return !!dirtyFlags[viewType];
    }

    function syncCurrentViewState() {
        const workspace = document.getElementById('sell-workspace');
        if (!workspace || !workspace.querySelector('.inv-page')) return;
        syncDataFromDOM();
    }

    function normalizeManualBarcodeComparisonValue(value) {
        return String(value || '').trim();
    }

    function compareInvoiceItemWithProduct(item, product) {
        const mismatches = [];
        if (normalizeManualBarcodeComparisonValue(item?.product_by) !== normalizeManualBarcodeComparisonValue(product?.product_by)) {
            mismatches.push('Product By');
        }
        if (normalizeManualBarcodeComparisonValue(item?.name_en) !== normalizeManualBarcodeComparisonValue(product?.name_en)) {
            mismatches.push('Item Name');
        }
        if (normalizeManualBarcodeComparisonValue(item?.name_ar) !== normalizeManualBarcodeComparisonValue(product?.name_ar)) {
            mismatches.push('Arabic Name');
        }
        if (normalizeManualBarcodeComparisonValue(item?.weight) !== normalizeManualBarcodeComparisonValue(product?.weight)) {
            mismatches.push('Weight');
        }

        const itemUnitPriceFils = parseDocumentUnitPriceFils(item?.unit_price_fils ?? item?.unit_price ?? 0);
        const productUnitPriceFils = Number(product?.unit_price_fils || 0) || 0;
        if (itemUnitPriceFils !== productUnitPriceFils) {
            mismatches.push('Unit Price');
        }

        return mismatches;
    }

    async function collectInvoiceBarcodeUpdatesForPrint() {
        syncCurrentViewState();
        const data = Invoice.getData();
        const matches = [];

        for (let pageIndex = 0; pageIndex < (data.pages || []).length; pageIndex += 1) {
            const page = data.pages[pageIndex];
            for (let itemIndex = 0; itemIndex < (page.items || []).length; itemIndex += 1) {
                const item = page.items[itemIndex];
                const barcode = String(item?.barcode || '').trim();
                if (!barcode) continue;

                const product = await Persistence.getProductByBarcode(barcode);
                if (!product) continue;

                const mismatches = compareInvoiceItemWithProduct(item, product);
                if (!mismatches.length) continue;

                matches.push({
                    pageIndex,
                    itemIndex,
                    barcode,
                    item,
                    product,
                    mismatches
                });
            }
        }

        return matches;
    }

    function applyInvoiceBarcodeUpdates(matches) {
        const data = Invoice.getData();
        matches.forEach((match) => {
            const page = data.pages?.[match.pageIndex];
            const item = page?.items?.[match.itemIndex];
            if (!item) return;

            item.product_by = match.product.product_by || '';
            item.name_en = match.product.name_en || '';
            item.name_ar = match.product.name_ar || '';
            item.weight = match.product.weight || '';
            item.unit_price_fils = Number(match.product.unit_price_fils || 0) || 0;
            item.total_manual_override = false;
            item.total_fils = InvoiceMath.rowTotal(item.qty, item.unit_price_fils);
        });
    }

    function showInvoiceBarcodeUpdateModal(matches) {
        return new Promise((resolve) => {
            const modal = document.getElementById('invoice-barcode-update-modal');
            const body = document.getElementById('invoice-barcode-update-body');
            const updateBtn = document.getElementById('invoice-barcode-update-confirm');
            const skipBtn = document.getElementById('invoice-barcode-update-skip');
            const cancelBtn = document.getElementById('invoice-barcode-update-cancel');
            const closeBtn = document.getElementById('invoice-barcode-update-close');

            if (!modal || !body || !updateBtn || !skipBtn || !cancelBtn || !closeBtn) {
                resolve('skip');
                return;
            }

            body.innerHTML = matches.map((match) => `
                <div class="invoice-barcode-update-item">
                    <div class="invoice-barcode-update-title">${esc(match.item?.name_en || match.product?.name_en || match.barcode)}</div>
                    <div class="invoice-barcode-update-meta">Barcode: ${esc(match.barcode)} | Update: ${esc(match.mismatches.join(', '))}</div>
                </div>
            `).join('');

            App?.showModal?.(modal);
            const controller = new AbortController();
            const finish = (choice) => {
                controller.abort();
                App?.hideModal?.(modal);
                resolve(choice);
            };

            updateBtn.addEventListener('click', () => finish('update'), { signal: controller.signal });
            skipBtn.addEventListener('click', () => finish('skip'), { signal: controller.signal });
            cancelBtn.addEventListener('click', () => finish('cancel'), { signal: controller.signal });
            closeBtn.addEventListener('click', () => finish('cancel'), { signal: controller.signal });
        });
    }

    async function resolveInvoiceBarcodeUpdatesBeforePrint() {
        if (currentView !== 'invoice' || isReadOnlyView(currentView)) {
            return { proceed: true, updated: false };
        }

        const matches = await collectInvoiceBarcodeUpdatesForPrint();
        if (!matches.length) {
            return { proceed: true, updated: false };
        }

        const choice = await showInvoiceBarcodeUpdateModal(matches);
        if (choice === 'cancel') {
            return { proceed: false, updated: false };
        }

        if (choice === 'update') {
            applyInvoiceBarcodeUpdates(matches);
            setDirtyState(currentView, true);
            render();
            scheduleDraftPersist(currentView, 150);
            Notification.show('Matched barcode rows updated from My Stocks.', 'success');
            return { proceed: true, updated: true };
        }

        return { proceed: true, updated: false };
    }

    async function resetDocumentWorkspace(viewType = currentView, options = {}) {
        if (viewType === 'invoice') {
            Invoice.resetInvoice();
            const invNum = await Persistence.getNextInvoiceNumber();
            Invoice.getData().invoiceNumber = invNum.formatted;
        } else {
            Invoice.resetLetterhead();
        }

        currentDocumentIds[viewType] = null;
        currentDocumentLabels[viewType] = '';
        resetDocumentSession(viewType);
        resetShareContactOverride(viewType);

        if (options.clearDraft !== false) {
            await clearDraft(viewType);
        } else {
            setDraftStatus(viewType, 'idle', { savedAt: null, message: '' });
        }

        setDirtyState(viewType, false);

        if (viewType === currentView) {
            updateToolbar();
            render();
        }
    }

    function shouldPromptBeforeOpen(viewType = currentView) {
        return isReadOnlyView(viewType)
            || !!currentDocumentIds[viewType]
            || hasUnsavedChanges(viewType)
            || hasMeaningfulDocumentContent(viewType);
    }

    async function saveDraftSnapshot(viewType = currentView) {
        const wasDirty = hasUnsavedChanges(viewType);
        if (!wasDirty) {
            setDirtyState(viewType, true);
        }

        try {
            await persistDraft(viewType, {
                force: true,
                syncCurrentView: currentView === viewType
            });
            return true;
        } catch (error) {
            console.error('Draft snapshot failed:', error);
            Notification.show('Current work could not be saved as a draft.', 'error');
            return false;
        } finally {
            if (!wasDirty) {
                setDirtyState(viewType, false);
            }
        }
    }

    function showHistoryOpenGuardModal(record) {
        return new Promise((resolve) => {
            const modal = document.getElementById('history-open-guard-modal');
            const currentLabel = document.getElementById('history-open-guard-current');
            const targetLabel = document.getElementById('history-open-guard-target');
            const cancelBtn = document.getElementById('history-open-guard-cancel');
            const discardBtn = document.getElementById('history-open-guard-discard');
            const draftBtn = document.getElementById('history-open-guard-draft');
            const saveBtn = document.getElementById('history-open-guard-save');

            if (!modal || !currentLabel || !targetLabel || !cancelBtn || !discardBtn || !draftBtn || !saveBtn) {
                resolve('discard');
                return;
            }

            currentLabel.textContent = describeCurrentWorkspace(currentView);
            targetLabel.textContent = describeSavedRecord(record);
            App?.showModal?.(modal);

            const controller = new AbortController();
            const finish = (choice) => {
                controller.abort();
                App?.hideModal?.(modal);
                resolve(choice);
            };

            cancelBtn.addEventListener('click', () => finish('cancel'), { signal: controller.signal });
            discardBtn.addEventListener('click', () => finish('discard'), { signal: controller.signal });
            draftBtn.addEventListener('click', () => finish('draft'), { signal: controller.signal });
            saveBtn.addEventListener('click', () => finish('save'), { signal: controller.signal });
        });
    }

    async function newDocument(options = {}) {
        if (hasUnsavedChanges()) {
            if (options.discardUnsaved === true) {
                await resetDocumentWorkspace(currentView);
                return;
            }

            const result = await showConfirmNewModal();
            if (result === 'cancel') return;
            if (result === 'save') {
                const saved = await saveCurrentDocumentFromUserAction();
                if (!saved) return;
            }
        }

        await resetDocumentWorkspace(currentView);
    }

    function showConfirmNewModal() {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirm-new-modal');
            const saveBtn = document.getElementById('cn-save-btn');
            const discardBtn = document.getElementById('cn-discard-btn');
            const cancelBtn = document.getElementById('cn-cancel-btn');
            if (!modal) {
                resolve('discard');
                return;
            }
            if (!saveBtn || !discardBtn || !cancelBtn) {
                resolve('discard');
                return;
            }

            App?.showModal?.(modal);

            const controller = new AbortController();
            const finish = (choice) => {
                controller.abort();
                App?.hideModal?.(modal);
                resolve(choice);
            };

            saveBtn.addEventListener('click', () => finish('save'), { signal: controller.signal });
            discardBtn.addEventListener('click', () => finish('discard'), { signal: controller.signal });
            cancelBtn.addEventListener('click', () => finish('cancel'), { signal: controller.signal });
        });
    }

    async function saveDocument(options = {}) {
        if (isReadOnlyView(currentView) && !options.allowReadOnly) {
            Notification.show('Open this saved document in edit mode before saving.', 'warning');
            return null;
        }

        syncDataFromDOM();
        const data = getDocumentData(currentView);
        const allItems = [];
        (data.pages || []).forEach((page) => allItems.push(...(page.items || [])));
        const docNumber = String(
            options.docNumber
            || currentDocumentLabels[currentView]
            || buildDocumentNumber(currentView, data)
            || ''
        ).trim();

        const doc = {
            id: currentDocumentIds[currentView] || undefined,
            doc_type: currentView,
            doc_number: docNumber,
            payload: data,
            status: 'saved',
            total_fils: InvoiceMath.subtotal(allItems)
        };

        const saved = await Persistence.saveDocument(doc);
        if (!saved) {
            if (!options.silent) {
                Notification.show('Document save failed.', 'error');
            }
            return null;
        }

        const isNewDocument = !currentDocumentIds[currentView];
        currentDocumentIds[currentView] = saved.id || currentDocumentIds[currentView];
        currentDocumentLabels[currentView] = docNumber;
        setDocumentSession(currentView, {
            mode: 'edit-original',
            sourceId: currentDocumentIds[currentView],
            sourceLabel: docNumber,
            suggestedCopyLabel: buildSuggestedCopyLabel(docNumber, currentView)
        });
        if (currentView === 'invoice' && isNewDocument) {
            await Persistence.incrementInvoiceNumber();
        }

        await clearDraft(currentView);
        setDirtyState(currentView, false);
        if (!options.silent) {
            Notification.show('Document saved successfully!', 'success');
        }
        return saved;
    }

    async function promptSaveDocument() {
        if (isReadOnlyView(currentView)) {
            Notification.show('Choose Edit Original or Edit Copy before saving.', 'warning');
            return null;
        }

        const docNumber = await showSaveDocumentModal(currentView);
        if (docNumber == null) return null;
        return saveDocument({ docNumber });
    }

    async function saveCurrentDocumentFromUserAction(options = {}) {
        if (currentDocumentIds[currentView] || currentDocumentLabels[currentView]) {
            return saveDocument(options);
        }
        return promptSaveDocument();
    }

    function showSaveDocumentModal(viewType = currentView) {
        return new Promise((resolve) => {
            const modal = document.getElementById('save-template-modal');
            const title = document.getElementById('save-template-modal-title');
            const input = document.getElementById('st-template-name');
            const cancelBtn = document.getElementById('st-cancel-btn');
            const saveBtn = document.getElementById('st-save-btn');
            const closeBtn = modal?.querySelector('.modal-close');
            const label = modal?.querySelector('label');
            if (!modal || !title || !label || !input || !cancelBtn || !saveBtn || !closeBtn) {
                resolve(buildSuggestedDocumentLabel(viewType));
                return;
            }

            const suggestedName = currentDocumentLabels[viewType]
                || getDocumentSession(viewType).suggestedCopyLabel
                || buildSuggestedDocumentLabel(viewType);
            title.textContent = viewType === 'invoice' ? 'Save Invoice' : `Save ${RAPID_ORDER_SHEET_LABEL}`;
            label.textContent = viewType === 'invoice' ? 'Invoice Name' : `${RAPID_ORDER_SHEET_LABEL} Name`;
            input.placeholder = viewType === 'invoice' ? 'Enter invoice name' : `Enter ${RAPID_ORDER_SHEET_LABEL_LOWER} name`;
            input.value = suggestedName;
            App?.showModal?.(modal);
            const controller = new AbortController();

            const finish = (value) => {
                controller.abort();
                App?.hideModal?.(modal);
                resolve(value);
            };

            closeBtn.addEventListener('click', () => finish(null), { signal: controller.signal });
            cancelBtn.addEventListener('click', () => finish(null), { signal: controller.signal });
            saveBtn.addEventListener('click', () => finish(input.value.trim() || suggestedName), { signal: controller.signal });
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    finish(input.value.trim() || suggestedName);
                }
            }, { signal: controller.signal });

            requestAnimationFrame(() => {
                input.focus();
                input.select();
            });
        });
    }

    async function openHistoryModal(query = '', options = {}) {
        const modal = document.getElementById('template-modal');
        const list = document.getElementById('template-list');
        const titleEl = document.getElementById('template-modal-title');
        const searchInput = document.getElementById('history-search');
        if (!modal || !list || !searchInput) return;
        historyModalMode = 'saved';

        if (!options.preserveSelection) {
            selectedHistoryId = null;
        }

        const effectiveQuery = typeof query === 'string' ? query : searchInput.value.trim();
        if (searchInput.value !== effectiveQuery) {
            searchInput.value = effectiveQuery;
        }

        const entries = await Persistence.getDocumentHistory(currentView, effectiveQuery);
        if (selectedHistoryId && !entries.some((entry) => String(entry.id) === String(selectedHistoryId))) {
            selectedHistoryId = null;
        }

        if (titleEl) {
            titleEl.textContent = currentView === 'invoice'
                ? 'View Previous Saved Invoices'
                : `View Previous Saved ${RAPID_ORDER_SHEET_LABEL}s`;
        }
        searchInput.placeholder = 'Search by number, customer, date, or saved content';

        renderHistoryEntries(list, entries);
        App?.showModal?.(modal);
    }

    async function openSharedHistoryModal(query = '', options = {}) {
        const modal = document.getElementById('template-modal');
        const list = document.getElementById('template-list');
        const titleEl = document.getElementById('template-modal-title');
        const searchInput = document.getElementById('history-search');
        if (!modal || !list || !searchInput) return;
        historyModalMode = 'shared';

        if (!options.preserveSelection) {
            selectedHistoryId = null;
        }

        const effectiveQuery = typeof query === 'string' ? query : searchInput.value.trim();
        if (searchInput.value !== effectiveQuery) {
            searchInput.value = effectiveQuery;
        }

        const entries = await Persistence.getSharedHistory(currentView, effectiveQuery);
        if (selectedHistoryId && !entries.some((entry) => String(entry.id) === String(selectedHistoryId))) {
            selectedHistoryId = null;
        }

        if (titleEl) {
            titleEl.textContent = currentView === 'invoice'
                ? 'View Shared Invoices'
                : `View Shared ${RAPID_ORDER_SHEET_LABEL}s`;
        }
        searchInput.placeholder = currentView === 'invoice'
            ? 'Search shared invoices by number, recipient, channel, or date'
            : `Search shared ${RAPID_ORDER_SHEET_LABEL_LOWER}s by recipient, channel, or date`;

        renderSharedHistoryEntries(list, entries);
        App?.showModal?.(modal);
    }

    async function openSavedDocumentById(id) {
        const record = await Persistence.getDocument(id);
        if (!record) {
            Notification.show('Saved document could not be loaded.', 'error');
            return;
        }

        if (shouldPromptBeforeOpen(currentView)) {
            const result = await showHistoryOpenGuardModal(record);
            if (result === 'cancel') return;
            if (result === 'save') {
                const saved = await saveCurrentDocumentFromUserAction({ allowReadOnly: true });
                if (!saved) return;
            } else if (result === 'draft') {
                const draftSaved = await saveDraftSnapshot(currentView);
                if (!draftSaved) return;
            }
        }

        loadSavedDocument(record, { mode: 'view' });
    }

    async function printSavedDocumentById(id) {
        const record = await Persistence.getDocument(id);
        if (!record) {
            Notification.show('Saved document could not be loaded.', 'error');
            return;
        }

        const snapshot = buildPrintSnapshotFromRecord(record);
        closeHistoryModal();
        await PrintManager.startPrintFlow(record.doc_type || currentView, {
            snapshot,
            skipDeduction: true
        });
    }

    function loadSavedDocument(record, options = {}) {
        const targetView = record.doc_type || 'letterhead';
        const sourceLabel = describeSavedRecord(record);
        const mode = options.mode || 'view';
        resetShareContactOverride(targetView);

        if (targetView === 'invoice') {
            Invoice.setData(record.payload || {});
            currentDocumentIds.invoice = record.id || null;
            currentDocumentLabels.invoice = sourceLabel;
        } else {
            Invoice.setLetterheadData(record.payload || {});
            currentDocumentIds.letterhead = record.id || null;
            currentDocumentLabels.letterhead = sourceLabel;
        }

        setDocumentSession(targetView, {
            mode,
            sourceId: record.id || null,
            sourceLabel,
            suggestedCopyLabel: buildSuggestedCopyLabel(sourceLabel, targetView)
        });

        currentView = targetView;
        const viewSelect = document.getElementById('sell-view-type');
        if (viewSelect) {
            viewSelect.value = currentView;
        }

        updateToolbar();
        render();
        setDirtyState(targetView, false);
        closeHistoryModal();
        Notification.show(
            `${getViewTypeTitle(targetView)} opened${mode === 'view' ? ' in view mode' : ''}.`,
            'success'
        );
    }

    async function enterEditOriginalMode() {
        if (!isReadOnlyView(currentView)) return;

        const session = getDocumentSession(currentView);
        resetShareContactOverride(currentView);
        setDocumentSession(currentView, {
            mode: 'edit-original',
            sourceId: session.sourceId || currentDocumentIds[currentView] || null,
            sourceLabel: session.sourceLabel || currentDocumentLabels[currentView] || describeCurrentWorkspace(currentView),
            suggestedCopyLabel: buildSuggestedCopyLabel(session.sourceLabel || currentDocumentLabels[currentView], currentView)
        });
        updateToolbar();
        render();
    }

    async function enterEditCopyMode() {
        if (!isReadOnlyView(currentView)) return;

        const session = getDocumentSession(currentView);
        const sourceLabel = session.sourceLabel || currentDocumentLabels[currentView] || describeCurrentWorkspace(currentView);
        const copyLabel = buildSuggestedCopyLabel(sourceLabel, currentView);
        resetShareContactOverride(currentView);

        currentDocumentIds[currentView] = null;
        currentDocumentLabels[currentView] = copyLabel;
        setDocumentSession(currentView, {
            mode: 'edit-copy',
            sourceId: session.sourceId || null,
            sourceLabel,
            suggestedCopyLabel: copyLabel
        });
        setDirtyState(currentView, false);
        updateToolbar();
        render();
    }

    async function closeReadOnlyView() {
        if (!isReadOnlyView(currentView)) return;
        await resetDocumentWorkspace(currentView, { clearDraft: false });
    }

    function closeHistoryModal() {
        if (historySearchTimer) {
            clearTimeout(historySearchTimer);
            historySearchTimer = null;
        }
        historyModalMode = 'saved';
        resetHistoryShareState();
        const modal = document.getElementById('template-modal');
        if (modal) App?.hideModal?.(modal);
    }

    function renderThumbnails() {
        const strip = document.getElementById('page-thumbnails');
        if (!strip) return;

        const data = currentView === 'letterhead' ? Invoice.getLetterheadData() : Invoice.getData();
        const pages = data.pages || [];
        strip.innerHTML = '';

        pages.forEach((page, idx) => {
            const isFinal = currentView === 'invoice' && idx === pages.length - 1;
            const thumb = document.createElement('button');
            thumb.type = 'button';
            thumb.className = 'page-thumb';
            thumb.dataset.pageIndex = String(idx);
            const lineCount = (page.items || []).length;
            thumb.innerHTML = `
                <span class="page-thumb-detail">${idx === getSelectedPageIndex(currentView) ? 'Current Page' : 'Page Overview'}</span>
                <span class="page-thumb-meta">${lineCount} line${lineCount === 1 ? '' : 's'}${isFinal ? ' • Final sheet' : ''}</span>
                <span class="page-thumb-label">P${idx + 1}${isFinal ? ' (Final)' : ''}</span>
            `;
            thumb.addEventListener('click', () => setSelectedPageIndex(idx, {
                scrollIntoView: true,
                lockSelection: true
            }));
            strip.appendChild(thumb);
        });

        if (isReadOnlyView(currentView)) {
            return;
        }

        const addThumb = document.createElement('button');
        addThumb.type = 'button';
        addThumb.className = 'add-page-thumb';
        addThumb.innerHTML = `
            <span class="add-page-thumb-plus">+</span>
            <span class="add-page-thumb-title">Add Blank Page</span>
            <span class="add-page-thumb-hint">Click to append a new empty page</span>
        `;
        addThumb.addEventListener('click', addPage);
        strip.appendChild(addThumb);
    }

    function getHistoryEntryPayload(entry) {
        if (!entry?.payload) return {};
        if (typeof entry.payload === 'object') return entry.payload;
        try {
            return JSON.parse(entry.payload);
        } catch (_) {
            return {};
        }
    }

    function renderHistoryEntries(container, entries) {
        if (historyShareMenuId && !entries.some((entry) => String(entry.id) === String(historyShareMenuId))) {
            historyShareMenuId = null;
        }

        if (!entries.length) {
            container.innerHTML = '<div class="history-empty-state">No saved documents found.</div>';
            return;
        }

        container.innerHTML = entries.map((entry) => {
            const active = String(selectedHistoryId) === String(entry.id);
            const status = entry.status ? String(entry.status).toUpperCase() : 'SAVED';
            const docLabel = esc(entry.doc_number || `${entry.doc_type} #${entry.id}`);
            const updatedAt = esc(formatHistoryTimestamp(entry.updated_at || entry.created_at || ''));
            const amount = entry.doc_type === 'invoice'
                ? `${InvoiceMath.filsToKD(entry.total_fils || 0)} KD.`
                : RAPID_ORDER_SHEET_LABEL;
            const payload = getHistoryEntryPayload(entry);
            const shareOpen = String(historyShareMenuId) === String(entry.id);
            const shareOverride = getHistoryShareContactOverride(entry.id);
            const shareContact = getEffectiveShareContact(entry.doc_type || currentView, payload, {
                override: shareOverride
            });
            const sharePhone = resolveSharePhoneRaw(entry.doc_type || currentView, payload, {
                override: shareOverride
            });

            const shareTitle = entry.doc_type === 'invoice'
                ? 'Share Saved Invoice'
                : `Share Saved ${RAPID_ORDER_SHEET_LABEL}`;
            const shareSubtitle = 'Gmail tries to paste the PDF automatically. WhatsApp opens faster with the PDF already copied in the background, so you can press Ctrl+V immediately.';

            return `
                <div class="history-item ${active ? 'active' : ''}" data-history-id="${entry.id}" data-share-open="${shareOpen ? 'true' : 'false'}">
                    <button class="history-item-main" type="button" data-history-select="${entry.id}">
                        <span class="history-item-title">${docLabel}</span>
                        <span class="history-item-meta">${updatedAt} - ${esc(status)} - ${esc(amount)}</span>
                    </button>
                    <div class="history-item-actions">
                        <div class="history-share-wrap">
                            <button class="history-action-btn history-share-trigger-btn" type="button" data-history-share-toggle="${entry.id}" aria-expanded="${shareOpen ? 'true' : 'false'}" title="Share this saved document">
                                <span class="history-action-icon" aria-hidden="true">&gt;</span>
                                <span>Share</span>
                            </button>
                        </div>
                        <button class="history-action-btn history-print-btn" type="button" data-history-print="${entry.id}" title="Open print dialog for this saved document">
                            <span class="history-action-icon" aria-hidden="true">&#128424;</span>
                            <span>Print</span>
                        </button>
                        <button class="history-action-btn history-open-btn" type="button" data-history-open="${entry.id}" title="Open this saved document">
                            <span class="history-action-icon" aria-hidden="true">&#128194;</span>
                            <span>Open</span>
                        </button>
                        <button class="history-action-btn history-delete-btn" type="button" data-history-delete="${entry.id}" title="Delete this saved document">
                            <span class="history-action-icon" aria-hidden="true">&#128465;</span>
                            <span>Delete</span>
                        </button>
                    </div>
                    <div class="history-share-panel" ${shareOpen ? '' : 'hidden'}>
                        <div class="history-share-menu">
                            <div class="history-share-title">${esc(shareTitle)}</div>
                            <div class="history-share-subtitle">${esc(shareSubtitle)}</div>
                            <label class="history-share-field">
                                <span>Email</span>
                                <input type="email" value="${escAttr(shareContact.email)}" data-history-share-email="${entry.id}" placeholder="customer@example.com" autocomplete="off">
                            </label>
                            <label class="history-share-field">
                                <span>WhatsApp No.</span>
                                <input type="text" value="${escAttr(shareContact.whatsapp)}" data-history-share-whatsapp="${entry.id}" placeholder="${entry.doc_type === 'invoice' ? 'Use customer phone or enter a number' : 'Enter WhatsApp number'}" autocomplete="off">
                            </label>
                            <div class="history-share-menu-actions">
                                <button class="history-share-menu-btn history-share-menu-whatsapp" type="button" data-history-share-action="${entry.id}" data-history-share-channel="whatsapp" title="${sharePhone ? 'Open WhatsApp draft' : 'Enter a valid WhatsApp number first'}">
                                    <span class="history-action-icon" aria-hidden="true">WA</span>
                                    <span>WhatsApp</span>
                                </button>
                                <button class="history-share-menu-btn history-share-menu-gmail" type="button" data-history-share-action="${entry.id}" data-history-share-channel="gmail" title="${String(shareContact.email || '').trim() ? 'Open Gmail draft' : 'Enter a valid email first'}">
                                    <span class="history-action-icon" aria-hidden="true">@</span>
                                    <span>Gmail</span>
                                </button>
                            </div>
                            <div class="history-share-helper-actions">
                                <button class="history-share-helper-btn" type="button" data-history-share-helper="${entry.id}" data-history-helper-kind="message">Copy Message</button>
                                <button class="history-share-helper-btn" type="button" data-history-share-helper="${entry.id}" data-history-helper-kind="email">Copy Email</button>
                                <button class="history-share-helper-btn" type="button" data-history-share-helper="${entry.id}" data-history-helper-kind="whatsapp">Copy Number</button>
                                <button class="history-share-helper-btn" type="button" data-history-share-helper="${entry.id}" data-history-helper-kind="reveal">Open PDF Folder</button>
                            </div>
                            <p class="history-share-hint">The saved PDF is prepared and copied in the background before the draft opens. Gmail tries to paste it automatically. For WhatsApp, press Ctrl+V as soon as the chat opens.</p>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('[data-history-select]').forEach((button) => {
            button.addEventListener('click', () => {
                selectedHistoryId = button.dataset.historySelect;
                renderHistoryEntries(container, entries);
            });
        });

        container.querySelectorAll('[data-history-print]').forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation();
                await printSavedDocumentById(button.dataset.historyPrint);
            });
        });

        container.querySelectorAll('[data-history-share-toggle]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                const nextId = button.dataset.historyShareToggle;
                historyShareMenuId = String(historyShareMenuId) === String(nextId) ? null : nextId;
                renderHistoryEntries(container, entries);
            });
        });

        container.querySelectorAll('[data-history-share-email]').forEach((input) => {
            input.addEventListener('click', (event) => {
                event.stopPropagation();
            });
            input.addEventListener('input', (event) => {
                event.stopPropagation();
                const override = getHistoryShareContactOverride(input.dataset.historyShareEmail);
                override.email = String(event.target.value || '');
            });
            input.addEventListener('blur', (event) => {
                const override = getHistoryShareContactOverride(input.dataset.historyShareEmail);
                override.email = String(event.target.value || '').trim();
                if (event.target.value !== override.email) {
                    event.target.value = override.email;
                }
            });
        });

        container.querySelectorAll('[data-history-share-whatsapp]').forEach((input) => {
            input.addEventListener('click', (event) => {
                event.stopPropagation();
            });
            input.addEventListener('input', (event) => {
                event.stopPropagation();
                const override = getHistoryShareContactOverride(input.dataset.historyShareWhatsapp);
                override.whatsapp = String(event.target.value || '');
            });
            input.addEventListener('blur', (event) => {
                const override = getHistoryShareContactOverride(input.dataset.historyShareWhatsapp);
                override.whatsapp = String(event.target.value || '').trim();
                if (event.target.value !== override.whatsapp) {
                    event.target.value = override.whatsapp;
                }
            });
        });

        container.querySelectorAll('[data-history-share-action]').forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation();
                const id = button.dataset.historyShareAction;
                const channel = button.dataset.historyShareChannel;
                const shared = await shareSavedDocumentById(id, channel, {
                    contactOverride: getHistoryShareContactOverride(id)
                });
                if (shared) {
                    historyShareMenuId = null;
                    renderHistoryEntries(container, entries);
                }
            });
        });

        container.querySelectorAll('[data-history-share-helper]').forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation();
                const id = button.dataset.historyShareHelper;
                const kind = button.dataset.historyHelperKind;
                if (kind === 'reveal') {
                    await revealSavedDocumentSharePdfById(id);
                    return;
                }
                await copySavedDocumentShareHelper(id, kind, {
                    contactOverride: getHistoryShareContactOverride(id)
                });
            });
        });

        container.querySelectorAll('[data-history-open]').forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation();
                await openSavedDocumentById(button.dataset.historyOpen);
            });
        });

        container.querySelectorAll('[data-history-delete]').forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation();
                await deleteSavedDocumentById(button.dataset.historyDelete);
            });
        });
    }

    async function openSharedHistoryFile(filePath) {
        if (!window.electronAPI?.openPath) {
            Notification.show('PDF opening is not available in this environment.', 'error');
            return false;
        }

        const result = await window.electronAPI.openPath(filePath);
        if (result?.success === false) {
            Notification.show(`Unable to open the shared PDF: ${result.error}`, 'error');
            return false;
        }

        return true;
    }

    async function ensureSharedHistoryFile(entry) {
        const filePath = String(entry?.filePath || '').trim();
        if (!filePath) {
            Notification.show('This shared PDF record is missing its file path.', 'error');
            return false;
        }

        const exists = await shareFileExists(filePath);
        if (exists) {
            return true;
        }

        await Persistence.deleteSharedHistoryEntry(currentView, entry.id);
        if (String(selectedHistoryId || '') === String(entry.id || '')) {
            selectedHistoryId = null;
        }

        Notification.show('The shared PDF file is no longer available. Its history entry has been removed.', 'warning');
        await openSharedHistoryModal(document.getElementById('history-search')?.value?.trim() || '', {
            preserveSelection: true
        });
        return false;
    }

    async function revealSharedHistoryFile(filePath) {
        if (!window.electronAPI?.showItemInFolder) {
            Notification.show('File reveal is not available in this environment.', 'error');
            return false;
        }

        const result = await window.electronAPI.showItemInFolder(filePath);
        if (result?.success === false) {
            Notification.show(`Unable to reveal the shared PDF: ${result.error}`, 'error');
            return false;
        }

        return true;
    }

    function renderSharedHistoryEntries(container, entries) {
        if (!entries.length) {
            container.innerHTML = currentView === 'invoice'
                ? '<div class="history-empty-state">No shared invoices found yet.</div>'
                : `<div class="history-empty-state">No shared ${RAPID_ORDER_SHEET_LABEL_LOWER}s found yet.</div>`;
            return;
        }

        container.innerHTML = entries.map((entry) => {
            const active = String(selectedHistoryId) === String(entry.id);
            const sharedAt = esc(formatHistoryTimestamp(entry.sharedAt || ''));
            const channelLabel = String(entry.channel || '').trim().toUpperCase() || 'SHARED';
            const recipient = esc(entry.recipient || 'No recipient');
            const fileName = esc(entry.filePath ? String(entry.filePath).split(/[/\\]/).pop() : '');
            return `
                <div class="history-item ${active ? 'active' : ''}" data-shared-history-id="${escAttr(entry.id)}">
                    <button class="history-item-main" type="button" data-shared-history-select="${escAttr(entry.id)}">
                        <span class="history-item-title">${esc(entry.docLabel || (currentView === 'invoice' ? 'Shared Invoice' : `Shared ${RAPID_ORDER_SHEET_LABEL}`))}</span>
                        <span class="history-item-meta">${sharedAt} - ${esc(channelLabel)} - ${recipient}${fileName ? ` - ${fileName}` : ''}</span>
                    </button>
                    <div class="history-item-actions">
                        <button class="history-action-btn history-open-btn" type="button" data-shared-history-open="${escAttr(entry.id)}" title="Open this shared PDF">
                            <span class="history-action-icon" aria-hidden="true">&#128065;</span>
                            <span>View PDF</span>
                        </button>
                        <button class="history-action-btn history-open-btn" type="button" data-shared-history-reveal="${escAttr(entry.id)}" title="Reveal this shared PDF in its folder">
                            <span class="history-action-icon" aria-hidden="true">&#128194;</span>
                            <span>Open Folder</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        const entryMap = new Map(entries.map((entry) => [String(entry.id), entry]));

        container.querySelectorAll('[data-shared-history-select]').forEach((button) => {
            button.addEventListener('click', () => {
                selectedHistoryId = button.dataset.sharedHistorySelect;
                renderSharedHistoryEntries(container, entries);
            });
        });

        container.querySelectorAll('[data-shared-history-open]').forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation();
                const entry = entryMap.get(String(button.dataset.sharedHistoryOpen));
                if (!entry || !await ensureSharedHistoryFile(entry)) {
                    return;
                }
                await openSharedHistoryFile(entry.filePath);
            });
        });

        container.querySelectorAll('[data-shared-history-reveal]').forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation();
                const entry = entryMap.get(String(button.dataset.sharedHistoryReveal));
                if (!entry || !await ensureSharedHistoryFile(entry)) {
                    return;
                }
                await revealSharedHistoryFile(entry.filePath);
            });
        });
    }

    async function deleteSavedDocumentById(id) {
        const record = await Persistence.getDocument(id);
        if (!record) {
            Notification.show('Saved document could not be found.', 'error');
            return;
        }

        const docLabel = record.doc_number || `${record.doc_type || 'document'} #${record.id}`;
        if (!window.confirm(`Delete "${docLabel}"?`)) {
            return;
        }

        const result = await Persistence.deleteDocument(id);
        if (result?.success === false) {
            Notification.show('Saved document could not be deleted.', 'error');
            return;
        }

        if (record.doc_type && String(currentDocumentIds[record.doc_type] || '') === String(id)) {
            currentDocumentIds[record.doc_type] = null;
            currentDocumentLabels[record.doc_type] = '';
        }
        if (String(selectedHistoryId) === String(id)) {
            selectedHistoryId = null;
        }

        await openHistoryModal(document.getElementById('history-search')?.value?.trim() || '', { preserveSelection: true });
        Notification.show(`${getViewTypeTitle(record.doc_type)} deleted.`, 'success');
    }

    function initDraftRecoveryControls() {
        document.getElementById('draft-recovery-dismiss')?.addEventListener('click', closeDraftRecoveryModal);
        document.getElementById('draft-recovery-discard-all')?.addEventListener('click', () => {
            void discardAllDrafts();
        });
    }

    function scheduleDraftPersist(viewType = currentView, delay = 1200) {
        if (!Object.prototype.hasOwnProperty.call(draftSaveTimers, viewType)) return;

        clearTimeout(draftSaveTimers[viewType]);
        draftSaveTimers[viewType] = setTimeout(() => {
            void persistDraft(viewType, { syncCurrentView: currentView === viewType }).catch((error) => {
                console.error('Draft persistence failed:', error);
            });
        }, Math.max(0, delay || 0));
    }

    async function persistDraft(viewType = currentView, options = {}) {
        if (!options.force && !hasUnsavedChanges(viewType)) return;

        if (options.syncCurrentView && currentView === viewType) {
            syncCurrentViewState();
        }

        const draftPayload = buildDraftPayload(viewType);
        const serialized = JSON.stringify(draftPayload);
        if (lastDraftSnapshots[viewType] === serialized) return;

        setDraftStatus(viewType, 'saving', { message: '' });
        const result = await Persistence.saveDraft(viewType, draftPayload);
        if (result && result.success === false) {
            setDraftStatus(viewType, 'error', { message: result.error || 'Draft save failed.' });
            throw new Error(result.error || 'Draft save failed.');
        }

        lastDraftSnapshots[viewType] = serialized;
        setDraftStatus(viewType, 'saved', {
            savedAt: draftPayload.updatedAt,
            message: ''
        });
    }

    function buildDraftPayload(viewType) {
        return {
            version: 1,
            viewType,
            documentId: currentDocumentIds[viewType] || null,
            payload: deepClone(getDocumentData(viewType)),
            updatedAt: new Date().toISOString()
        };
    }

    async function clearDraft(viewType = currentView) {
        if (!Object.prototype.hasOwnProperty.call(draftSaveTimers, viewType)) return;

        clearTimeout(draftSaveTimers[viewType]);
        draftSaveTimers[viewType] = null;
        lastDraftSnapshots[viewType] = '';

        const result = await Persistence.clearDraft(viewType);
        if (result && result.success === false) {
            setDraftStatus(viewType, 'error', { message: result.error || 'Draft clear failed.' });
            throw new Error(result.error || 'Draft clear failed.');
        }

        setDraftStatus(viewType, 'idle', { savedAt: null, message: '' });
    }

    async function maybePromptDraftRecovery() {
        const drafts = [];
        const invoiceDraft = normalizeDraftRecord(await Persistence.getDraft('invoice'), 'invoice');
        const letterheadDraft = normalizeDraftRecord(await Persistence.getDraft('letterhead'), 'letterhead');

        if (invoiceDraft) drafts.push(invoiceDraft);
        if (letterheadDraft) drafts.push(letterheadDraft);
        if (!drafts.length) return;

        recoveryDrafts = drafts.sort((left, right) => {
            return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
        });

        renderDraftRecoveryModal();
        const modal = document.getElementById('draft-recovery-modal');
        if (modal) App?.showModal?.(modal);
    }

    function normalizeDraftRecord(record, viewType) {
        if (!record || typeof record !== 'object' || !record.payload || typeof record.payload !== 'object') {
            return null;
        }

        return {
            viewType,
            documentId: record.documentId || null,
            payload: record.payload,
            updatedAt: record.updatedAt || ''
        };
    }

    function renderDraftRecoveryModal() {
        const modal = document.getElementById('draft-recovery-modal');
        const list = document.getElementById('draft-recovery-list');
        const discardAllBtn = document.getElementById('draft-recovery-discard-all');
        if (!modal || !list || !discardAllBtn) return;

        if (recoveryDrafts.length === 0) {
            list.innerHTML = '';
            discardAllBtn.style.display = 'none';
            App?.hideModal?.(modal);
            return;
        }

        discardAllBtn.style.display = recoveryDrafts.length > 1 ? 'inline-flex' : 'none';
        list.innerHTML = recoveryDrafts.map((draft) => `
            <div class="draft-recovery-card">
                <div class="draft-recovery-header">
                    <div class="draft-recovery-title">${esc(buildDraftTitle(draft))}</div>
                    <div class="draft-recovery-updated">${esc(formatHistoryTimestamp(draft.updatedAt))}</div>
                </div>
                <div class="draft-recovery-meta">${esc(buildDraftMeta(draft))}</div>
                <div class="draft-recovery-card-actions">
                    <button type="button" class="btn-secondary" data-draft-discard="${draft.viewType}">Discard</button>
                    <button type="button" class="btn-primary" data-draft-recover="${draft.viewType}">Recover</button>
                </div>
            </div>
        `).join('');

        list.querySelectorAll('[data-draft-recover]').forEach((button) => {
            button.addEventListener('click', () => {
                void recoverDraft(button.dataset.draftRecover);
            });
        });

        list.querySelectorAll('[data-draft-discard]').forEach((button) => {
            button.addEventListener('click', () => {
                void discardDraft(button.dataset.draftDiscard);
            });
        });
    }

    function buildDraftTitle(draft) {
        const data = draft.payload || {};
        if (draft.viewType === 'invoice') {
            return `Invoice Draft - ${data.invoiceNumber || 'Untitled Invoice'}`;
        }
        return `${RAPID_ORDER_SHEET_LABEL} Draft - ${data.to || `Untitled ${RAPID_ORDER_SHEET_LABEL}`}`;
    }

    function buildDraftMeta(draft) {
        const data = draft.payload || {};
        const itemCount = (data.pages || []).reduce((sum, page) => sum + ((page.items || []).length), 0);
        const summary = draft.viewType === 'invoice'
            ? (data.billTo?.name || 'No customer selected')
            : (data.subject || 'No subject');
        const itemsLabel = itemCount === 1 ? '1 line item' : `${itemCount} line items`;
        return `${summary} • ${itemsLabel}`;
    }

    async function recoverDraft(viewType) {
        const draft = recoveryDrafts.find((entry) => entry.viewType === viewType)
            || normalizeDraftRecord(await Persistence.getDraft(viewType), viewType);
        if (!draft) {
            await discardDraft(viewType);
            return;
        }

        applyDraftRecord(draft);
        recoveryDrafts = recoveryDrafts.filter((entry) => entry.viewType !== viewType);
        closeDraftRecoveryModal();
        Notification.show(`${getViewTypeTitle(viewType)} draft recovered.`, 'success');
    }

    function applyDraftRecord(draft) {
        if (draft.viewType === 'invoice') {
            Invoice.setData(draft.payload || {});
            currentDocumentIds.invoice = draft.documentId || null;
            currentDocumentLabels.invoice = buildDocumentNumber('invoice', draft.payload || {});
            resetShareContactOverride('invoice');
            setDocumentSession('invoice', {
                mode: 'edit',
                sourceId: draft.documentId || null,
                sourceLabel: currentDocumentLabels.invoice,
                suggestedCopyLabel: ''
            });
        } else {
            Invoice.setLetterheadData(draft.payload || {});
            currentDocumentIds.letterhead = draft.documentId || null;
            currentDocumentLabels.letterhead = buildDocumentNumber('letterhead', draft.payload || {});
            resetShareContactOverride('letterhead');
            setDocumentSession('letterhead', {
                mode: 'edit',
                sourceId: draft.documentId || null,
                sourceLabel: currentDocumentLabels.letterhead,
                suggestedCopyLabel: ''
            });
        }

        currentView = draft.viewType;
        const viewSelect = document.getElementById('sell-view-type');
        if (viewSelect) {
            viewSelect.value = currentView;
        }

        setDirtyState(draft.viewType, true);
        updateToolbar();
        render();
    }

    async function discardDraft(viewType) {
        await clearDraft(viewType);
        recoveryDrafts = recoveryDrafts.filter((entry) => entry.viewType !== viewType);
        renderDraftRecoveryModal();
    }

    async function discardAllDrafts() {
        const draftsToDiscard = [...recoveryDrafts];
        for (const draft of draftsToDiscard) {
            await clearDraft(draft.viewType);
        }
        recoveryDrafts = [];
        closeDraftRecoveryModal();
    }

    function closeDraftRecoveryModal() {
        const modal = document.getElementById('draft-recovery-modal');
        if (modal) App?.hideModal?.(modal);
    }

    function getPrintSnapshot(viewType = currentView) {
        if (viewType !== currentView) return null;
        syncDataFromDOM();

        const workspace = document.getElementById('sell-workspace');
        const pages = workspace ? Array.from(workspace.querySelectorAll('.inv-page')) : [];
        const sourceData = viewType === 'letterhead' ? Invoice.getLetterheadData() : Invoice.getData();
        return createSnapshotFromRenderedState(
            viewType,
            deepClone(sourceData),
            workspace,
            pages,
            viewType === 'invoice' ? !!manualPagination : false
        );
    }

    function buildPrintSnapshotFromRecord(record) {
        const viewType = record.doc_type || 'letterhead';
        const payload = deepClone(record.payload || (viewType === 'invoice'
            ? Invoice.defaultInvoiceData()
            : Invoice.defaultLetterheadData()));

        return withTemporaryDocumentState(viewType, payload, () => {
            const host = document.createElement('div');
            host.className = 'sell-print-snapshot-host';
            host.style.position = 'fixed';
            host.style.left = '-10000px';
            host.style.top = '0';
            host.style.visibility = 'hidden';
            host.innerHTML = viewType === 'invoice' ? Invoice.renderInvoice() : Invoice.renderLetterhead();
            document.body.appendChild(host);

            try {
                const pages = Array.from(host.querySelectorAll('.inv-page'));
                const currentData = viewType === 'invoice' ? Invoice.getData() : Invoice.getLetterheadData();
                return createSnapshotFromRenderedState(
                    viewType,
                    deepClone(currentData),
                    host,
                    pages,
                    viewType === 'invoice' ? !!manualPagination : false
                );
            } finally {
                host.remove();
            }
        });
    }

    function withTemporaryDocumentState(viewType, payload, callback) {
        const previousInvoice = deepClone(Invoice.getData());
        const previousLetterhead = deepClone(Invoice.getLetterheadData());

        try {
            if (viewType === 'invoice') {
                Invoice.setData(payload);
            } else {
                Invoice.setLetterheadData(payload);
            }
            return callback();
        } finally {
            Invoice.setData(previousInvoice);
            Invoice.setLetterheadData(previousLetterhead);
        }
    }

    function createSnapshotFromRenderedState(viewType, documentData, workspace, pages, manualFlag) {
        const capturedAmountWords = workspace?.querySelector('.inv-aw-text')?.textContent?.trim() || '';
        return {
            viewType,
            manualPagination: manualFlag,
            document: documentData,
            amountWordsText: viewType === 'invoice'
                ? (capturedAmountWords || computeInvoiceAmountWordsFromData(documentData))
                : capturedAmountWords,
            livePreviewPages: captureLivePreviewPages(workspace, pages, viewType),
            fragments: capturePrintFragments(pages, viewType),
            createdAt: new Date().toISOString()
        };
    }

    function computeInvoiceAmountWordsFromData(documentData) {
        const pages = Array.isArray(documentData?.pages) ? documentData.pages : [];
        const grandTotal = pages
            .flatMap((page) => Array.isArray(page?.items) ? page.items : [])
            .reduce((sum, item) => sum + computeInvoiceDocumentRowTotalFils(item), 0);
        const discountFils = InvoiceMath.parseFils(documentData?.discount);
        return grandTotal > 0 ? InvoiceMath.amountInWords(Math.max(0, grandTotal - discountFils)) : '';
    }

    function computeInvoiceDocumentRowTotalFils(item) {
        const explicitTotal = Number(item?.total_fils);
        if (item?.total_manual_override) {
            return Number.isFinite(explicitTotal) ? Math.max(0, Math.round(explicitTotal)) : 0;
        }
        if (Number.isFinite(explicitTotal) && explicitTotal > 0) {
            return Math.round(explicitTotal);
        }

        const qty = parseInt(item?.qty, 10) || 0;
        const unitPriceFils = resolveInvoiceDocumentUnitPriceFils(item);
        return InvoiceMath.rowTotal(qty, unitPriceFils);
    }

    function resolveInvoiceDocumentUnitPriceFils(item) {
        const directFils = item?.unit_price_fils;
        if (typeof directFils === 'number' && Number.isFinite(directFils)) {
            return Math.round(directFils);
        }
        if (typeof directFils === 'string' && /^[0-9]+$/.test(directFils.trim())) {
            return parseInt(directFils.trim(), 10) || 0;
        }

        const displayValue = item?.unit_price ?? item?.unitPrice ?? 0;
        return typeof displayValue === 'number'
            ? Math.round(displayValue)
            : InvoiceMath.parseFils(displayValue);
    }

    function captureLivePreviewPages(workspace, pages, viewType) {
        const wrapperPages = workspace
            ? Array.from(workspace.querySelectorAll('.invoice-pages-wrapper .inv-page'))
            : [];
        const sourcePages = wrapperPages.length > 0 ? wrapperPages : pages;

        return sourcePages.map((page, index) => {
            const html = serializePageContent(page);
            return {
                type: viewType,
                pageNumber: index + 1,
                domHtml: html,
                pageClassName: page.className || '',
                imageSources: collectImageSources(html)
            };
        });
    }

    function capturePrintFragments(pages, viewType) {
        const firstPage = pages[0];
        const lastPage = pages[pages.length - 1] || firstPage;
        const table = firstPage?.querySelector('.inv-table');

        if (!firstPage || !table) {
            return {
                headerHtml: '',
                footerHtml: '',
                tableHeadHtml: '',
                tableClassName: '',
                imageSources: []
            };
        }

        const headerSelectors = viewType === 'invoice'
            ? '.inv-header-svg-wrap, .inv-title-bar, .inv-bill-section'
            : '.lh-header-manual, .lh-addressee, .lh-subject, .lh-request';
        const footerSelectors = viewType === 'invoice'
            ? '.inv-footer-section'
            : '.lh-footer';

        const headerHtml = serializeSelectedNodes(firstPage, headerSelectors);
        const footerHtml = serializeSelectedNodes(lastPage || firstPage, footerSelectors);
        const tableHeadHtml = serializeNode(table.querySelector('thead'));
        const imageSources = collectImageSources(`${headerHtml}${footerHtml}`);

        return {
            headerHtml,
            footerHtml,
            tableHeadHtml,
            tableClassName: table.className || '',
            imageSources
        };
    }

    function serializeSelectedNodes(root, selector) {
        if (!root) return '';
        return Array.from(root.querySelectorAll(selector)).map(serializeNode).join('');
    }

    function serializePageContent(node) {
        if (!node) return '';
        const clone = cloneNodeWithFormState(node);
        sanitizePrintClone(clone);
        return clone.innerHTML;
    }

    function serializeNode(node) {
        if (!node) return '';
        const clone = cloneNodeWithFormState(node);
        sanitizePrintClone(clone);
        return clone.outerHTML;
    }

    function cloneNodeWithFormState(node) {
        if (!node) return null;
        const clone = node.cloneNode(true);
        syncClonedFormState(node, clone);
        return clone;
    }

    function syncClonedFormState(sourceNode, cloneNode) {
        if (!sourceNode || !cloneNode) return;
        if (sourceNode.nodeType !== Node.ELEMENT_NODE || cloneNode.nodeType !== Node.ELEMENT_NODE) return;

        copyFormControlState(sourceNode, cloneNode);

        const sourceChildren = Array.from(sourceNode.children || []);
        const cloneChildren = Array.from(cloneNode.children || []);
        for (let index = 0; index < sourceChildren.length; index += 1) {
            syncClonedFormState(sourceChildren[index], cloneChildren[index]);
        }
    }

    function copyFormControlState(sourceElement, cloneElement) {
        if (sourceElement instanceof HTMLImageElement && cloneElement instanceof HTMLImageElement) {
            const resolvedSrc = sourceElement.currentSrc || sourceElement.src || sourceElement.getAttribute('src') || '';
            if (resolvedSrc) {
                cloneElement.src = resolvedSrc;
                cloneElement.setAttribute('src', resolvedSrc);
            }
            return;
        }

        if (sourceElement instanceof HTMLInputElement && cloneElement instanceof HTMLInputElement) {
            cloneElement.value = sourceElement.value;
            cloneElement.setAttribute('value', sourceElement.value);

            if (sourceElement.type === 'checkbox' || sourceElement.type === 'radio') {
                cloneElement.checked = sourceElement.checked;
                if (sourceElement.checked) {
                    cloneElement.setAttribute('checked', 'checked');
                } else {
                    cloneElement.removeAttribute('checked');
                }
            }
            return;
        }

        if (sourceElement instanceof HTMLTextAreaElement && cloneElement instanceof HTMLTextAreaElement) {
            cloneElement.value = sourceElement.value;
            cloneElement.textContent = sourceElement.value;
            cloneElement.setAttribute('value', sourceElement.value);
            return;
        }

        if (sourceElement instanceof HTMLSelectElement && cloneElement instanceof HTMLSelectElement) {
            cloneElement.value = sourceElement.value;
            cloneElement.setAttribute('value', sourceElement.value);

            Array.from(cloneElement.options).forEach((option, index) => {
                const isSelected = !!sourceElement.options[index]?.selected;
                option.selected = isSelected;
                if (isSelected) {
                    option.setAttribute('selected', 'selected');
                } else {
                    option.removeAttribute('selected');
                }
            });
        }
    }

    function sanitizePrintClone(root) {
        if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
        root.removeAttribute('contenteditable');
        root.removeAttribute('spellcheck');
        root.querySelectorAll('[contenteditable]').forEach((element) => element.removeAttribute('contenteditable'));
        root.querySelectorAll('.inv-page-label').forEach((element) => element.remove());
    }

    function collectImageSources(html) {
        if (!html) return [];
        const host = document.createElement('div');
        host.innerHTML = html;
        return Array.from(host.querySelectorAll('img'))
            .map((img) => img.getAttribute('src'))
            .filter(Boolean);
    }

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value || {}));
    }

    function syncEditableFieldsToData(workspace, data) {
        const pendingFields = new Map();

        workspace.querySelectorAll('[data-field]').forEach((element) => {
            const fieldPath = element.dataset.field || '';
            if (!fieldPath || isItemField(fieldPath)) return;

            const value = isManualTotalsField(fieldPath)
                ? ((element.dataset.manualOverride === 'true' && hasTextInput(readElementValue(element)))
                    ? readElementValue(element)
                    : '')
                : readElementValue(element);

            const pageScope = element.dataset.pageScope || 'document';
            const pageIndex = pageScope === 'page'
                ? parseInt(element.dataset.pageIndex, 10)
                : null;
            const scopeKey = pageScope === 'page'
                ? `page:${pageIndex}:${fieldPath}`
                : `document:${fieldPath}`;
            const existing = pendingFields.get(scopeKey);

            if (!existing || hasTextInput(value) || !hasTextInput(existing.value)) {
                pendingFields.set(scopeKey, { fieldPath, pageScope, pageIndex, value });
            }
        });

        pendingFields.forEach(({ fieldPath, pageScope, pageIndex, value }) => {
            if (pageScope === 'page') {
                if (!Number.isInteger(pageIndex) || !data.pages[pageIndex]) return;
                if (!data.pages[pageIndex].meta || typeof data.pages[pageIndex].meta !== 'object') {
                    data.pages[pageIndex].meta = {};
                }
                setNestedValue(data.pages[pageIndex].meta, fieldPath, value);
                return;
            }

            setNestedValue(data, fieldPath, value);
        });
    }

    function isItemField(fieldPath) {
        return [
            'barcode',
            'name_en',
            'name_ar',
            'country',
            'weight',
            'unit_price',
            'total',
            'qty',
            'qty_by',
            'product_by',
            'page-subtotal'
        ].includes(fieldPath);
    }

    function readElementValue(element) {
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
            return element.value.trim();
        }
        return element.textContent.trim();
    }

    function setNestedValue(target, fieldPath, value) {
        const parts = fieldPath.split('.').filter(Boolean);
        if (parts.length === 0) return;

        let cursor = target;
        for (let index = 0; index < parts.length - 1; index += 1) {
            const key = parts[index];
            if (!cursor[key] || typeof cursor[key] !== 'object') {
                cursor[key] = {};
            }
            cursor = cursor[key];
        }

        cursor[parts[parts.length - 1]] = value;
    }

    function buildSuggestedDocumentLabel(viewType) {
        const data = getDocumentData(viewType);
        return buildDocumentNumber(viewType, data);
    }

    function buildDocumentNumber(viewType, data) {
        if (viewType === 'invoice') {
            return data.invoiceNumber || data.date || '';
        }
        return data.to || data.date || `ROS-${new Date().toISOString().slice(0, 10)}`;
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

    function esc(str) {
        const host = document.createElement('div');
        host.textContent = str || '';
        return host.innerHTML;
    }

    function escAttr(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function getView() { return currentView; }
    function setView(view) { currentView = view; }

    return {
        init, render, handleScan, getView, setView, getViewMode, syncDataFromDOM,
        resolveInvoiceBarcodeUpdatesBeforePrint,
        getPrintSnapshot, buildPrintSnapshotFromRecord,
        deletePageAt, duplicatePageAt,
        openSavedDocumentById, printSavedDocumentById,
        newDocument, saveDocument, shareCurrentDocument,
        getAppCloseState, finalizeAppClose
    };
})();
