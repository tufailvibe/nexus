/**
 * persistence.js — SQLite-backed persistence via Electron IPC
 * Handles: products, documents, stock movements, settings, templates, backups
 */
const Persistence = (() => {
    const api = () => window.electronAPI;
    const SHARED_HISTORY_LIMIT = 200;

    function parseJsonSafe(value, fallback) {
        if (typeof value !== 'string' || value.trim() === '') {
            return fallback;
        }

        try {
            return JSON.parse(value);
        } catch (_) {
            return fallback;
        }
    }

    function normalizePackQtyText(packQtyText) {
        return String(packQtyText || '')
            .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 1632))
            .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 1776))
            .replace(/\uFF0B/g, '+')
            .replace(/\uFF0D/g, '-')
            .replace(/\uFF0C/g, ',');
    }

    function parsePackQtyValue(packQtyText) {
        const match = normalizePackQtyText(packQtyText)
            .replace(/,/g, '')
            .match(/[+-]?\d+/);
        if (!match) return null;

        const parsed = parseInt(match[0], 10);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function setPackQtyValue(packQtyText, qtyValue) {
        const source = String(packQtyText || '');
        const normalizedSource = normalizePackQtyText(source);
        const safeQty = Math.max(0, parseInt(qtyValue, 10) || 0);
        const match = normalizedSource.match(/[+-]?\d+/);

        if (!match) {
            const trimmed = source.trim();
            if (!trimmed) return String(safeQty);
            return `${safeQty} ${trimmed}`;
        }

        const start = match.index || 0;
        const end = start + match[0].length;
        return `${source.slice(0, start)}${safeQty}${source.slice(end)}`;
    }

    function resolvePackQtyText(packQtyText, stockQty, options = {}) {
        const source = typeof packQtyText === 'string' ? packQtyText : '';
        if (packQtyText !== undefined) {
            if (source.trim() !== '' || !options.preferStockWhenPackEmpty) {
                return source;
            }
        }

        if (stockQty !== undefined && stockQty !== null) {
            return setPackQtyValue(options.fallbackPackQtyText || source, stockQty);
        }

        return source;
    }

    function normalizeProductRecord(product, options = {}) {
        if (!product || typeof product !== 'object') {
            return product || null;
        }

        const packQtyText = resolvePackQtyText(product.pack_qty_text, product.stock_qty, options);
        const parsedQty = parsePackQtyValue(packQtyText);
        return {
            ...product,
            pack_qty_text: packQtyText,
            stock_qty: Math.max(0, parsedQty == null ? 0 : parsedQty)
        };
    }

    function normalizeProductList(products, options = {}) {
        return Array.isArray(products)
            ? products.map((product) => normalizeProductRecord(product, options))
            : [];
    }

    function normalizeImportedPayload(payload, label) {
        if (typeof payload === 'string') {
            JSON.parse(payload);
            return payload;
        }

        if (payload && typeof payload === 'object') {
            return JSON.stringify(payload);
        }

        throw new Error(`Invalid ${label} payload.`);
    }

    function assertIpcSuccess(result, fallbackMessage) {
        if (!result || result.success === false) {
            throw new Error(result?.error || fallbackMessage || 'Operation failed.');
        }
        return result;
    }

    async function storeInvoke(action, payload, fallbackMessage) {
        if (typeof api().storeInvoke !== 'function') {
            throw new Error('Store IPC is unavailable.');
        }
        return assertIpcSuccess(
            await api().storeInvoke(action, payload || {}),
            fallbackMessage || 'Store action failed.'
        );
    }

    function normalizeComparable(value) {
        if (Array.isArray(value)) {
            return value.map(normalizeComparable);
        }

        if (value && typeof value === 'object') {
            return Object.keys(value).sort().reduce((accumulator, key) => {
                accumulator[key] = normalizeComparable(value[key]);
                return accumulator;
            }, {});
        }

        return value ?? null;
    }

    function recordsMatch(left, right) {
        return JSON.stringify(normalizeComparable(left)) === JSON.stringify(normalizeComparable(right));
    }

    function summarizeImportCategory({ label, incoming, existingMap, getKey, normalizeIncoming, normalizeExisting, buildLabel }) {
        const summary = {
            label,
            total: Array.isArray(incoming) ? incoming.length : 0,
            inserts: 0,
            updates: 0,
            unchanged: 0,
            samples: []
        };
        const insertSamples = [];
        const updateSamples = [];
        const unchangedSamples = [];

        if (!Array.isArray(incoming)) {
            return summary;
        }

        incoming.forEach((entry) => {
            const key = getKey(entry);
            const sampleLabel = buildLabel(entry);
            const existing = existingMap.get(key);

            if (!existing) {
                summary.inserts += 1;
                if (insertSamples.length < 5) {
                    insertSamples.push({ status: 'insert', label: sampleLabel });
                }
                return;
            }

            if (recordsMatch(normalizeIncoming(entry), normalizeExisting(existing))) {
                summary.unchanged += 1;
                if (unchangedSamples.length < 5) {
                    unchangedSamples.push({ status: 'same', label: sampleLabel });
                }
                return;
            }

            summary.updates += 1;
            if (updateSamples.length < 5) {
                updateSamples.push({ status: 'update', label: sampleLabel });
            }
        });

        summary.samples = [...insertSamples, ...updateSamples, ...unchangedSamples].slice(0, 5);
        return summary;
    }

    // ── Products (My Stock) ──
    async function getAllProducts(options = {}) {
        const action = options.includeArchived ? 'products.listAll' : 'products.list';
        const r = await storeInvoke(action, {}, 'Unable to load products.');
        return normalizeProductList(r.data);
    }

    async function getProductByBarcode(barcode) {
        const r = await storeInvoke('products.getByBarcode', { barcode }, 'Unable to load product.');
        return normalizeProductRecord(r.data);
    }

    async function upsertProduct(p) {
        const normalizedProduct = normalizeProductRecord(p, {
            preferStockWhenPackEmpty: true
        });
        const r = await storeInvoke(
            'products.upsert',
            { product: normalizedProduct },
            'Unable to save product.'
        );
        return normalizeProductRecord(r.data);
    }

    async function deleteProduct(id) {
        const r = await storeInvoke('products.delete', { id }, 'Unable to delete product.');
        return r.data || { success: true };
    }

    async function destroyProduct(id) {
        const r = await storeInvoke('products.destroy', { id }, 'Unable to permanently delete product.');
        return r.data || { success: true };
    }

    async function restoreProduct(id) {
        const r = await storeInvoke('products.restore', { id }, 'Unable to restore product.');
        return r.data || { success: true };
    }

    async function updateProductQty(barcode, qtyChange) {
        const r = await storeInvoke(
            'products.updateQty',
            { barcode, qtyChange },
            'Unable to update product quantity.'
        );
        return r.data || { success: true };
    }

    async function searchProducts(query) {
        const r = await storeInvoke('products.search', { query }, 'Unable to search products.');
        return normalizeProductList(r.data);
    }

    // ── Documents ──
    async function saveDocument(doc) {
        const r = await storeInvoke('documents.save', { document: doc }, 'Unable to save document.');
        return r.data || null;
    }

    async function getDocument(id) {
        const r = await storeInvoke('documents.get', { id }, 'Unable to load document.');
        if (r.data) {
            r.data.payload = parseJsonSafe(r.data.payload, {});
        }
        return r.data || null;
    }

    async function getDocumentHistory(docType, query) {
        const r = await storeInvoke(
            'documents.listHistory',
            { docType, query },
            'Unable to load document history.'
        );
        const entries = r.data || [];
        entries.forEach((entry) => {
            if (entry && Object.prototype.hasOwnProperty.call(entry, 'payload')) {
                entry.payload = parseJsonSafe(entry.payload, {});
            }
        });
        return entries;
    }

    async function deleteDocument(id) {
        const r = await storeInvoke('documents.delete', { id }, 'Unable to delete document.');
        return r.data || { success: true };
    }

    // ── Stock Movements ──
    async function addStockMovement(productId, docId, qtyChange, reason, note = '') {
        const r = await storeInvoke(
            'stockMovements.add',
            { productId, docId, qtyChange, reason, note },
            'Unable to save stock movement.'
        );
        return r.data || { success: true };
    }

    async function getStockMovements(productId) {
        const r = await storeInvoke(
            'stockMovements.listByProduct',
            { productId },
            'Unable to load stock movements.'
        );
        return r.data || [];
    }

    // â”€â”€ Barcode Library â”€â”€
    async function saveBarcodeEntry(entry) {
        const r = await storeInvoke(
            'barcodeLibrary.save',
            { entry },
            'Unable to save barcode entry.'
        );
        return r.data || null;
    }

    async function getBarcodeLibrary(query) {
        const r = await storeInvoke(
            'barcodeLibrary.list',
            { query },
            'Unable to load barcode library.'
        );
        return r.data || [];
    }

    async function deleteBarcodeEntry(id) {
        const r = await storeInvoke(
            'barcodeLibrary.delete',
            { id },
            'Unable to delete barcode entry.'
        );
        return r.data || { success: true };
    }

    // ── Settings ──
    async function getSetting(key) {
        const r = await storeInvoke('settings.get', { key }, 'Unable to load setting.');
        return r.data ?? null;
    }

    async function setSetting(key, value) {
        const r = await storeInvoke(
            'settings.set',
            { key, value: String(value) },
            'Unable to save setting.'
        );
        return r.data || { success: true };
    }

    async function saveDraft(viewType, draft) {
        if (!viewType) throw new Error('Draft view type is required.');
        return setSetting(`draft_${viewType}`, JSON.stringify(draft || {}));
    }

    async function getDraft(viewType) {
        if (!viewType) return null;
        return parseJsonSafe(await getSetting(`draft_${viewType}`), null);
    }

    async function clearDraft(viewType) {
        if (!viewType) return null;
        return setSetting(`draft_${viewType}`, '');
    }

    function getSharedHistoryKey(viewType) {
        return `shared_history_${viewType || 'invoice'}`;
    }

    function normalizeSharedHistoryEntry(entry = {}, viewType = 'invoice') {
        return {
            id: String(entry.id || `${viewType}-${Date.now()}`),
            viewType: viewType || entry.viewType || 'invoice',
            docLabel: String(entry.docLabel || ''),
            channel: String(entry.channel || ''),
            recipient: String(entry.recipient || ''),
            email: String(entry.email || ''),
            whatsapp: String(entry.whatsapp || ''),
            filePath: String(entry.filePath || ''),
            sharedAt: String(entry.sharedAt || new Date().toISOString())
        };
    }

    async function recordSharedHistory(viewType, entry) {
        const key = getSharedHistoryKey(viewType);
        const items = parseJsonSafe(await getSetting(key), []);
        const normalizedEntry = normalizeSharedHistoryEntry(entry, viewType);
        const nextItems = [normalizedEntry]
            .concat(Array.isArray(items) ? items : [])
            .slice(0, SHARED_HISTORY_LIMIT);
        await setSetting(key, JSON.stringify(nextItems));
        return normalizedEntry;
    }

    async function getSharedHistory(viewType, query = '') {
        const key = getSharedHistoryKey(viewType);
        const items = parseJsonSafe(await getSetting(key), []);
        const normalizedItems = (Array.isArray(items) ? items : [])
            .map((entry) => normalizeSharedHistoryEntry(entry, viewType))
            .sort((left, right) => new Date(right.sharedAt || 0).getTime() - new Date(left.sharedAt || 0).getTime());

        const normalizedQuery = String(query || '').trim().toLowerCase();
        if (!normalizedQuery) {
            return normalizedItems;
        }

        return normalizedItems.filter((entry) => {
            return [
                entry.docLabel,
                entry.recipient,
                entry.email,
                entry.whatsapp,
                entry.channel,
                entry.sharedAt
            ].some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
        });
    }

    async function deleteSharedHistoryEntry(viewType, id) {
        const key = getSharedHistoryKey(viewType);
        const items = parseJsonSafe(await getSetting(key), []);
        const nextItems = (Array.isArray(items) ? items : []).filter((entry) => String(entry?.id || '') !== String(id || ''));
        await setSetting(key, JSON.stringify(nextItems));
        return { success: true };
    }

    async function getNextInvoiceNumber() {
        const num = await getSetting('next_invoice_number');
        const fmt = await getSetting('invoice_format');
        const n = parseInt(num) || 1;
        const format = fmt || 'INV-{NUM}';
        return {
            number: n,
            formatted: format.replace('{NUM}', String(n).padStart(4, '0'))
        };
    }

    async function incrementInvoiceNumber() {
        const num = await getSetting('next_invoice_number');
        const n = (parseInt(num) || 1) + 1;
        await setSetting('next_invoice_number', String(n));
        return n;
    }

    // ── Templates (with doc_type isolation) ──
    async function saveTemplate(name, payload, docType) {
        const r = await storeInvoke(
            'templates.save',
            {
                name,
                payload,
                docType: docType || 'letterhead'
            },
            'Unable to save template.'
        );
        return r.data || { success: true };
    }

    async function getTemplates(docType) {
        const r = await storeInvoke(
            'templates.list',
            { docType },
            'Unable to load templates.'
        );
        const templates = r.data || [];
        templates.forEach(t => { t.payload = parseJsonSafe(t.payload, {}); });
        return templates;
    }

    async function deleteTemplate(name, docType) {
        const r = await storeInvoke(
            'templates.delete',
            { name, docType: docType || 'letterhead' },
            'Unable to delete template.'
        );
        return r.data || { success: true };
    }

    // ── Backup ──
    async function createBackup() {
        return api().backupDB();
    }

    // ── Export/Import ──
    async function exportAllData() {
        const [
            products,
            documentsResult,
            templatesResult,
            movementsResult,
            barcodeLibraryResult,
            settingsResult
        ] = await Promise.all([
            getAllProducts({ includeArchived: true }),
            storeInvoke('documents.listAll', {}, 'Unable to export documents.'),
            storeInvoke('templates.list', {}, 'Unable to export templates.'),
            storeInvoke('stockMovements.listAll', {}, 'Unable to export stock movements.'),
            storeInvoke('barcodeLibrary.list', {}, 'Unable to export barcode library.'),
            storeInvoke('settings.list', {}, 'Unable to export settings.')
        ]);

        const templates = (templatesResult.data || []).map((template) => ({
            ...template,
            payload: parseJsonSafe(template.payload, {})
        }));

        return {
            version: '1.0.0',
            exported_at: new Date().toISOString(),
            products: products,
            documents: documentsResult.data || [],
            templates: templates,
            stock_movements: movementsResult.data || [],
            barcode_library: barcodeLibraryResult.data || [],
            settings: settingsResult.data || []
        };
    }

    async function previewImportData(data) {
        if (!data || !data.version) throw new Error('Invalid backup data');

        const [products, documentsResult, templatesResult, movementsResult, barcodeResult, settingsResult] = await Promise.all([
            getAllProducts({ includeArchived: true }),
            storeInvoke('documents.listAll', {}, 'Unable to read documents for import preview.'),
            storeInvoke('templates.list', {}, 'Unable to read templates for import preview.'),
            storeInvoke('stockMovements.listAll', {}, 'Unable to read stock movements for import preview.'),
            storeInvoke('barcodeLibrary.list', {}, 'Unable to read barcode library for import preview.'),
            storeInvoke('settings.list', {}, 'Unable to read settings for import preview.')
        ]);

        const documents = documentsResult.data || [];
        const templates = templatesResult.data || [];
        const movements = movementsResult.data || [];
        const barcodeLibrary = barcodeResult.data || [];
        const settingsRows = settingsResult.data || [];

        const categories = [
            summarizeImportCategory({
                label: 'Products',
                incoming: data.products,
                existingMap: new Map(products.map((product) => [String(product.barcode || ''), product])),
                getKey: (product) => String(product.barcode || ''),
                normalizeIncoming: (product) => {
                    const normalized = normalizeProductRecord(product, {
                        preferStockWhenPackEmpty: true
                    });
                    return {
                        barcode: String(normalized.barcode || ''),
                        name_en: normalized.name_en || '',
                        name_ar: normalized.name_ar || '',
                        country: normalized.country || '',
                        weight: normalized.weight || '',
                        unit_price_fils: Number(normalized.unit_price_fils || 0),
                        product_by: normalized.product_by || '',
                        pack_qty_text: normalized.pack_qty_text || '',
                        stock_qty: Number(normalized.stock_qty || 0),
                        reorder_level: Number(normalized.reorder_level || 5),
                        display_order: Number(normalized.display_order || 0),
                        archived_at: normalized.archived_at || null
                    };
                },
                normalizeExisting: (product) => {
                    const normalized = normalizeProductRecord(product);
                    return {
                        barcode: String(normalized.barcode || ''),
                        name_en: normalized.name_en || '',
                        name_ar: normalized.name_ar || '',
                        country: normalized.country || '',
                        weight: normalized.weight || '',
                        unit_price_fils: Number(normalized.unit_price_fils || 0),
                        product_by: normalized.product_by || '',
                        pack_qty_text: normalized.pack_qty_text || '',
                        stock_qty: Number(normalized.stock_qty || 0),
                        reorder_level: Number(normalized.reorder_level || 5),
                        display_order: Number(normalized.display_order || 0),
                        archived_at: normalized.archived_at || null
                    };
                },
                buildLabel: (product) => `${product.barcode || 'No barcode'} · ${product.name_en || 'Unnamed product'}`
            }),
            summarizeImportCategory({
                label: 'Documents',
                incoming: data.documents,
                existingMap: new Map(documents.map((document) => [String(document.id || ''), document])),
                getKey: (document) => String(document.id || ''),
                normalizeIncoming: (document) => ({
                    id: String(document.id || ''),
                    doc_type: document.doc_type || 'invoice',
                    doc_number: document.doc_number || '',
                    payload: normalizeImportedPayload(document.payload, 'document'),
                    status: document.status || 'draft',
                    total_fils: Number(document.total_fils || 0)
                }),
                normalizeExisting: (document) => ({
                    id: String(document.id || ''),
                    doc_type: document.doc_type || 'invoice',
                    doc_number: document.doc_number || '',
                    payload: normalizeImportedPayload(document.payload, 'document'),
                    status: document.status || 'draft',
                    total_fils: Number(document.total_fils || 0)
                }),
                buildLabel: (document) => document.doc_number || `${document.doc_type || 'document'} #${document.id || 'new'}`
            }),
            summarizeImportCategory({
                label: 'Templates',
                incoming: data.templates,
                existingMap: new Map(templates.map((template) => [`${template.name || ''}::${template.doc_type || 'letterhead'}`, template])),
                getKey: (template) => `${template.name || ''}::${template.doc_type || 'letterhead'}`,
                normalizeIncoming: (template) => ({
                    name: template.name || '',
                    doc_type: template.doc_type || 'letterhead',
                    payload: normalizeImportedPayload(template.payload, 'template')
                }),
                normalizeExisting: (template) => ({
                    name: template.name || '',
                    doc_type: template.doc_type || 'letterhead',
                    payload: normalizeImportedPayload(template.payload, 'template')
                }),
                buildLabel: (template) => `${template.name || 'Untitled'} - ${(template.doc_type || 'letterhead') === 'invoice' ? 'invoice' : 'rapid order sheet'}`
            }),
            summarizeImportCategory({
                label: 'Stock Movements',
                incoming: data.stock_movements,
                existingMap: new Map(movements.map((movement) => [String(movement.id || ''), movement])),
                getKey: (movement) => String(movement.id || ''),
                normalizeIncoming: (movement) => ({
                    id: String(movement.id || ''),
                    product_id: Number(movement.product_id || 0),
                    document_id: movement.document_id == null ? null : Number(movement.document_id),
                    qty_change: Number(movement.qty_change || 0),
                    reason: movement.reason || 'sale',
                    note: movement.note || ''
                }),
                normalizeExisting: (movement) => ({
                    id: String(movement.id || ''),
                    product_id: Number(movement.product_id || 0),
                    document_id: movement.document_id == null ? null : Number(movement.document_id),
                    qty_change: Number(movement.qty_change || 0),
                    reason: movement.reason || 'sale',
                    note: movement.note || ''
                }),
                buildLabel: (movement) => `Movement #${movement.id || 'new'} · ${movement.reason || 'sale'}`
            }),
            summarizeImportCategory({
                label: 'Barcode Library',
                incoming: data.barcode_library,
                existingMap: new Map(barcodeLibrary.map((entry) => [String(entry.barcode_number || ''), entry])),
                getKey: (entry) => String(entry.barcode_number || ''),
                normalizeIncoming: (entry) => ({
                    barcode_number: entry.barcode_number || '',
                    format: entry.format || 'code128',
                    name_en: entry.name_en || '',
                    name_ar: entry.name_ar || '',
                    weight: entry.weight || '',
                    unit_price_fils: Number(entry.unit_price_fils || 0),
                    product_by: entry.product_by || ''
                }),
                normalizeExisting: (entry) => ({
                    barcode_number: entry.barcode_number || '',
                    format: entry.format || 'code128',
                    name_en: entry.name_en || '',
                    name_ar: entry.name_ar || '',
                    weight: entry.weight || '',
                    unit_price_fils: Number(entry.unit_price_fils || 0),
                    product_by: entry.product_by || ''
                }),
                buildLabel: (entry) => `${entry.barcode_number || 'No barcode'} · ${entry.name_en || 'Unnamed label'}`
            }),
            summarizeImportCategory({
                label: 'Settings',
                incoming: data.settings,
                existingMap: new Map(settingsRows.map((setting) => [String(setting.key || ''), setting])),
                getKey: (setting) => String(setting.key || ''),
                normalizeIncoming: (setting) => ({
                    key: String(setting.key || ''),
                    value: String(setting.value ?? '')
                }),
                normalizeExisting: (setting) => ({
                    key: String(setting.key || ''),
                    value: String(setting.value ?? '')
                }),
                buildLabel: (setting) => String(setting.key || 'setting')
            })
        ];

        const totals = categories.reduce((accumulator, category) => {
            accumulator.total += category.total;
            accumulator.inserts += category.inserts;
            accumulator.updates += category.updates;
            accumulator.unchanged += category.unchanged;
            return accumulator;
        }, {
            total: 0,
            inserts: 0,
            updates: 0,
            unchanged: 0
        });

        return {
            version: data.version,
            categories,
            totals
        };
    }

    async function importAllData(data) {
        if (!data || !data.version) throw new Error('Invalid backup data');

        if (typeof api().importAllData !== 'function') {
            throw new Error('Import IPC is unavailable.');
        }

        return assertIpcSuccess(
            await api().importAllData(data),
            'Import failed.'
        );
    }

    return {
        getAllProducts, getProductByBarcode, upsertProduct, deleteProduct, destroyProduct, restoreProduct, updateProductQty, searchProducts,
        saveDocument, getDocument, getDocumentHistory, deleteDocument,
        addStockMovement, getStockMovements,
        saveBarcodeEntry, getBarcodeLibrary, deleteBarcodeEntry,
        getSetting, setSetting, saveDraft, getDraft, clearDraft, getNextInvoiceNumber, incrementInvoiceNumber,
        recordSharedHistory, getSharedHistory, deleteSharedHistoryEntry,
        saveTemplate, getTemplates, deleteTemplate,
        createBackup, exportAllData, previewImportData, importAllData
    };
})();
