/**
 * barcode-gen.js - Barcode generator with persistent reprint library.
 */
const BarcodeGen = (() => {
    let generatedBarcodes = [];
    let nextId = 1;
    let librarySearchTerm = '';
    let barcodeSyncInProgress = false;

    function init() {
        document.getElementById('barcode-gen-btn')?.addEventListener('click', () => toggleNewForm(true, { focusField: 'barcode' }));
        document.getElementById('bc-cancel-btn')?.addEventListener('click', () => toggleNewForm(false));
        document.getElementById('bc-generate-btn')?.addEventListener('click', () => {
            void generateBarcode();
        });
        document.getElementById('bc-save-product-btn')?.addEventListener('click', () => {
            void generateBarcode({ saveProduct: true });
        });
        document.getElementById('bc-generate-print-btn')?.addEventListener('click', () => {
            void generateBarcode({ openPrint: true });
        });
        document.getElementById('barcode-print-btn')?.addEventListener('click', printBarcodes);
        document.getElementById('barcode-sync-cards-btn')?.addEventListener('click', () => {
            void syncCardsFromStocks();
        });
        bindLibraryEvents();

        const barcodeInput = document.getElementById('bc-new-barcode-num');
        const formatSelect = document.getElementById('bc-new-format');
        const searchInput = document.getElementById('barcode-library-search');
        if (barcodeInput) barcodeInput.addEventListener('input', updateLivePreview);
        if (formatSelect) formatSelect.addEventListener('change', updateLivePreview);
        if (searchInput) {
            searchInput.addEventListener('input', (event) => {
                librarySearchTerm = event.target.value || '';
                render();
            });
        }

        void loadLibrary();
        setSyncButtonState();
        render();
    }

    async function loadLibrary() {
        const entries = await Persistence.getBarcodeLibrary();
        generatedBarcodes = entries.map(normalizeLibraryEntry);
        nextId = Math.max(...generatedBarcodes.map((entry) => entry.id || 0), 0) + 1;
        render();
    }

    function setSyncButtonState() {
        const button = document.getElementById('barcode-sync-cards-btn');
        if (!button) return;

        button.disabled = barcodeSyncInProgress;
        const text = button.querySelector('.btn-text');
        if (text) {
            text.textContent = barcodeSyncInProgress ? 'Syncing...' : 'Sync From Stocks';
        }
    }

    function toggleNewForm(show, options = {}) {
        const row = document.getElementById('barcode-new-row');
        if (row) row.style.display = show ? 'block' : 'none';
        if (!show) return;

        updateLivePreview();
        const focusField = options.focusField || 'barcode';
        const focusIdMap = {
            barcode: 'bc-new-barcode-num',
            name_en: 'bc-new-name-en',
            name_ar: 'bc-new-name-ar',
            weight: 'bc-new-weight',
            unit_price: 'bc-new-unitprice',
            product_by: 'bc-new-productby'
        };
        const input = document.getElementById(focusIdMap[focusField] || focusIdMap.barcode);
        input?.focus();
    }

    function updateLivePreview() {
        const num = document.getElementById('bc-new-barcode-num')?.value || '';
        const format = document.getElementById('bc-new-format')?.value || 'code128';
        const preview = document.getElementById('bc-preview-svg');
        if (!preview || !num) {
            if (preview) {
                preview.innerHTML = '<div style="padding:8px;color:#999;font-size:11px">Enter barcode number...</div>';
            }
            return;
        }

        try {
            const svg = generateSVG(num, format);
            preview.innerHTML = sanitizeSvgMarkup(svg);
        } catch (error) {
            preview.innerHTML = `<div style="padding:8px;color:#e74c3c;font-size:11px">${esc(error.message)}</div>`;
        }
    }

    function generateSVG(text, format, opts = {}) {
        if (typeof bwipjs !== 'undefined' && bwipjs.toSVG) {
            return bwipjs.toSVG({
                bcid: formatToBCID(format),
                text,
                scale: 3,
                height: opts.height || 10,
                includetext: true,
                textxalign: 'center',
                textsize: 10
            });
        }

        return inlineCODE128SVG(text, opts.width || 200, opts.height || 50);
    }

    function formatToBCID(format) {
        const map = {
            code128: 'code128',
            ean13: 'ean13',
            code39: 'code39',
            'gs1-128': 'gs1-128',
            gs1128: 'gs1-128'
        };
        return map[format] || 'code128';
    }

    function inlineCODE128SVG(text, width, height) {
        const START_B = 104;
        const STOP = 106;
        const CHAR_OFFSET = 32;
        const PATTERNS = [
            '11011001100', '11001101100', '11001100110', '10010011000', '10010001100',
            '10001001100', '10011001000', '10011000100', '10001100100', '11001001000',
            '11001000100', '11000100100', '10110011100', '10011011100', '10011001110',
            '10111001100', '10011101100', '10011100110', '11001110010', '11001011100',
            '11001001110', '11011100100', '11001110100', '11101101110', '11101001100',
            '11100101100', '11100100110', '11101100100', '11100110100', '11100110010',
            '11011011000', '11011000110', '11000110110', '10100011000', '10001011000',
            '10001000110', '10110001000', '10001101000', '10001100010', '11010001000',
            '11000101000', '11000100010', '10110111000', '10110001110', '10001101110',
            '10111011000', '10111000110', '10001110110', '11101110110', '11010001110',
            '11000101110', '11011101000', '11011100010', '11011101110', '11101011000',
            '11101000110', '11100010110', '11101101000', '11101100010', '11100011010',
            '11101111010', '11001000010', '11110001010', '10100110000', '10100001100',
            '10010110000', '10010000110', '10000101100', '10000100110', '10110010000',
            '10110000100', '10011010000', '10011000010', '10000110100', '10000110010',
            '11000010010', '11001010000', '11110111010', '11000010100', '10001111010',
            '10100111100', '10010111100', '10010011110', '10111100100', '10011110100',
            '10011110010', '11110100100', '11110010100', '11110010010', '11011011110',
            '11011110110', '11110110110', '10101111000', '10100011110', '10001011110',
            '10111101000', '10111100010', '11110101000', '11110100010', '10111011110',
            '10111101110', '11101011110', '11110101110', '11010000100', '11010010000',
            '11010011100', '1100011101011'
        ];

        const codes = [START_B];
        for (let index = 0; index < text.length; index += 1) {
            codes.push(text.charCodeAt(index) - CHAR_OFFSET);
        }

        let checksum = START_B;
        for (let index = 1; index < codes.length; index += 1) {
            checksum += codes[index] * index;
        }
        codes.push(checksum % 103);
        codes.push(STOP);

        let bits = '';
        for (const code of codes) bits += PATTERNS[code];

        const barWidth = width / bits.length;
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height + 15}" width="${width}" height="${height + 15}">`;
        svg += `<rect width="${width}" height="${height + 15}" fill="white"/>`;

        for (let index = 0; index < bits.length; index += 1) {
            if (bits[index] === '1') {
                svg += `<rect x="${index * barWidth}" y="0" width="${barWidth}" height="${height}" fill="black"/>`;
            }
        }

        svg += `<text x="${width / 2}" y="${height + 12}" text-anchor="middle" font-family="monospace" font-size="10">${esc(text)}</text>`;
        svg += '</svg>';
        return svg;
    }

    function collectFormValues() {
        const num = document.getElementById('bc-new-barcode-num')?.value?.trim();
        const format = document.getElementById('bc-new-format')?.value || 'code128';
        const nameEN = document.getElementById('bc-new-name-en')?.value?.trim() || '';
        const nameAR = document.getElementById('bc-new-name-ar')?.value?.trim() || '';
        const weight = document.getElementById('bc-new-weight')?.value?.trim() || '';
        const unitPrice = document.getElementById('bc-new-unitprice')?.value || '';
        const unitPriceFils = InvoiceMath.parseFils(unitPrice);
        const productBy = document.getElementById('bc-new-productby')?.value?.trim() || '';
        return {
            num,
            format,
            nameEN,
            nameAR,
            weight,
            unitPriceFils,
            productBy
        };
    }

    function clearForm() {
        ['bc-new-barcode-num', 'bc-new-name-en', 'bc-new-name-ar', 'bc-new-weight', 'bc-new-unitprice', 'bc-new-productby']
            .forEach((id) => {
                const input = document.getElementById(id);
                if (input) input.value = '';
            });
        updateLivePreview();
    }

    async function findExistingEntry(barcodeNumber) {
        const existingProduct = await Persistence.getProductByBarcode(barcodeNumber);
        if (existingProduct) {
        return {
            nameEN: existingProduct.name_en || '',
            nameAR: existingProduct.name_ar || '',
            weight: existingProduct.weight || '',
            unitPriceFils: Number(existingProduct.unit_price_fils || 0) || 0,
            productBy: existingProduct.product_by || '',
            packQtyText: existingProduct.pack_qty_text || '',
            reorderLevel: existingProduct.reorder_level || 5,
            displayOrder: existingProduct.display_order || 0,
            country: existingProduct.country || ''
        };
        }

        const matches = await Persistence.getBarcodeLibrary(barcodeNumber);
        const exactMatch = Array.isArray(matches)
            ? matches.find((entry) => String(entry.barcode_number || '') === String(barcodeNumber))
            : null;
        if (!exactMatch) return null;

        return {
            nameEN: exactMatch.name_en || '',
            nameAR: exactMatch.name_ar || '',
            weight: exactMatch.weight || '',
            unitPriceFils: Number(exactMatch.unit_price_fils || 0) || 0,
            productBy: exactMatch.product_by || '',
            reorderLevel: 5,
            stockQty: 0,
            country: ''
        };
    }

    function applyPrefillToForm(barcodeNumber, match) {
        const barcodeInput = document.getElementById('bc-new-barcode-num');
        const nameEN = document.getElementById('bc-new-name-en');
        const nameAR = document.getElementById('bc-new-name-ar');
        const weight = document.getElementById('bc-new-weight');
        const unitPrice = document.getElementById('bc-new-unitprice');
        const productBy = document.getElementById('bc-new-productby');

        if (barcodeInput) barcodeInput.value = barcodeNumber || '';
        if (match) {
            if (nameEN) nameEN.value = match.nameEN || '';
            if (nameAR) nameAR.value = match.nameAR || '';
            if (weight) weight.value = match.weight || '';
            if (unitPrice) unitPrice.value = InvoiceMath.filsToKD(match.unitPriceFils || 0);
            if (productBy) productBy.value = match.productBy || '';
        }
        updateLivePreview();
    }

    async function prefillFromScan(scanData) {
        const barcodeNumber = String(scanData || '').trim();
        if (!barcodeNumber) return;

        toggleNewForm(true, { focusField: 'name_en' });
        const match = await findExistingEntry(barcodeNumber);
        applyPrefillToForm(barcodeNumber, match);

        const nextField = match?.nameEN ? 'weight' : 'name_en';
        toggleNewForm(true, { focusField: nextField });
        Notification.show(match
            ? 'Barcode form prefilled from saved data.'
            : 'Barcode number captured. Complete the remaining details.', 'info');
    }

    async function generateBarcode(options = {}) {
        const {
            num,
            format,
            nameEN,
            nameAR,
            weight,
            unitPriceFils,
            productBy
        } = collectFormValues();
        if (!num) {
            Notification.show('Barcode number is required.', 'warning');
            return;
        }

        let svg;
        try {
            svg = generateSVG(num, format);
        } catch (error) {
            Notification.show(`Barcode generation failed: ${error.message}`, 'error');
            return;
        }

        const savedEntry = await Persistence.saveBarcodeEntry({
            barcode_number: num,
            format,
            name_en: nameEN,
            name_ar: nameAR,
            weight,
            unit_price_fils: unitPriceFils,
            product_by: productBy
        });

        if (!savedEntry) {
            Notification.show('Barcode library update failed.', 'error');
            return;
        }

        upsertGeneratedBarcode({
            ...normalizeLibraryEntry(savedEntry),
            svg: sanitizeSvgMarkup(svg)
        });

        if (options.saveProduct === true) {
            const existingProduct = await Persistence.getProductByBarcode(num);
            await Persistence.upsertProduct({
                barcode: num,
                name_en: nameEN,
                name_ar: nameAR,
                country: existingProduct?.country || '',
                weight,
                unit_price_fils: unitPriceFils,
                product_by: productBy,
                pack_qty_text: existingProduct?.pack_qty_text || '',
                reorder_level: existingProduct?.reorder_level || 5,
                display_order: existingProduct?.display_order || 0
            });
        }

        const printEntry = normalizeLibraryEntry(savedEntry);
        clearForm();
        toggleNewForm(false);
        render();

        if (options.openPrint === true) {
            PrintManager.startBarcodePrintFlow([{ ...printEntry, copies: 1, selected: true }]);
            Notification.show('Barcode saved to the reprint library and opened for printing.', 'success');
            return;
        }

        Notification.show(
            options.saveProduct === true
                ? 'Barcode saved to the library and product master.'
                : 'Barcode saved to the reprint library.',
            'success'
        );
    }

    function normalizeLibraryEntry(entry) {
        const barcodeNumber = entry.barcode_number || entry.barcodeNumber || '';
        const format = entry.format || 'code128';
        let svgMarkup = '';

        try {
            svgMarkup = sanitizeSvgMarkup(generateSVG(barcodeNumber, format));
        } catch (_) {
            svgMarkup = sanitizeSvgMarkup(generateSVG(barcodeNumber, 'code128'));
        }

        return {
            id: entry.id || nextId++,
            barcodeNumber,
            format,
            itemNameEN: entry.name_en || entry.itemNameEN || '',
            itemNameAR: entry.name_ar || entry.itemNameAR || '',
            weight: entry.weight || '',
            unitPriceFils: entry.unit_price_fils || entry.unitPriceFils || 0,
            unitPrice: InvoiceMath.filsToKD(entry.unit_price_fils || entry.unitPriceFils || 0),
            productBy: entry.product_by || entry.productBy || '',
            svg: svgMarkup,
            copies: Math.max(1, parseInt(entry.copies, 10) || 1),
            selected: !!entry.selected
        };
    }

    function upsertGeneratedBarcode(entry) {
        const index = generatedBarcodes.findIndex((barcode) => barcode.barcodeNumber === entry.barcodeNumber);
        const previous = index >= 0 ? generatedBarcodes[index] : null;
        const merged = {
            ...entry,
            copies: previous?.copies || entry.copies || 1,
            selected: previous?.selected || false
        };

        if (index >= 0) {
            generatedBarcodes.splice(index, 1, merged);
        } else {
            generatedBarcodes.unshift(merged);
        }

        nextId = Math.max(nextId, merged.id + 1);
    }

    function normalizeSyncTextValue(value) {
        return String(value || '').trim();
    }

    function buildSyncedCardEntry(barcode, product) {
        const unitPriceFils = Number(product?.unit_price_fils || 0) || 0;
        return {
            id: barcode.id,
            barcodeNumber: barcode.barcodeNumber,
            format: barcode.format || 'code128',
            itemNameEN: normalizeSyncTextValue(product?.name_en),
            itemNameAR: normalizeSyncTextValue(product?.name_ar),
            weight: normalizeSyncTextValue(product?.weight),
            unitPriceFils,
            unitPrice: InvoiceMath.filsToKD(unitPriceFils),
            productBy: normalizeSyncTextValue(product?.product_by),
            svg: barcode.svg || '',
            copies: Math.max(1, parseInt(barcode.copies, 10) || 1),
            selected: !!barcode.selected
        };
    }

    function hasSyncedCardChanges(current, next) {
        return normalizeSyncTextValue(current?.itemNameEN) !== normalizeSyncTextValue(next?.itemNameEN)
            || normalizeSyncTextValue(current?.itemNameAR) !== normalizeSyncTextValue(next?.itemNameAR)
            || normalizeSyncTextValue(current?.weight) !== normalizeSyncTextValue(next?.weight)
            || (Number(current?.unitPriceFils || 0) || 0) !== (Number(next?.unitPriceFils || 0) || 0)
            || normalizeSyncTextValue(current?.productBy) !== normalizeSyncTextValue(next?.productBy);
    }

    function createLibrarySavePayload(entry) {
        return {
            barcode_number: entry.barcodeNumber,
            format: entry.format || 'code128',
            name_en: entry.itemNameEN || '',
            name_ar: entry.itemNameAR || '',
            weight: entry.weight || '',
            unit_price_fils: Number(entry.unitPriceFils || 0) || 0,
            product_by: entry.productBy || ''
        };
    }

    async function syncCardsFromStocks() {
        if (barcodeSyncInProgress) return;
        if (generatedBarcodes.length === 0) {
            Notification.show('No barcode cards available to sync.', 'info');
            return;
        }

        barcodeSyncInProgress = true;
        setSyncButtonState();

        try {
            const products = await Persistence.getAllProducts({ includeArchived: true });
            const productMap = new Map(
                (products || []).map((product) => [normalizeSyncTextValue(product?.barcode), product])
            );

            const updates = generatedBarcodes
                .map((barcode) => {
                    const product = productMap.get(normalizeSyncTextValue(barcode?.barcodeNumber));
                    if (!product) return null;

                    const syncedEntry = buildSyncedCardEntry(barcode, product);
                    return hasSyncedCardChanges(barcode, syncedEntry) ? syncedEntry : null;
                })
                .filter(Boolean);

            if (updates.length === 0) {
                Notification.show('Barcode cards are already up to date.', 'info');
                return;
            }

            let updatedCount = 0;
            let failedCount = 0;
            const batchSize = 20;

            for (let index = 0; index < updates.length; index += batchSize) {
                const batch = updates.slice(index, index + batchSize);
                const results = await Promise.allSettled(
                    batch.map((entry) => Persistence.saveBarcodeEntry(createLibrarySavePayload(entry)))
                );

                results.forEach((result) => {
                    if (result.status === 'fulfilled' && result.value) {
                        upsertGeneratedBarcode(normalizeLibraryEntry(result.value));
                        updatedCount += 1;
                    } else {
                        failedCount += 1;
                    }
                });
            }

            render();

            if (updatedCount === 0) {
                Notification.show('Barcode card sync failed.', 'error');
                return;
            }

            if (failedCount > 0) {
                Notification.show(`${updatedCount} barcode cards synced. ${failedCount} failed.`, 'warning');
                return;
            }

            Notification.show(`${updatedCount} barcode cards synced from My Stocks.`, 'success');
        } finally {
            barcodeSyncInProgress = false;
            setSyncButtonState();
        }
    }

    function getVisibleBarcodes() {
        if (!librarySearchTerm) return generatedBarcodes;
        const query = librarySearchTerm.toLowerCase();
        return generatedBarcodes.filter((barcode) =>
            (barcode.barcodeNumber || '').toLowerCase().includes(query)
            || (barcode.itemNameEN || '').toLowerCase().includes(query)
            || (barcode.itemNameAR || '').includes(query)
            || (barcode.productBy || '').toLowerCase().includes(query)
        );
    }

    function bindLibraryEvents() {
        const wrap = document.getElementById('bc-list-wrap');
        if (!wrap || wrap.dataset.eventsBound === 'true') return;

        wrap.dataset.eventsBound = 'true';
        wrap.addEventListener('click', (event) => {
            const deleteButton = event.target.closest('[data-action="delete-barcode"]');
            if (deleteButton) {
                void _deleteBarcode(event, parseInt(deleteButton.dataset.id, 10));
                return;
            }

            const selectControl = event.target.closest('[data-action="toggle-select"]');
            if (selectControl) {
                _toggleSelect(event, parseInt(selectControl.dataset.id, 10));
            }
        });

        wrap.addEventListener('change', (event) => {
            const copiesInput = event.target.closest('input[data-action="update-copies"]');
            if (!copiesInput) return;
            _updateCopies(parseInt(copiesInput.dataset.id, 10), copiesInput.value);
        });
    }

    function renderCardListLegacy() {
        const wrap = document.getElementById('bc-list-wrap');
        if (!wrap) return;

        const visibleBarcodes = getVisibleBarcodes();
        if (generatedBarcodes.length === 0) {
            wrap.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px">No saved barcodes yet. Click "New Barcode" to create one.</div>';
            return;
        }

        if (visibleBarcodes.length === 0) {
            wrap.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px">No saved barcodes match your search.</div>';
            return;
        }

        wrap.innerHTML = '<div class="bc-list">' + visibleBarcodes.map((barcode) => `
            <div class="bc-card ${barcode.selected ? 'bc-card-selected' : ''}" data-id="${barcode.id}">
                ${barcode.selected ? '<div class="bc-selected-overlay">âœ“</div>' : ''}
                <div class="bc-card-header">
                    <span class="bc-card-barcode-num">${esc(barcode.barcodeNumber)}</span>
                    <div class="bc-card-actions">
                        <button type="button" class="bc-select-btn ${barcode.selected ? 'active' : ''}" data-action="toggle-select" data-id="${barcode.id}" title="Select barcode">
                            ${barcode.selected ? 'âœ“ Selected' : 'Select'}
                        </button>
                        <button type="button" class="bc-delete-btn" data-action="delete-barcode" data-id="${barcode.id}" title="Delete barcode">
                            <span class="bc-delete-icon" aria-hidden="true">ðŸ—‘ï¸</span>
                            <span>Delete</span>
                        </button>
                    </div>
                </div>
                <div class="bc-card-svg" data-action="toggle-select" data-id="${barcode.id}">${barcode.svg}</div>
                <div class="bc-card-details">
                    <span><strong>EN:</strong> ${esc(barcode.itemNameEN)}</span>
                    <span dir="rtl"><strong>AR:</strong> ${esc(barcode.itemNameAR)}</span>
                    <span><strong>Weight:</strong> ${esc(barcode.weight)}</span>
                    <span><strong>Unit Price:</strong> ${esc(barcode.unitPrice)} KD.</span>
                    <span class="bc-card-detail-full"><strong>Product By:</strong> ${esc(barcode.productBy)}</span>
                </div>
                <div class="bc-card-copies">
                    <label>Copies:</label>
                    <input type="number" min="1" max="100" value="${barcode.copies}" data-action="update-copies" data-id="${barcode.id}" />
                </div>
            </div>
        `).join('') + '</div>';
    }

    function render() {
        const wrap = document.getElementById('bc-list-wrap');
        if (!wrap) return;

        const visibleBarcodes = getVisibleBarcodes();
        if (generatedBarcodes.length === 0) {
            wrap.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px">No saved barcodes yet. Click "New Barcode" to create one.</div>';
            return;
        }

        if (visibleBarcodes.length === 0) {
            wrap.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px">No saved barcodes match your search.</div>';
            return;
        }

        wrap.innerHTML = '<div class="bc-list">' + visibleBarcodes.map((barcode) => `
            <div class="bc-card ${barcode.selected ? 'bc-card-selected' : ''}" data-id="${barcode.id}">
                <div class="bc-card-header">
                    <span class="bc-card-barcode-num">${esc(barcode.barcodeNumber)}</span>
                    <div class="bc-card-actions">
                        <button type="button" class="bc-select-btn ${barcode.selected ? 'active' : ''}" data-action="toggle-select" data-id="${barcode.id}" title="Select barcode">
                            ${barcode.selected ? '&#10003; Selected' : 'Select'}
                        </button>
                        <button type="button" class="bc-delete-btn" data-action="delete-barcode" data-id="${barcode.id}" title="Delete barcode">
                            <span class="bc-delete-icon" aria-hidden="true">&#128465;</span>
                            <span>Delete</span>
                        </button>
                    </div>
                </div>
                <div class="bc-card-svg" data-action="toggle-select" data-id="${barcode.id}">${barcode.svg}</div>
                <div class="bc-card-details">
                    <span><strong>EN:</strong> ${esc(barcode.itemNameEN)}</span>
                    <span dir="rtl"><strong>AR:</strong> ${esc(barcode.itemNameAR)}</span>
                    <span><strong>Weight:</strong> ${esc(barcode.weight)}</span>
                    <span><strong>Unit Price:</strong> ${esc(barcode.unitPrice)} KD.</span>
                    <span class="bc-card-detail-full"><strong>Product By:</strong> ${esc(barcode.productBy)}</span>
                </div>
                <div class="bc-card-copies">
                    <label>Copies:</label>
                    <input type="number" min="1" max="100" value="${barcode.copies}" data-action="update-copies" data-id="${barcode.id}" />
                </div>
            </div>
        `).join('') + '</div>';
    }

    async function _deleteBarcode(event, id) {
        event?.preventDefault?.();
        event?.stopPropagation?.();

        const barcode = generatedBarcodes.find((entry) => entry.id === id);
        if (barcode?.id) {
            await Persistence.deleteBarcodeEntry(barcode.id);
        }

        generatedBarcodes = generatedBarcodes.filter((entry) => entry.id !== id);
        render();
    }

    function _updateCopies(id, value) {
        const barcode = generatedBarcodes.find((entry) => entry.id === id);
        if (barcode) barcode.copies = Math.max(1, parseInt(value, 10) || 1);
    }

    function _toggleSelect(event, id) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const barcode = generatedBarcodes.find((entry) => entry.id === id);
        if (barcode) barcode.selected = !barcode.selected;
        render();
    }

    function printBarcodes() {
        const selected = generatedBarcodes.filter((barcode) => barcode.selected);
        if (selected.length === 0) {
            Notification.show('Select barcodes to print.', 'warning');
            return;
        }

        const labels = [];
        selected.forEach((barcode) => {
            for (let index = 0; index < barcode.copies; index += 1) {
                labels.push(barcode);
            }
        });

        PrintManager.startBarcodePrintFlow(labels);
    }

    function lookupByBarcodeNumber(barcodeNumber) {
        return generatedBarcodes.find((barcode) => barcode.barcodeNumber === barcodeNumber) || null;
    }

    function sanitizeSvgMarkup(svgMarkup) {
        const parser = new DOMParser();
        const documentRoot = parser.parseFromString(String(svgMarkup || ''), 'image/svg+xml');
        const root = documentRoot.documentElement;

        if (!root || root.nodeName.toLowerCase() !== 'svg') {
            throw new Error('Invalid barcode preview markup.');
        }

        documentRoot.querySelectorAll('script, foreignObject').forEach((node) => node.remove());
        documentRoot.querySelectorAll('*').forEach((node) => {
            Array.from(node.attributes || []).forEach((attribute) => {
                const name = attribute.name.toLowerCase();
                const value = attribute.value || '';
                if (name.startsWith('on') || /javascript:/i.test(value)) {
                    node.removeAttribute(attribute.name);
                }
            });
        });

        return new XMLSerializer().serializeToString(root);
    }

    function esc(str) {
        const host = document.createElement('div');
        host.textContent = str || '';
        return host.innerHTML;
    }

    function getGenerated() {
        return generatedBarcodes;
    }

    function setGenerated(data) {
        if (!Array.isArray(data)) return;
        generatedBarcodes = data.map(normalizeLibraryEntry);
        nextId = Math.max(...generatedBarcodes.map((entry) => entry.id || 0), 0) + 1;
        render();
    }

    return {
        init,
        render,
        generateBarcode,
        syncCardsFromStocks,
        printBarcodes,
        lookupByBarcodeNumber,
        prefillFromScan,
        getGenerated,
        setGenerated,
        _deleteBarcode,
        _updateCopies,
        _toggleSelect
    };
})();
