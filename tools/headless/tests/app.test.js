const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createHarness } = require('../lib/harness');
const {
    dismissConfirmNewIfVisible,
    dismissDraftRecoveryIfVisible,
    ensureAdvancedPrintSettingsVisible,
    fillAndBlur,
    handleInvoiceBarcodeUpdateIfVisible,
    inspectPdf,
    resetTransientUiState,
    waitForDbRow,
    waitForFile,
    waitForPreviewReady,
    waitForPreviewSheetCount,
    waitForPreviewSheetCountAtLeast,
    waitForSettingValue
} = require('../lib/helpers');

async function choosePageAction(page, action) {
    await page.click('#btn-add-page');
    await page.waitForFunction(() => {
        const menu = document.getElementById('page-actions-menu');
        return !!menu && menu.style.display !== 'none';
    });
    await page.click(`[data-page-action="${action}"]`);
}

async function openShareMenu(page) {
    const isMenuVisible = await page.evaluate(() => {
        const menu = document.getElementById('sell-share-menu');
        if (!menu) return false;
        return menu.classList.contains('is-open') && window.getComputedStyle(menu).display !== 'none';
    });

    if (isMenuVisible) {
        return;
    }

    await page.click('#btn-share-menu');
    await page.waitForFunction(() => {
        const menu = document.getElementById('sell-share-menu');
        if (!menu) return false;
        const styles = window.getComputedStyle(menu);
        return menu.classList.contains('is-open')
            && styles.display !== 'none'
            && styles.pointerEvents !== 'none'
            && Number.parseFloat(styles.opacity || '0') > 0.9;
    });
    await page.waitForSelector('#btn-share-whatsapp', { state: 'visible' });
    await page.waitForTimeout(260);
}

async function openHistoryShareMenu(page, id) {
    const selector = `[data-history-share-toggle="${id}"]`;
    const expanded = await page.getAttribute(selector, 'aria-expanded');
    if (expanded !== 'true') {
        await page.click(selector);
    }

    await page.waitForFunction((historyId) => {
        const menu = document.querySelector(`[data-history-id="${historyId}"] .history-share-menu`);
        return !!menu && !menu.hasAttribute('hidden');
    }, id);
}

async function seedInvoiceWorkspace(page, { invoiceNumber, customerName, itemName, barcode = '', unitPriceFils = 1000, qty = 1, productBy = 'Nexus Foods' }) {
    await page.evaluate(async (payload) => {
        await Sell.newDocument({ discardUnsaved: true });
        Sell.setView('invoice');
        Invoice.setData({
            ...Invoice.defaultInvoiceData(),
            invoiceNumber: payload.invoiceNumber,
            billTo: { ...Invoice.defaultInvoiceData().billTo, name: payload.customerName },
            pages: [{
                items: [{
                    barcode: payload.barcode,
                    name_en: payload.itemName,
                    name_ar: '',
                    weight: '1kg',
                    unit_price_fils: payload.unitPriceFils,
                    qty: payload.qty,
                    product_by: payload.productBy
                }]
            }]
        });
        Sell.render();
    }, { invoiceNumber, customerName, itemName, barcode, unitPriceFils, qty, productBy });
}

async function seedLetterheadWorkspace(page, { addressee, itemName, barcode = '', unitPriceFils = 1000, qty = 1, productBy = 'Nexus Foods' }) {
    await page.evaluate(async (payload) => {
        await Sell.newDocument({ discardUnsaved: true });
        Sell.setView('letterhead');
        Invoice.setLetterheadData({
            ...Invoice.defaultLetterheadData(),
            to: payload.addressee,
            date: '08 Mar 2026',
            pages: [{
                items: [{
                    barcode: payload.barcode,
                    name_en: payload.itemName,
                    name_ar: '',
                    weight: '1kg',
                    unit_price_fils: payload.unitPriceFils,
                    qty: payload.qty,
                    product_by: payload.productBy
                }]
            }]
        });
        Sell.render();
    }, { addressee, itemName, barcode, unitPriceFils, qty, productBy });
}

async function waitForExternalActions(harness, expectedCount) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
        if (harness.externalActions.length >= expectedCount) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
}

test('Nexus headless integration suite', { concurrency: false }, async (t) => {
    const harness = await createHarness();

    try {
        await harness.gotoApp();
        t.afterEach(async () => {
            try {
                await resetTransientUiState(harness.page);
            } catch (_) {
                // Keep the original subtest failure as the primary signal.
            }
        });

        await t.test('boots the login screen and authenticates', async () => {
            await assert.equal(await harness.page.locator('#login-form').isVisible(), true);
            await harness.login();
            await assert.equal(await harness.page.locator('#app-container').isVisible(), true);
            assert.equal(await harness.page.locator('#sell-view-type').inputValue(), 'invoice');
            assert.equal((await harness.page.locator('#scan-target-value').textContent()).trim(), 'Sell / Invoice');
            assert.match(await harness.page.locator('#btn-print-doc').textContent(), /Print \/ Save/);
            await harness.assertNoFatalError();
        });

        await t.test('keeps My Stocks hidden until the My Stocks mode is active', async () => {
            assert.equal(await harness.page.evaluate(() => {
                const panel = document.getElementById('panel-stocks');
                return window.getComputedStyle(panel).display;
            }), 'none');

            await harness.page.click('.segment-btn[data-mode="barcode"]');
            await harness.page.waitForSelector('#panel-barcode.active');
            assert.equal(await harness.page.evaluate(() => {
                const panel = document.getElementById('panel-stocks');
                return window.getComputedStyle(panel).display;
            }), 'none');

            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.assertNoFatalError();
        });

        await t.test('creates and persists stock items through the stocks UI', async () => {
            await harness.page.click('.segment-btn[data-mode="stocks"]');
            await harness.page.waitForSelector('#panel-stocks.active');
            assert.match(await harness.page.locator('#stocks-delete-selected').textContent(), /Delete Selected/);
            assert.equal(await harness.page.locator('#stocks-remove-drafts').count(), 0);
            assert.equal(await harness.page.locator('.stocks-table thead').isHidden(), true);
            assert.match(await harness.page.locator('#stocks-tbody').textContent(), /No stock rows to show/);
            await harness.page.click('#stocks-add-row');
            assert.equal(await harness.page.locator('.stocks-table thead').isHidden(), false);

            const row = '#stocks-tbody tr:first-child';
            await fillAndBlur(harness.page, `${row} [data-field="barcode"]`, '100100');
            await fillAndBlur(harness.page, `${row} [data-field="product_by"]`, 'Nexus Foods');
            await fillAndBlur(harness.page, `${row} [data-field="name_en"]`, 'Cardamom Tea');
            await fillAndBlur(harness.page, `${row} [data-field="name_ar"]`, 'Tea Arabic');
            await fillAndBlur(harness.page, `${row} [data-field="weight"]`, '500g');
            await fillAndBlur(harness.page, `${row} [data-field="pack_qty_text"]`, '6 Packet');
            await fillAndBlur(harness.page, `${row} [data-field="unit_price"]`, '1.250');

            const product = await waitForDbRow(
                harness.electronMain,
                'SELECT * FROM products WHERE barcode = ?',
                ['100100']
            );

            assert.ok(product, 'product should be saved in sqlite');
            assert.equal(product.name_en, 'Cardamom Tea');
            assert.equal(product.pack_qty_text, '6 Packet');
            assert.equal(product.unit_price_fils, 1250);
            assert.equal(product.stock_qty, 6);
            assert.ok(product.display_order > 0);

            const stockHeaders = (await harness.page.locator('.stocks-table thead th').allTextContents())
                .map((value) => value.replace(/\s+/g, ' ').trim())
                .filter(Boolean);
            assert.equal(stockHeaders.length, 8);
            assert.deepEqual(stockHeaders.filter((label) => label !== 'اسم الصنف'), [
                'S. no.',
                'Barcode',
                'Product By',
                'Item Name',
                'Weight',
                'Qty.',
                'Unit Price'
            ]);
            assert.ok(stockHeaders.includes('اسم الصنف'));

            await harness.page.fill('#stocks-search', 'Cardamom');
            await assert.equal(await harness.page.locator('#stocks-tbody tr').count(), 1);
            await assert.equal(await harness.page.locator('#notification-badge').textContent(), '0');
            await harness.page.fill('#stocks-search', '');
            await harness.assertNoFatalError();
        });

        await t.test('focuses stock cells on a single click', async () => {
            await harness.page.click('.segment-btn[data-mode="stocks"]');
            await harness.page.waitForSelector('#panel-stocks.active');
            await harness.page.click('#stocks-tbody tr:first-child td:nth-child(5)');

            const activeField = await harness.page.evaluate(() => {
                const active = document.activeElement;
                return active?.dataset?.field || '';
            });

            assert.equal(activeField, 'name_en');
            const selectionState = await harness.page.evaluate(() => {
                const active = document.activeElement;
                return {
                    selectionStart: active?.selectionStart ?? null,
                    selectionEnd: active?.selectionEnd ?? null,
                    valueLength: String(active?.value || '').length
                };
            });
            assert.equal(selectionState.selectionStart, selectionState.selectionEnd);
            assert.notEqual(selectionState.selectionEnd, selectionState.valueLength);
            await harness.assertNoFatalError();
        });

        await t.test('shows stock movement history while keeping invoice-style columns visible', async () => {
            await harness.page.click('.segment-btn[data-mode="stocks"]');
            await harness.page.waitForSelector('#panel-stocks.active');
            await harness.page.click('#stocks-add-row');

            const row = '#stocks-tbody tr:first-child';
            await fillAndBlur(harness.page, `${row} [data-field="barcode"]`, '100101');
            await fillAndBlur(harness.page, `${row} [data-field="product_by"]`, 'Nexus Foods');
            await fillAndBlur(harness.page, `${row} [data-field="name_en"]`, 'Adjustment Check');
            await fillAndBlur(harness.page, `${row} [data-field="weight"]`, '250g');
            await fillAndBlur(harness.page, `${row} [data-field="unit_price"]`, '0.750');

            await harness.page.fill('#stocks-search', 'Adjustment Check');
            await assert.equal(await harness.page.locator('#stocks-tbody tr').count(), 1);

            await harness.page.evaluate(async () => {
                const product = await Persistence.getProductByBarcode('100101');
                if (!product?.id) {
                    throw new Error('Expected saved stock product for history test.');
                }
                await Persistence.updateProductQty('100101', 3);
                await Persistence.addStockMovement(
                    product.id,
                    null,
                    3,
                    'manual-count',
                    'Counted three sealed packs during shelf check'
                );
                await Stocks.focusProduct(product.id);
            });

            const product = await waitForDbRow(
                harness.electronMain,
                'SELECT stock_qty FROM products WHERE barcode = ?',
                ['100101']
            );
            assert.ok(product);
            assert.equal(product.stock_qty, 3);

            const movement = await waitForDbRow(
                harness.electronMain,
                `SELECT sm.qty_change, sm.reason, sm.note
                 FROM stock_movements sm
                 JOIN products p ON p.id = sm.product_id
                 WHERE p.barcode = ?
                 ORDER BY sm.id DESC LIMIT 1`,
                ['100101']
            );
            assert.ok(movement);
            assert.equal(movement.qty_change, 3);
            assert.equal(movement.reason, 'manual-count');
            assert.equal(movement.note, 'Counted three sealed packs during shelf check');

            await harness.page.click('#stocks-view-history');
            await harness.page.waitForSelector('#stock-history-modal', { state: 'visible' });
            const historyText = await harness.page.locator('#stock-history-list').textContent();
            assert.match(historyText, /Stock count correction/i);
            assert.match(historyText, /Counted three sealed packs during shelf check/i);
            await harness.page.click('#stock-history-modal .modal-close');
            await harness.page.waitForSelector('#stock-history-modal', { state: 'hidden' });

            await harness.page.fill('#stocks-search', '');
            await harness.assertNoFatalError();
        });

        await t.test('routes scanner input by the active mode instead of always using sell', async () => {
            await harness.page.click('.segment-btn[data-mode="stocks"]');
            await harness.page.waitForSelector('#panel-stocks.active');
            assert.equal(await harness.page.locator('#scan-target-value').textContent(), 'My Stocks');
            await harness.page.evaluate(async () => {
                await Persistence.saveBarcodeEntry({
                    barcode_number: '200200',
                    format: 'code128',
                    name_en: 'Library Pepper',
                    name_ar: 'Library Pepper AR',
                    weight: '750g',
                    unit_price_fils: 990,
                    product_by: 'Library Vendor'
                });
            });
            await harness.page.evaluate(() => App.handleScan('200200'));
            await harness.page.waitForFunction(() => {
                const matches = Stocks.getItems().filter((item) => item.barcode === '200200');
                return matches.length === 1 && matches[0].stock_qty === 1;
            });
            await harness.page.evaluate(() => App.handleScan('200200'));
            await harness.page.waitForFunction(() => {
                const matches = Stocks.getItems().filter((item) => item.barcode === '200200');
                return matches.length === 1 && matches[0].stock_qty === 2;
            });

            const stockRow = await waitForDbRow(
                harness.electronMain,
                'SELECT barcode, name_en, unit_price_fils, product_by, stock_qty FROM products WHERE barcode = ?',
                ['200200']
            );
            assert.ok(stockRow, 'scanner in stocks mode should create/update a stock row');
            assert.equal(stockRow.stock_qty, 2);
            assert.equal(stockRow.name_en, 'Library Pepper');
            assert.equal(stockRow.unit_price_fils, 990);
            assert.equal(stockRow.product_by, 'Library Vendor');
            assert.ok((await harness.page.locator('#stocks-tbody tr').count()) >= 2);

            await harness.page.click('.segment-btn[data-mode="barcode"]');
            await harness.page.waitForSelector('#panel-barcode.active');
            assert.equal(await harness.page.locator('#scan-target-value').textContent(), 'Barcode Generator');
            await harness.page.evaluate(() => App.handleScan('300300'));
            await harness.page.waitForFunction(() => {
                const row = document.getElementById('barcode-new-row');
                return !!row && getComputedStyle(row).display !== 'none';
            });
            assert.equal(await harness.page.locator('#bc-new-barcode-num').inputValue(), '300300');

            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'invoice');
            await harness.page.waitForTimeout(200);
            assert.equal(await harness.page.locator('#scan-target-value').textContent(), 'Sell / Invoice');
            await harness.assertNoFatalError();
        });

        await t.test('supports keyboard navigation for sell search results', async () => {
            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'invoice');
            await harness.page.waitForTimeout(200);

            await harness.page.evaluate(async () => {
                await Sell.newDocument({ discardUnsaved: true });
                Sell.setView('invoice');
                await Persistence.upsertProduct({
                    barcode: '210100',
                    name_en: 'Alpha Powder',
                    name_ar: '',
                    country: '',
                    weight: '250g',
                    unit_price_fils: 1250,
                    product_by: 'Keyboard Vendor',
                    stock_qty: 8,
                    reorder_level: 5
                });
                await Persistence.upsertProduct({
                    barcode: '210200',
                    name_en: 'Beta Powder',
                    name_ar: '',
                    country: '',
                    weight: '500g',
                    unit_price_fils: 1750,
                    product_by: 'Keyboard Vendor',
                    stock_qty: 6,
                    reorder_level: 5
                });
                Invoice.setData({
                    ...Invoice.defaultInvoiceData(),
                    invoiceNumber: 'INV-SEARCH-KEYS',
                    pages: [{ items: [] }]
                });
                Sell.render();
            });

            await harness.page.fill('#sell-product-search', 'Powder');
            await harness.page.waitForFunction(() => {
                return document.querySelectorAll('#sell-search-results .search-result-item').length >= 2;
            });

            await harness.page.keyboard.press('ArrowDown');
            assert.equal(
                (await harness.page.locator('#sell-search-results .search-result-item.is-active .sri-name').textContent()).trim(),
                'Alpha Powder'
            );

            await harness.page.keyboard.press('ArrowDown');
            assert.equal(
                (await harness.page.locator('#sell-search-results .search-result-item.is-active .sri-name').textContent()).trim(),
                'Beta Powder'
            );

            await harness.page.keyboard.press('ArrowUp');
            assert.equal(
                (await harness.page.locator('#sell-search-results .search-result-item.is-active .sri-name').textContent()).trim(),
                'Alpha Powder'
            );

            await harness.page.keyboard.press('Enter');
            await harness.page.waitForFunction(() => {
                const data = Invoice.getData();
                return (data.pages?.[0]?.items?.[0]?.barcode || '') === '210100';
            });
            await harness.page.waitForFunction(() => {
                const results = document.getElementById('sell-search-results');
                return !!results && results.style.display === 'none';
            });

            assert.equal(
                await harness.page.locator('#sell-workspace [data-field="name_en"]').first().textContent(),
                'Alpha Powder'
            );
            await harness.assertNoFatalError();
        });

        await t.test('keeps scan additions on the selected invoice and letterhead page', async () => {
            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'invoice');
            await harness.page.waitForTimeout(200);

            await harness.page.evaluate(() => {
                Sell.setView('invoice');
                Invoice.setData({
                    ...Invoice.defaultInvoiceData(),
                    pages: [
                        {
                            items: [{
                                barcode: 'INV-PAGE-ADD',
                                name_en: 'Invoice Page One',
                                name_ar: '',
                                weight: '1kg',
                                unit_price_fils: 1000,
                                qty: 1,
                                product_by: 'Page Vendor'
                            }]
                        },
                        { items: [] }
                    ]
                });
                Sell.render();
            });

            await harness.page.click('#sell-workspace .inv-page[data-page="2"]');
            await harness.page.waitForFunction(() => {
                const selected = document.querySelector('#sell-workspace .inv-page.page-selected');
                return selected?.getAttribute('data-page') === '2';
            });
            await harness.page.evaluate(async () => {
                await Sell.handleScan('INV-PAGE-ADD');
            });
            await harness.page.waitForFunction(() => {
                const data = Invoice.getData();
                return (data.pages?.[0]?.items?.length || 0) === 1
                    && (data.pages?.[0]?.items?.[0]?.qty || 0) === 1
                    && (data.pages?.[1]?.items?.length || 0) === 1
                    && (data.pages?.[1]?.items?.[0]?.barcode || '') === 'INV-PAGE-ADD';
            });

            const invoiceSelectedPageState = await harness.page.evaluate(() => ({
                selectedPage: document.querySelector('#sell-workspace .inv-page.page-selected')?.getAttribute('data-page') || '',
                pageOneQty: document.querySelector('#sell-workspace .inv-page[data-page="1"] [data-field="qty"]')?.textContent?.trim() || '',
                pageTwoBarcode: document.querySelector('#sell-workspace .inv-page[data-page="2"] [data-field="barcode"]')?.textContent?.trim() || ''
            }));

            assert.equal(invoiceSelectedPageState.selectedPage, '2');
            assert.equal(invoiceSelectedPageState.pageOneQty, '1');
            assert.equal(invoiceSelectedPageState.pageTwoBarcode, 'INV-PAGE-ADD');

            await harness.page.selectOption('#sell-view-type', 'letterhead');
            await harness.page.waitForTimeout(200);

            await harness.page.evaluate(() => {
                Sell.setView('letterhead');
                Invoice.setLetterheadData({
                    ...Invoice.defaultLetterheadData(),
                    pages: [
                        {
                            items: [{
                                barcode: 'LH-PAGE-ADD',
                                name_en: 'Letterhead Page One',
                                name_ar: '',
                                weight: '500g',
                                unit_price_fils: 500,
                                qty: 1,
                                product_by: 'Page Vendor'
                            }]
                        },
                        { items: [] }
                    ]
                });
                Sell.render();
            });

            await harness.page.click('#sell-workspace .inv-page[data-page="2"]');
            await harness.page.waitForFunction(() => {
                const selected = document.querySelector('#sell-workspace .inv-page.page-selected');
                return selected?.getAttribute('data-page') === '2';
            });
            await harness.page.evaluate(async () => {
                await Sell.handleScan('LH-PAGE-ADD');
            });
            await harness.page.waitForFunction(() => {
                const data = Invoice.getLetterheadData();
                return (data.pages?.[0]?.items?.length || 0) === 1
                    && (data.pages?.[0]?.items?.[0]?.qty || 0) === 1
                    && (data.pages?.[1]?.items?.length || 0) === 1
                    && (data.pages?.[1]?.items?.[0]?.barcode || '') === 'LH-PAGE-ADD';
            });

            const letterheadSelectedPageState = await harness.page.evaluate(() => ({
                selectedPage: document.querySelector('#sell-workspace .inv-page.page-selected')?.getAttribute('data-page') || '',
                pageOneQty: document.querySelector('#sell-workspace .inv-page[data-page="1"] [data-field="qty"]')?.textContent?.trim() || '',
                pageTwoBarcode: document.querySelector('#sell-workspace .inv-page[data-page="2"] [data-field="barcode"]')?.textContent?.trim() || ''
            }));

            assert.equal(letterheadSelectedPageState.selectedPage, '2');
            assert.equal(letterheadSelectedPageState.pageOneQty, '1');
            assert.equal(letterheadSelectedPageState.pageTwoBarcode, 'LH-PAGE-ADD');
            await harness.assertNoFatalError();
        });

        await t.test('restarts serial numbers from one on each invoice and letterhead page', async () => {
            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'invoice');
            await harness.page.waitForTimeout(200);

            await harness.page.evaluate(() => {
                Sell.setView('invoice');
                Invoice.setData({
                    ...Invoice.defaultInvoiceData(),
                    pages: [{
                        items: Array.from({ length: 21 }, (_, index) => ({
                            barcode: `INV-${index + 1}`,
                            name_en: `Invoice Serial ${index + 1}`,
                            name_ar: '',
                            weight: '1kg',
                            unit_price_fils: 1000,
                            qty: 1,
                            product_by: 'Serial Vendor'
                        }))
                    }]
                });
                Sell.render();
            });

            const invoiceSerialState = await harness.page.evaluate(() => {
                const pageOneSerials = Array.from(document.querySelectorAll('#sell-workspace .inv-page[data-page="1"] .inv-table tbody tr:not(.inv-subtotal-row) .col-sno'));
                const pageTwoFirst = document.querySelector('#sell-workspace .inv-page[data-page="2"] .inv-table tbody tr .col-sno');
                const header = document.querySelector('#sell-workspace .inv-page[data-page="1"] .inv-table thead th.col-sno')?.textContent || '';
                return {
                    header,
                    pageOneFirst: pageOneSerials[0]?.textContent?.trim() || '',
                    pageOneLast: pageOneSerials[pageOneSerials.length - 1]?.textContent?.trim() || '',
                    pageTwoFirst: pageTwoFirst?.textContent?.trim() || ''
                };
            });

            assert.match(invoiceSerialState.header, /S\.\s*no/i);
            assert.equal(invoiceSerialState.pageOneFirst, '1');
            assert.equal(invoiceSerialState.pageOneLast, '20');
            assert.equal(invoiceSerialState.pageTwoFirst, '1');

            await harness.page.selectOption('#sell-view-type', 'letterhead');
            await harness.page.waitForTimeout(200);

            await harness.page.evaluate(() => {
                Sell.setView('letterhead');
                Invoice.setLetterheadData({
                    ...Invoice.defaultLetterheadData(),
                    to: 'Serial Customer',
                    pages: [{
                        items: Array.from({ length: 12 }, (_, index) => ({
                            barcode: `LH-${index + 1}`,
                            name_en: `Letterhead Serial ${index + 1}`,
                            name_ar: '',
                            weight: '500g',
                            unit_price_fils: 500,
                            qty: 1,
                            product_by: 'Serial Vendor'
                        }))
                    }]
                });
                Sell.render();
            });

            const letterheadSerialState = await harness.page.evaluate(() => {
                const pageOneSerials = Array.from(document.querySelectorAll('#sell-workspace .inv-page[data-page="1"] .lh-table tbody .col-sno'));
                const pageTwoFirst = document.querySelector('#sell-workspace .inv-page[data-page="2"] .lh-table tbody tr .col-sno');
                const header = document.querySelector('#sell-workspace .inv-page[data-page="1"] .lh-table thead th.col-sno')?.textContent || '';
                return {
                    header,
                    pageOneFirst: pageOneSerials[0]?.textContent?.trim() || '',
                    pageOneLast: pageOneSerials[pageOneSerials.length - 1]?.textContent?.trim() || '',
                    pageTwoFirst: pageTwoFirst?.textContent?.trim() || ''
                };
            });

            assert.match(letterheadSerialState.header, /S\.\s*no/i);
            assert.equal(letterheadSerialState.pageOneFirst, '01');
            assert.equal(letterheadSerialState.pageOneLast, '11');
            assert.equal(letterheadSerialState.pageTwoFirst, '01');
            await harness.assertNoFatalError();
        });

        await t.test('builds an invoice from scanned stock, saves it, and reopens it from saved history', async () => {
            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'invoice');
            await harness.page.waitForTimeout(200);
            await harness.page.evaluate(async () => {
                await Sell.newDocument({ discardUnsaved: true });
                await Persistence.updateProductQty('100100', 2);
                Sell.setView('invoice');
            });

            await harness.page.evaluate(async () => {
                await Sell.handleScan('100100');
                await Sell.handleScan('100100');
            });

            await harness.page.waitForFunction(() => {
                const data = Invoice.getData();
                return data.pages[0].items.length === 1 && data.pages[0].items[0].qty === 2;
            });

            assert.equal(
                await harness.page.locator('#sell-workspace [data-field="name_en"]').first().textContent(),
                'Cardamom Tea'
            );
            assert.equal(
                await harness.page.locator('#sell-workspace [data-field="qty"]').first().textContent(),
                '2'
            );

            await harness.page.evaluate(() => Sell.saveDocument());

            const documentRow = await waitForDbRow(
                harness.electronMain,
                'SELECT id, doc_type, doc_number, total_fils FROM documents ORDER BY id DESC LIMIT 1'
            );

            assert.ok(documentRow, 'saved document should exist');
            assert.equal(documentRow.doc_type, 'invoice');
            assert.equal(documentRow.total_fils, 2500);

            const nextInvoiceSetting = await waitForDbRow(
                harness.electronMain,
                'SELECT value FROM settings WHERE key = ?',
                ['next_invoice_number']
            );
            assert.equal(nextInvoiceSetting.value, '2');

            await harness.page.click('#btn-new-doc');
            await dismissConfirmNewIfVisible(harness.page);
            await harness.page.waitForFunction(() => Invoice.getData().pages[0].items.length === 0);
            assert.equal(
                await harness.page.evaluate(() => Invoice.getData().invoiceNumber),
                'INV-0002'
            );

            await harness.page.click('#btn-load-template');
            await harness.page.fill('#history-search', documentRow.doc_number);
            await harness.page.waitForFunction((docNumber) => {
                const items = Array.from(document.querySelectorAll('[data-history-select]'));
                return items.some(item => item.textContent.includes(docNumber));
            }, documentRow.doc_number);
            await harness.page.click('[data-history-select]');
            await harness.page.click('[data-history-print]');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'visible' });
            await harness.page.click('#pd-cancel-btn');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'hidden' });

            const stockAfterHistoryPrint = await waitForDbRow(
                harness.electronMain,
                'SELECT stock_qty FROM products WHERE barcode = ?',
                ['100100']
            );
            assert.equal(stockAfterHistoryPrint.stock_qty, 8);

            await harness.page.click('#btn-load-template');
            await harness.page.fill('#history-search', documentRow.doc_number);
            await harness.page.waitForFunction((docNumber) => {
                const items = Array.from(document.querySelectorAll('[data-history-select]'));
                return items.some(item => item.textContent.includes(docNumber));
            }, documentRow.doc_number);
            await harness.page.click('[data-history-select]');
            await harness.page.click('[data-history-open]');
            await harness.page.waitForFunction(() => Invoice.getData().pages[0].items.length === 1);
            await harness.page.waitForFunction(() => Sell.getViewMode() === 'view');
            assert.equal(await harness.page.locator('#sell-view-banner').isVisible(), true);
            assert.match(
                await harness.page.locator('#sell-view-banner').textContent(),
                /Viewing saved invoice/i
            );
            assert.equal(
                await harness.page.locator('#sell-workspace [data-field="name_en"]').first().getAttribute('contenteditable'),
                'false'
            );
            assert.equal(await harness.page.locator('#btn-add-page').isDisabled(), true);
            assert.equal(await harness.page.locator('#sell-product-search').isDisabled(), true);
            assert.equal(
                await harness.page.evaluate(() => Invoice.getData().pages[0].items[0].qty),
                2
            );
            await harness.page.click('#sell-view-edit-original');
            await harness.page.waitForFunction(() => Sell.getViewMode() === 'edit-original');
            assert.equal(
                await harness.page.locator('#sell-workspace [data-field="name_en"]').first().getAttribute('contenteditable'),
                'true'
            );
            await harness.assertNoFatalError();
        });

        await t.test('prompts for save names, keeps invoice and letterhead history separate, and deletes saved entries', async () => {
            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'letterhead');
            await harness.page.waitForTimeout(200);

            await harness.page.evaluate(() => {
                Sell.setView('letterhead');
                Invoice.setLetterheadData({
                    ...Invoice.defaultLetterheadData(),
                    to: 'History Separation',
                    pages: [{ items: [] }]
                });
                Sell.render();
            });

            await harness.page.click('#btn-save-template');
            await harness.page.waitForSelector('#save-template-modal', { state: 'visible' });
            assert.equal(await harness.page.locator('#save-template-modal-title').textContent(), 'Save Rapid Order Sheet');
            await fillAndBlur(harness.page, '#st-template-name', 'Letterhead Alpha');
            await harness.page.click('#st-save-btn');
            await harness.page.waitForSelector('#save-template-modal', { state: 'hidden' });

            const letterheadRow = await waitForDbRow(
                harness.electronMain,
                'SELECT id, doc_type, doc_number FROM documents WHERE doc_type = ? AND doc_number = ? ORDER BY id DESC LIMIT 1',
                ['letterhead', 'Letterhead Alpha']
            );
            assert.ok(letterheadRow, 'custom-named letterhead should be saved');

            await harness.page.selectOption('#sell-view-type', 'invoice');
            await harness.page.waitForTimeout(200);
            await harness.page.click('#btn-load-template');
            await harness.page.waitForSelector('#template-modal', { state: 'visible' });
            assert.equal(await harness.page.locator('#template-modal-title').textContent(), 'View Previous Saved Invoices');
            assert.ok(
                !(await harness.page.locator('#template-list').textContent()).includes('Letterhead Alpha'),
                'invoice history should not show saved rapid order sheets'
            );
            await harness.page.click('#template-modal .modal-close');
            await harness.page.waitForSelector('#template-modal', { state: 'hidden' });

            await harness.page.selectOption('#sell-view-type', 'letterhead');
            await harness.page.waitForTimeout(200);
            await harness.page.click('#btn-load-template');
            await harness.page.waitForSelector('#template-modal', { state: 'visible' });
            assert.equal(await harness.page.locator('#template-modal-title').textContent(), 'View Previous Saved Rapid Order Sheets');
            await harness.page.waitForFunction((docLabel) => {
                const list = document.getElementById('template-list');
                return !!list && list.textContent.includes(docLabel);
            }, 'Letterhead Alpha');

            await harness.page.click(`[data-history-delete="${letterheadRow.id}"]`);

            await harness.page.waitForFunction((id) => {
                return !Array.from(document.querySelectorAll('[data-history-id]')).some((item) => item.dataset.historyId === String(id));
            }, letterheadRow.id);

            const deletedRow = await harness.electronMain.invoke(
                'db-get',
                'SELECT id FROM documents WHERE id = ?',
                [letterheadRow.id]
            );
            assert.equal(deletedRow.data, null);

            await harness.page.click('#template-modal .modal-close');
            await harness.page.waitForSelector('#template-modal', { state: 'hidden' });

            const invoiceRow = await waitForDbRow(
                harness.electronMain,
                'SELECT id FROM documents WHERE doc_type = ? ORDER BY id DESC LIMIT 1',
                ['invoice']
            );
            const openInvoiceFromHistory = harness.page.evaluate((id) => Sell.openSavedDocumentById(id), invoiceRow.id);
            await harness.page.waitForSelector('#history-open-guard-modal', { state: 'visible' });
            await harness.page.click('#history-open-guard-discard');
            await openInvoiceFromHistory;
            await harness.page.waitForFunction(() => Sell.getView() === 'invoice' && Invoice.getData().pages[0].items.length === 1);
            await harness.page.waitForFunction(() => Sell.getViewMode() === 'view');
            await harness.page.click('#sell-view-edit-original');
            await harness.page.waitForFunction(() => Sell.getViewMode() === 'edit-original');
            await harness.assertNoFatalError();
        });

        await t.test('guards current work before opening saved history and supports draft, discard, save, and copy flows', async () => {
            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'invoice');
            await harness.page.waitForTimeout(200);

            const targetRow = await waitForDbRow(
                harness.electronMain,
                'SELECT id, doc_number, payload FROM documents WHERE doc_type = ? ORDER BY id DESC LIMIT 1',
                ['invoice']
            );
            assert.ok(targetRow, 'saved invoice should exist for history guard testing');

            await seedInvoiceWorkspace(harness.page, {
                invoiceNumber: 'INV-GUARD-CANCEL',
                customerName: 'Guard Cancel',
                itemName: 'Cancel Branch'
            });

            const cancelOpen = harness.page.evaluate((id) => Sell.openSavedDocumentById(id), targetRow.id);
            await harness.page.waitForSelector('#history-open-guard-modal', { state: 'visible' });
            assert.match(await harness.page.locator('#history-open-guard-current').textContent(), /INV-GUARD-CANCEL/);
            assert.match(await harness.page.locator('#history-open-guard-target').textContent(), new RegExp(targetRow.doc_number));
            await harness.page.click('#history-open-guard-cancel');
            await cancelOpen;
            await harness.page.waitForSelector('#history-open-guard-modal', { state: 'hidden' });
            assert.equal(await harness.page.evaluate(() => Invoice.getData().invoiceNumber), 'INV-GUARD-CANCEL');
            assert.equal(await harness.page.evaluate(() => Invoice.getData().pages[0].items[0].name_en), 'Cancel Branch');

            await seedInvoiceWorkspace(harness.page, {
                invoiceNumber: 'INV-GUARD-DRAFT',
                customerName: 'Guard Draft',
                itemName: 'Draft Branch'
            });

            const draftOpen = harness.page.evaluate((id) => Sell.openSavedDocumentById(id), targetRow.id);
            await harness.page.waitForSelector('#history-open-guard-modal', { state: 'visible' });
            await harness.page.click('#history-open-guard-draft');
            await draftOpen;
            await harness.page.waitForFunction(() => Sell.getViewMode() === 'view');
            const draftValue = await waitForSettingValue(
                harness.electronMain,
                'draft_invoice',
                (value) => typeof value === 'string' && value.includes('Draft Branch')
            );
            assert.ok(draftValue, 'draft branch should preserve the current invoice');
            assert.equal(JSON.parse(draftValue).payload.invoiceNumber, 'INV-GUARD-DRAFT');

            await harness.page.click('#sell-view-close');
            await harness.page.waitForFunction(() => Sell.getViewMode() === 'edit');
            await seedInvoiceWorkspace(harness.page, {
                invoiceNumber: 'INV-GUARD-DISCARD',
                customerName: 'Guard Discard',
                itemName: 'Discard Branch'
            });

            const documentCountBeforeDiscard = await harness.electronMain.invoke(
                'db-get',
                'SELECT COUNT(*) AS count FROM documents'
            );
            const discardOpen = harness.page.evaluate((id) => Sell.openSavedDocumentById(id), targetRow.id);
            await harness.page.waitForSelector('#history-open-guard-modal', { state: 'visible' });
            await harness.page.click('#history-open-guard-discard');
            await discardOpen;
            await harness.page.waitForFunction(() => Sell.getViewMode() === 'view');
            assert.equal(await harness.page.evaluate(() => Invoice.getData().invoiceNumber), targetRow.doc_number);
            const documentCountAfterDiscard = await harness.electronMain.invoke(
                'db-get',
                'SELECT COUNT(*) AS count FROM documents'
            );
            assert.equal(documentCountAfterDiscard.data.count, documentCountBeforeDiscard.data.count);

            await harness.page.click('#sell-view-close');
            await harness.page.waitForFunction(() => Sell.getViewMode() === 'edit');
            await seedInvoiceWorkspace(harness.page, {
                invoiceNumber: 'INV-GUARD-SAVE',
                customerName: 'Guard Save',
                itemName: 'Save Branch'
            });
            await harness.page.evaluate(async () => {
                await Sell.saveDocument({ docNumber: 'Guard Save Working' });
            });
            const workingDoc = await waitForDbRow(
                harness.electronMain,
                'SELECT id, payload FROM documents WHERE doc_number = ? ORDER BY id DESC LIMIT 1',
                ['Guard Save Working']
            );
            assert.ok(workingDoc, 'working invoice should be saved before history guard save branch');

            const saveOpen = harness.page.evaluate((id) => Sell.openSavedDocumentById(id), targetRow.id);
            await harness.page.waitForSelector('#history-open-guard-modal', { state: 'visible' });
            await harness.page.click('#history-open-guard-save');
            await saveOpen;
            await harness.page.waitForFunction(() => Sell.getViewMode() === 'view');
            const savedWorkingDoc = await waitForDbRow(
                harness.electronMain,
                'SELECT payload FROM documents WHERE id = ?',
                [workingDoc.id]
            );
            assert.equal(JSON.parse(savedWorkingDoc.payload).pages[0].items[0].name_en, 'Save Branch');

            const docCountBeforeCopy = await harness.electronMain.invoke(
                'db-get',
                'SELECT COUNT(*) AS count FROM documents'
            );
            const originalTargetDoc = await waitForDbRow(
                harness.electronMain,
                'SELECT payload FROM documents WHERE id = ?',
                [targetRow.id]
            );

            await harness.page.click('#sell-view-edit-copy');
            await harness.page.waitForFunction(() => Sell.getViewMode() === 'edit-copy');
            assert.equal(
                await harness.page.locator('#sell-workspace [data-field="name_en"]').first().getAttribute('contenteditable'),
                'true'
            );
            await harness.page.evaluate(() => {
                const cell = document.querySelector('#sell-workspace [data-field="name_en"]');
                if (cell) {
                    cell.textContent = 'Copy Branch Edited';
                    cell.dispatchEvent(new Event('input', { bubbles: true }));
                    cell.dispatchEvent(new Event('blur', { bubbles: true }));
                }
            });
            await harness.page.evaluate(async () => {
                await Sell.saveDocument({ docNumber: 'History Copy Save' });
            });

            const docCountAfterCopy = await harness.electronMain.invoke(
                'db-get',
                'SELECT COUNT(*) AS count FROM documents'
            );
            assert.equal(docCountAfterCopy.data.count, docCountBeforeCopy.data.count + 1);

            const copiedDoc = await waitForDbRow(
                harness.electronMain,
                'SELECT id, payload FROM documents WHERE doc_number = ? ORDER BY id DESC LIMIT 1',
                ['History Copy Save']
            );
            assert.ok(copiedDoc, 'edit copy should create a new saved document');
            assert.equal(JSON.parse(copiedDoc.payload).pages[0].items[0].name_en, 'Copy Branch Edited');
            assert.notEqual(copiedDoc.id, targetRow.id);
            assert.notEqual(JSON.parse(originalTargetDoc.payload).pages[0].items[0].name_en, 'Copy Branch Edited');
            await harness.assertNoFatalError();
        });

        await t.test('re-saving the same invoice updates the existing document without consuming a new invoice number', async () => {
            await harness.page.evaluate(async () => {
                await Sell.saveDocument();
            });

            const beforeCount = await harness.electronMain.invoke(
                'db-get',
                'SELECT COUNT(*) AS count FROM documents'
            );
            const beforeNextNumber = await waitForDbRow(
                harness.electronMain,
                'SELECT value FROM settings WHERE key = ?',
                ['next_invoice_number']
            );

            await harness.page.evaluate(async () => {
                const cell = document.querySelector('#sell-workspace [data-field="name_en"]');
                if (cell) {
                    cell.textContent = 'Cardamom Tea Deluxe';
                    cell.dispatchEvent(new Event('input', { bubbles: true }));
                    cell.dispatchEvent(new Event('blur', { bubbles: true }));
                }
                await Sell.saveDocument();
            });

            const afterCount = await harness.electronMain.invoke(
                'db-get',
                'SELECT COUNT(*) AS count FROM documents'
            );
            const afterNextNumber = await waitForDbRow(
                harness.electronMain,
                'SELECT value FROM settings WHERE key = ?',
                ['next_invoice_number']
            );
            const savedDocument = await waitForDbRow(
                harness.electronMain,
                'SELECT payload FROM documents ORDER BY id DESC LIMIT 1'
            );

            assert.equal(afterCount.data.count, beforeCount.data.count);
            assert.equal(afterNextNumber.value, beforeNextNumber.value);
            assert.equal(JSON.parse(savedDocument.payload).pages[0].items[0].name_en, 'Cardamom Tea Deluxe');
            await harness.assertNoFatalError();
        });

        await t.test('recovers unsaved invoice drafts after reload and clears the draft after saving', async () => {
            const beforeCount = await harness.electronMain.invoke(
                'db-get',
                'SELECT COUNT(*) AS count FROM documents'
            );
            const beforeDocument = await waitForDbRow(
                harness.electronMain,
                'SELECT id FROM documents ORDER BY id DESC LIMIT 1'
            );

            await harness.page.evaluate(() => Persistence.setSetting('remembered_session', 'true'));
            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'invoice');
            await harness.page.waitForTimeout(200);

            await harness.page.evaluate(() => {
                const cell = document.querySelector('#sell-workspace [data-field="name_en"]');
                if (cell) {
                    cell.textContent = 'Draft Recovery Item';
                    cell.dispatchEvent(new Event('input', { bubbles: true }));
                    cell.dispatchEvent(new Event('blur', { bubbles: true }));
                }
            });

            const draftValue = await waitForSettingValue(
                harness.electronMain,
                'draft_invoice',
                (value) => typeof value === 'string' && value.trim() !== ''
            );
            assert.ok(draftValue, 'invoice draft should be stored in settings');
            assert.equal(JSON.parse(draftValue).payload.pages[0].items[0].name_en, 'Draft Recovery Item');
            await harness.page.waitForFunction(() => {
                const badge = document.getElementById('sell-draft-status');
                return !!badge && /Draft saved/i.test(badge.textContent || '');
            });

            await harness.page.reload({ waitUntil: 'domcontentloaded' });
            await harness.page.waitForFunction(() => {
                const overlay = document.getElementById('login-overlay');
                const app = document.getElementById('app-container');
                return overlay && app && overlay.style.display === 'none' && app.style.display === 'flex';
            });
            await harness.page.waitForSelector('#draft-recovery-modal', { state: 'visible' });
            await harness.page.click('[data-draft-recover="invoice"]');
            await harness.page.waitForSelector('#draft-recovery-modal', { state: 'hidden' });
            await harness.page.waitForFunction(() => {
                const data = Invoice.getData();
                return data.pages[0].items[0].name_en === 'Draft Recovery Item';
            });

            await harness.page.evaluate(async () => {
                await Sell.saveDocument();
            });

            const afterCount = await harness.electronMain.invoke(
                'db-get',
                'SELECT COUNT(*) AS count FROM documents'
            );
            const recoveredDocument = await waitForDbRow(
                harness.electronMain,
                'SELECT payload FROM documents WHERE id = ?',
                [beforeDocument.id]
            );
            const clearedDraft = await waitForSettingValue(
                harness.electronMain,
                'draft_invoice',
                (value) => value === ''
            );

            assert.equal(afterCount.data.count, beforeCount.data.count);
            assert.equal(JSON.parse(recoveredDocument.payload).pages[0].items[0].name_en, 'Draft Recovery Item');
            assert.equal(clearedDraft, '');
            await harness.page.waitForFunction(() => {
                const badge = document.getElementById('sell-draft-status');
                return !!badge && /No draft pending/i.test(badge.textContent || '');
            });
            await harness.assertNoFatalError();
        });

        await t.test('canceling the print dialog does not deduct stock', async () => {
            await harness.page.click('#btn-print-doc');
            await harness.page.waitForSelector('#invoice-barcode-update-modal', { state: 'visible' });
            await handleInvoiceBarcodeUpdateIfVisible(harness.page, 'skip');
            await harness.page.waitForSelector('#stock-deduction-modal', { state: 'visible' });
            await harness.page.click('#deduction-confirm-btn');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'visible' });
            await harness.page.click('#pd-cancel-btn');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'hidden' });

            const productRow = await waitForDbRow(
                harness.electronMain,
                'SELECT stock_qty FROM products WHERE barcode = ?',
                ['100100']
            );
            assert.equal(productRow.stock_qty, 8);
            await harness.assertNoFatalError();
        });

        await t.test('allows printing without deducting stock from the summary modal', async () => {
            const pdfPath = path.join(harness.profileDir, 'saved-output', 'invoice-print-only.pdf');
            fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
            harness.queueSaveDialog(pdfPath);

            await harness.page.click('#btn-print-doc');
            await harness.page.waitForSelector('#invoice-barcode-update-modal', { state: 'visible' });
            await handleInvoiceBarcodeUpdateIfVisible(harness.page, 'skip');
            await harness.page.waitForSelector('#stock-deduction-modal', { state: 'visible' });
            await harness.page.click('#deduction-print-only-btn');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'visible' });
            await waitForPreviewReady(harness.page);
            await waitForPreviewSheetCountAtLeast(harness.page, 1);

            await harness.page.click('#pd-print-btn');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'hidden' });

            assert.ok(await waitForFile(pdfPath), 'print-only flow should still save the pdf');
            const productRow = await waitForDbRow(
                harness.electronMain,
                'SELECT stock_qty FROM products WHERE barcode = ?',
                ['100100']
            );
            assert.equal(productRow.stock_qty, 8);
            await harness.assertNoFatalError();
        });

        await t.test('renders invoice print preview and saves a PDF through the headless bridge', async () => {
            const pdfPath = path.join(harness.profileDir, 'saved-output', 'invoice-preview.pdf');
            fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
            harness.queueSaveDialog(pdfPath);

            await harness.page.click('#btn-print-doc');
            await harness.page.waitForSelector('#invoice-barcode-update-modal', { state: 'visible' });
            await handleInvoiceBarcodeUpdateIfVisible(harness.page, 'skip');
            await harness.page.waitForSelector('#stock-deduction-modal', { state: 'visible' });
            await harness.page.click('#deduction-confirm-btn');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'visible' });
            await waitForPreviewReady(harness.page);
            await waitForPreviewSheetCountAtLeast(harness.page, 1);

            await harness.page.click('#pd-print-btn');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'hidden' });

            assert.ok(await waitForFile(pdfPath), 'pdf should be saved');
            assert.ok(fs.statSync(pdfPath).size > 1000, 'pdf should contain data');
            assert.ok(harness.printerJobs.some(job => job.type === 'pdf'));

            const productRow = await waitForDbRow(
                harness.electronMain,
                'SELECT stock_qty FROM products WHERE barcode = ?',
                ['100100']
            );
            assert.equal(productRow.stock_qty, 6);
            await harness.assertNoFatalError();
        });

        await t.test('links sale deductions to the saved invoice and shows them in stock history', async () => {
            const linkedMovement = await waitForDbRow(
                harness.electronMain,
                `SELECT sm.qty_change, sm.reason, sm.document_id, d.doc_number
                 FROM stock_movements sm
                 JOIN products p ON p.id = sm.product_id
                 LEFT JOIN documents d ON d.id = sm.document_id
                 WHERE p.barcode = ?
                 ORDER BY sm.id DESC
                 LIMIT 1`,
                ['100100']
            );

            assert.ok(linkedMovement, 'sale movement should exist for the printed invoice');
            assert.equal(linkedMovement.reason, 'sale');
            assert.equal(linkedMovement.qty_change, -2);
            assert.ok(linkedMovement.document_id, 'sale movement should be linked to a saved document');
            assert.ok(linkedMovement.doc_number, 'linked sale should expose a document number');

            await harness.page.click('.segment-btn[data-mode="stocks"]');
            await harness.page.waitForSelector('#panel-stocks.active');
            assert.ok(!/[Ãðâ]/.test(await harness.page.locator('#stocks-view-history').textContent()));
            await harness.page.fill('#stocks-search', '100100');
            await harness.page.waitForTimeout(150);
            await harness.page.check('#stocks-tbody tr:first-child .col-checkbox input');
            await harness.page.click('#stocks-view-history');
            await harness.page.waitForSelector('#stock-history-modal', { state: 'visible' });
            await harness.page.waitForFunction((docNumber) => {
                const rows = Array.from(document.querySelectorAll('#stock-history-list .stock-history-row'));
                return rows.some((row) => row.textContent.includes(`Sale from ${docNumber}`))
                    && rows.some((row) => row.textContent.includes(`invoice ${docNumber}`));
            }, linkedMovement.doc_number);

            const historyText = await harness.page.locator('#stock-history-list').textContent();
            assert.match(historyText, new RegExp(`Sale from ${linkedMovement.doc_number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
            assert.match(historyText, new RegExp(`invoice ${linkedMovement.doc_number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

            await harness.page.click('#stock-history-modal .modal-close');
            await harness.page.waitForSelector('#stock-history-modal', { state: 'hidden' });
            await harness.page.fill('#stocks-search', '');
            await harness.assertNoFatalError();
        });

        await t.test('recomposes invoice sheets for n-up, grayscale, and custom margin/scale settings', async () => {
            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'invoice');
            await harness.page.waitForTimeout(200);

            const pagToggle = harness.page.locator('#pagination-manual');
            if (!(await pagToggle.isChecked())) {
                await pagToggle.check();
            }

            await harness.page.evaluate(() => {
                Sell.setView('invoice');
                Invoice.setData({
                    ...Invoice.defaultInvoiceData(),
                    invoiceNumber: 'INV-PRINT-TEST',
                    billTo: { name: 'Composed Invoice' },
                    pages: [
                        {
                            items: [
                                { barcode: '', name_en: 'Item One', name_ar: '', weight: '1kg', unit_price_fils: 1500, qty: 2, product_by: 'Factory A' }
                            ]
                        },
                        {
                            items: [
                                { barcode: '', name_en: 'Item Two', name_ar: '', weight: '2kg', unit_price_fils: 2500, qty: 1, product_by: 'Factory B' }
                            ]
                        }
                    ]
                });
                Sell.render();
            });

            await harness.page.waitForFunction(() => document.querySelectorAll('#sell-workspace .inv-page').length === 2);
            await harness.page.click('#btn-print-doc');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'visible' });
            await waitForPreviewReady(harness.page);
            await waitForPreviewSheetCount(harness.page, 2);
            await ensureAdvancedPrintSettingsVisible(harness.page);

            await harness.page.selectOption('#pd-pages-per-sheet', '2');
            await harness.page.selectOption('#pd-color', 'bw');
            await harness.page.uncheck('#pd-background');
            await harness.page.selectOption('#pd-margins', 'custom');
            await fillAndBlur(harness.page, '#pd-margin-top', '12');
            await fillAndBlur(harness.page, '#pd-margin-bottom', '8');
            await fillAndBlur(harness.page, '#pd-margin-left', '6');
            await fillAndBlur(harness.page, '#pd-margin-right', '6');
            await harness.page.selectOption('#pd-scale', 'custom');
            await fillAndBlur(harness.page, '#pd-scale-custom', '80');

            await waitForPreviewSheetCount(harness.page, 1);

            const invoicePrintState = await harness.page.evaluate(() => {
                const firstLogicalPage = document.querySelector('#print-container .print-logical-page');
                const firstFrame = document.querySelector('#print-container .print-doc-frame');
                const previewDocument = document.getElementById('print-preview-frame')?.contentDocument;
                return {
                    sheetCount: document.querySelectorAll('#print-container .print-sheet').length,
                    cellContentCount: document.querySelectorAll('#print-container .print-sheet-cell-content').length,
                    activeLayout: document.getElementById('pd-layout')?.value,
                    frameClassName: firstFrame ? firstFrame.className : '',
                    logicalPageStyle: firstLogicalPage ? firstLogicalPage.getAttribute('style') : '',
                    previewSheetCount: previewDocument ? previewDocument.querySelectorAll('.print-sheet').length : 0
                };
            });

            assert.equal(invoicePrintState.activeLayout, 'portrait');
            assert.equal(invoicePrintState.sheetCount, 1);
            assert.equal(invoicePrintState.cellContentCount, 2);
            assert.equal(invoicePrintState.previewSheetCount, 1);
            assert.match(invoicePrintState.frameClassName, /print-doc-frame--grayscale/);
            assert.match(invoicePrintState.frameClassName, /print-doc-frame--no-backgrounds/);
            assert.match(invoicePrintState.logicalPageStyle, /--margin-top:12mm/);
            assert.match(invoicePrintState.logicalPageStyle, /--margin-bottom:8mm/);
            assert.match(invoicePrintState.logicalPageStyle, /--margin-left:6mm/);
            assert.match(invoicePrintState.logicalPageStyle, /--margin-right:6mm/);
            assert.match(invoicePrintState.logicalPageStyle, /--content-scale:0\.8/);

            await harness.page.click('#pd-cancel-btn');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'hidden' });
            await harness.assertNoFatalError();
        });

        await t.test('keeps preset controls hidden and preserves per-view print defaults', async () => {
            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'letterhead');
            await harness.page.waitForTimeout(200);

            await harness.page.evaluate(() => {
                Sell.setView('letterhead');
                Invoice.setLetterheadData({
                    ...Invoice.defaultLetterheadData(),
                    to: 'Preset Save Test',
                    pages: [{
                        items: [{
                            barcode: '',
                            name_en: 'Preset Saved Row',
                            name_ar: '',
                            weight: '1kg',
                            unit_price_fils: 1200,
                            qty: 1,
                            product_by: 'Preset Vendor'
                        }]
                    }]
                });
                Sell.render();
            });

            await harness.page.click('#btn-print-doc');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'visible' });
            await waitForPreviewReady(harness.page);
            await ensureAdvancedPrintSettingsVisible(harness.page);
            const restoredLetterheadPreset = await harness.page.evaluate(() => ({
                presetGroupHidden: document.querySelector('.print-preset-group')?.hidden === true,
                destination: document.getElementById('pd-destination')?.value || '',
                colorMode: document.getElementById('pd-color')?.value || '',
                pagesPerSheet: document.getElementById('pd-pages-per-sheet')?.value || '',
                marginsMode: document.getElementById('pd-margins')?.value || '',
                scaleMode: document.getElementById('pd-scale')?.value || '',
                copies: document.getElementById('pd-copies')?.value || '',
                layout: document.getElementById('pd-layout')?.value || ''
            }));

            assert.equal(restoredLetterheadPreset.presetGroupHidden, true);
            assert.equal(restoredLetterheadPreset.destination, 'pdf');
            assert.equal(restoredLetterheadPreset.colorMode, 'color');
            assert.equal(restoredLetterheadPreset.pagesPerSheet, '1');
            assert.equal(restoredLetterheadPreset.marginsMode, 'none');
            assert.equal(restoredLetterheadPreset.scaleMode, 'default');
            assert.equal(restoredLetterheadPreset.copies, '1');
            assert.equal(restoredLetterheadPreset.layout, 'landscape');

            await harness.page.click('#pd-cancel-btn');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'hidden' });

            await harness.page.selectOption('#sell-view-type', 'invoice');
            await harness.page.waitForTimeout(200);
            await seedInvoiceWorkspace(harness.page, {
                invoiceNumber: 'INV-PRESET',
                customerName: 'Preset Scope Customer',
                itemName: 'Scope Item',
                barcode: '',
                qty: 1,
                unitPriceFils: 1000
            });

            await harness.page.click('#btn-print-doc');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'visible' });
            await waitForPreviewReady(harness.page);

            const invoicePresetState = await harness.page.evaluate(() => ({
                presetGroupHidden: document.querySelector('.print-preset-group')?.hidden === true,
                destination: document.getElementById('pd-destination')?.value || '',
                marginsMode: document.getElementById('pd-margins')?.value || '',
                pagesPerSheet: document.getElementById('pd-pages-per-sheet')?.value || '',
                layout: document.getElementById('pd-layout')?.value || ''
            }));

            assert.equal(invoicePresetState.presetGroupHidden, true);
            assert.equal(invoicePresetState.destination, 'pdf');
            assert.equal(invoicePresetState.marginsMode, 'none');
            assert.equal(invoicePresetState.pagesPerSheet, '1');
            assert.equal(invoicePresetState.layout, 'portrait');

            await harness.page.click('#pd-cancel-btn');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'hidden' });
            await harness.assertNoFatalError();
        });

        await t.test('recomposes letterhead pages with repeated header/footer and landscape default', async () => {
            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'letterhead');
            await harness.page.waitForTimeout(200);

            await harness.page.evaluate(() => {
                Sell.setView('letterhead');
                Invoice.setLetterheadData({
                    ...Invoice.defaultLetterheadData(),
                    to: 'Letterhead Print Test',
                    area: 'Al Rai',
                    pages: [
                        {
                            items: Array.from({ length: 30 }, (_, index) => ({
                                barcode: '',
                                name_en: `Letterhead Item ${index + 1}`,
                                name_ar: '',
                                weight: '1kg',
                                unit_price_fils: 500,
                                qty: 1,
                                product_by: 'Vendor'
                            }))
                        }
                    ]
                });
                Sell.render();
            });

            await harness.page.click('#btn-print-doc');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'visible' });
            await ensureAdvancedPrintSettingsVisible(harness.page);
            await harness.page.selectOption('#pd-pages-select', 'all');
            await harness.page.selectOption('#pd-pages-per-sheet', '1');
            await harness.page.selectOption('#pd-color', 'color');
            await harness.page.check('#pd-background');
            await harness.page.selectOption('#pd-margins', 'default');
            await harness.page.selectOption('#pd-scale', 'default');
            await waitForPreviewReady(harness.page);
            await waitForPreviewSheetCountAtLeast(harness.page, 2);

            const initialLetterheadState = await harness.page.evaluate(() => ({
                activeLayout: document.getElementById('pd-layout')?.value,
                logicalPages: document.querySelectorAll('#print-container .print-logical-page').length,
                headers: document.querySelectorAll('#print-container .lh-header-manual').length,
                footers: document.querySelectorAll('#print-container .lh-footer').length,
                sheets: document.querySelectorAll('#print-container .print-sheet').length,
                headerText: Array.from(document.querySelectorAll('#print-container .lh-table thead th'))
                    .map((th) => th.textContent.replace(/\s+/g, ' ').trim())
                    .join(' | ')
            }));

            assert.equal(initialLetterheadState.activeLayout, 'landscape');
            assert.ok(initialLetterheadState.logicalPages >= 2, 'letterhead should paginate to multiple logical pages');
            assert.equal(initialLetterheadState.headers, initialLetterheadState.logicalPages);
            assert.equal(initialLetterheadState.footers, initialLetterheadState.logicalPages);
            assert.equal(initialLetterheadState.sheets, initialLetterheadState.logicalPages);
            assert.match(initialLetterheadState.headerText, /Barcode/);
            assert.match(initialLetterheadState.headerText, /Product By/);
            assert.match(initialLetterheadState.headerText, /\bName\b/);
            assert.match(initialLetterheadState.headerText, /Qty\./);
            assert.match(initialLetterheadState.headerText, /S\.\s*no/i);

            await harness.page.selectOption('#pd-pages-select', 'custom');
            await fillAndBlur(harness.page, '#pd-pages-custom', '2');
            await waitForPreviewSheetCount(harness.page, 1);

            const filteredLetterheadState = await harness.page.evaluate(() => ({
                logicalPages: document.querySelectorAll('#print-container .print-logical-page').length,
                headers: document.querySelectorAll('#print-container .lh-header-manual').length,
                footers: document.querySelectorAll('#print-container .lh-footer').length,
                sheets: document.querySelectorAll('#print-container .print-sheet').length,
                previewSheetCount: document.getElementById('print-preview-frame')?.contentDocument?.querySelectorAll('.print-sheet').length || 0
            }));

            assert.equal(filteredLetterheadState.logicalPages, 1);
            assert.equal(filteredLetterheadState.headers, 1);
            assert.equal(filteredLetterheadState.footers, 1);
            assert.equal(filteredLetterheadState.sheets, 1);
            assert.equal(filteredLetterheadState.previewSheetCount, 1);

            await harness.page.click('#pd-cancel-btn');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'hidden' });
            await harness.assertNoFatalError();
        });

        await t.test('uses live letterhead pages for preview, including added pages and page-specific edits', async () => {
            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'letterhead');
            await harness.page.waitForTimeout(200);

            await harness.page.evaluate(() => {
                Sell.setView('letterhead');
                Invoice.setLetterheadData({
                    ...Invoice.defaultLetterheadData(),
                    to: 'Live Letterhead Test',
                    pages: [
                        {
                            items: Array.from({ length: 11 }, (_, index) => ({
                                barcode: '',
                                name_en: `Letterhead Seed ${index + 1}`,
                                name_ar: '',
                                weight: '1kg',
                                unit_price_fils: 500,
                                qty: 1,
                                product_by: 'Vendor'
                            }))
                        }
                    ]
                });
                Sell.render();
                Invoice.addPage('letterhead');
                Invoice.getLetterheadData().pages[1].items.push({
                    barcode: '',
                    name_en: 'Second Page Original',
                    name_ar: '',
                    weight: '2kg',
                    unit_price_fils: 900,
                    qty: 3,
                    product_by: 'Vendor Two'
                });
                Sell.render();

                const pages = Array.from(document.querySelectorAll('#sell-workspace .inv-page'));
                const secondPageName = pages[1]?.querySelector('[data-field="name_en"]');
                if (secondPageName) {
                    secondPageName.textContent = 'Second Page Edited';
                    secondPageName.dispatchEvent(new Event('input', { bubbles: true }));
                    secondPageName.dispatchEvent(new Event('blur', { bubbles: true }));
                }
            });

            await harness.page.waitForFunction(() => document.querySelectorAll('#sell-workspace .inv-page').length === 2);
            await harness.page.click('#btn-print-doc');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'visible' });
            await waitForPreviewReady(harness.page);
            await waitForPreviewSheetCount(harness.page, 2);

            const pdfPath = path.join(harness.profileDir, 'saved-output', 'live-letterhead.pdf');
            fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
            harness.queueSaveDialog(pdfPath);

            const liveLetterheadState = await harness.page.evaluate(() => {
                const previewDocument = document.getElementById('print-preview-frame')?.contentDocument;
                return {
                    logicalPages: document.querySelectorAll('#print-container .print-logical-page').length,
                    previewHasEditedText: previewDocument?.body?.textContent?.includes('Second Page Edited') || false,
                    printContainerHasEditedText: document.getElementById('print-container')?.textContent?.includes('Second Page Edited') || false
                };
            });

            assert.equal(liveLetterheadState.logicalPages, 2);
            assert.equal(liveLetterheadState.previewHasEditedText, true);
            assert.equal(liveLetterheadState.printContainerHasEditedText, true);

            await harness.page.click('#pd-print-btn');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'hidden' });
            assert.ok(await waitForFile(pdfPath), 'live letterhead pdf should be saved');

            const pdfState = await inspectPdf(pdfPath);
            assert.equal(pdfState.pageCount, 2);
            assert.match(pdfState.text, /Second Page Edited/);

            await harness.assertNoFatalError();
        });

        await t.test('preserves live form values across all preview pages', async () => {
            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'invoice');
            await harness.page.waitForTimeout(200);

            const pagToggle = harness.page.locator('#pagination-manual');
            if (!(await pagToggle.isChecked())) {
                await pagToggle.check();
            }

            await harness.page.evaluate(() => {
                Sell.setView('invoice');
                Invoice.setData({
                    ...Invoice.defaultInvoiceData(),
                    invoiceNumber: 'INV-LIVE-PREVIEW',
                    billTo: { name: 'Preview Clone Test' },
                    pages: Array.from({ length: 4 }, (_, index) => ({
                        items: [
                            {
                                barcode: '',
                                name_en: `Preview Item ${index + 1}`,
                                name_ar: '',
                                weight: '1kg',
                                unit_price_fils: 1000 + index,
                                qty: 1,
                                product_by: 'Preview Factory'
                            }
                        ]
                    }))
                });
                Sell.render();

                const pages = Array.from(document.querySelectorAll('#sell-workspace .inv-page'));
                pages.forEach((page, index) => {
                    const host = document.createElement('div');
                    host.className = 'preview-live-probe';
                    host.innerHTML = `
                        <input type="text" data-preview-probe="input">
                        <textarea data-preview-probe="textarea"></textarea>
                        <select data-preview-probe="select">
                            <option value="a">A</option>
                            <option value="b">B</option>
                        </select>
                        <input type="checkbox" data-preview-probe="checkbox">
                    `;

                    page.appendChild(host);

                    const input = host.querySelector('[data-preview-probe="input"]');
                    const textarea = host.querySelector('[data-preview-probe="textarea"]');
                    const select = host.querySelector('[data-preview-probe="select"]');
                    const checkbox = host.querySelector('[data-preview-probe="checkbox"]');

                    input.value = `Live input ${index + 1}`;
                    textarea.value = `Live notes ${index + 1}`;
                    select.value = index === 3 ? 'b' : 'a';
                    checkbox.checked = index === 3;
                });
            });

            await harness.page.waitForFunction(() => document.querySelectorAll('#sell-workspace .inv-page').length === 4);
            await harness.page.click('#btn-print-doc');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'visible' });
            await waitForPreviewReady(harness.page);
            await waitForPreviewSheetCount(harness.page, 4);

            const previewState = await harness.page.evaluate(() => {
                const doc = document.getElementById('print-preview-frame')?.contentDocument;
                const sheets = doc ? Array.from(doc.querySelectorAll('.print-sheet')) : [];
                const fourthSheet = sheets[3];
                const input = fourthSheet?.querySelector('[data-preview-probe="input"]');
                const textarea = fourthSheet?.querySelector('[data-preview-probe="textarea"]');
                const select = fourthSheet?.querySelector('[data-preview-probe="select"]');
                const checkbox = fourthSheet?.querySelector('[data-preview-probe="checkbox"]');

                return {
                    sheetCount: sheets.length,
                    pageFourInputAttr: input?.getAttribute('value') || '',
                    pageFourInputValue: input?.value || '',
                    pageFourTextareaAttr: textarea?.getAttribute('value') || '',
                    pageFourTextareaText: textarea?.textContent || '',
                    pageFourTextareaValue: textarea?.value || '',
                    pageFourSelectAttr: select?.getAttribute('value') || '',
                    pageFourSelectValue: select?.value || '',
                    pageFourSelectedOption: select?.querySelector('option[selected]')?.value || '',
                    pageFourCheckboxAttr: checkbox?.getAttribute('checked') || '',
                    pageFourCheckboxValue: !!checkbox?.checked
                };
            });

            assert.equal(previewState.sheetCount, 4);
            assert.equal(previewState.pageFourInputAttr, 'Live input 4');
            assert.equal(previewState.pageFourInputValue, 'Live input 4');
            assert.equal(previewState.pageFourTextareaAttr, 'Live notes 4');
            assert.equal(previewState.pageFourTextareaText, 'Live notes 4');
            assert.equal(previewState.pageFourTextareaValue, 'Live notes 4');
            assert.equal(previewState.pageFourSelectAttr, 'b');
            assert.equal(previewState.pageFourSelectValue, 'b');
            assert.equal(previewState.pageFourSelectedOption, 'b');
            assert.equal(previewState.pageFourCheckboxAttr, 'checked');
            assert.equal(previewState.pageFourCheckboxValue, true);

            await harness.page.click('#pd-cancel-btn');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'hidden' });
            await harness.assertNoFatalError();
        });

        await t.test('keeps add-page actions blank and removes duplicate controls from the thumbnail strip', async () => {
            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'letterhead');
            await harness.page.waitForTimeout(200);

            await harness.page.evaluate(() => {
                Sell.setView('letterhead');
                Invoice.setLetterheadData({
                    ...Invoice.defaultLetterheadData(),
                    to: 'Primary Customer',
                    area: 'Main Area',
                    pages: [{
                        items: [{
                            barcode: 'L-001',
                            name_en: 'Header Seed',
                            name_ar: '',
                            weight: '1kg',
                            unit_price_fils: 500,
                            qty: 1,
                            product_by: 'Vendor'
                        }]
                    }]
                });
                Sell.render();
            });

            await choosePageAction(harness.page, 'add');
            await harness.page.waitForFunction(() => document.querySelectorAll('#sell-workspace .inv-page').length === 2);

            const blankPageState = await harness.page.evaluate(() => {
                const secondPage = document.querySelector('#sell-workspace .inv-page[data-page="2"]');
                return {
                    pageCount: document.querySelectorAll('#sell-workspace .inv-page').length,
                    secondPageTo: secondPage?.querySelector('[data-field="to"]')?.textContent?.trim() || '',
                    secondPageRows: secondPage?.querySelectorAll('tr[data-index]').length || 0
                };
            });

            assert.equal(blankPageState.pageCount, 2);
            assert.equal(blankPageState.secondPageTo, '');
            assert.equal(blankPageState.secondPageRows, 0);

            const thumbnailUiState = await harness.page.evaluate(() => ({
                pageThumbActionBlocks: document.querySelectorAll('.page-thumb-actions').length,
                addThumbVisible: !!document.querySelector('.add-page-thumb'),
                pageActionLabel: document.querySelector('#btn-add-page .btn-text')?.textContent?.trim() || ''
            }));
            assert.equal(thumbnailUiState.pageThumbActionBlocks, 0);
            assert.equal(thumbnailUiState.addThumbVisible, true);
            assert.match(thumbnailUiState.pageActionLabel, /^Pages - P\d+$/);

            await harness.page.click('.add-page-thumb');
            await harness.page.waitForFunction(() => document.querySelectorAll('#sell-workspace .inv-page').length === 3);

            const appendedBlankPageState = await harness.page.evaluate(() => {
                const thirdPage = document.querySelector('#sell-workspace .inv-page[data-page="3"]');
                return {
                    thirdPageTo: thirdPage?.querySelector('[data-field="to"]')?.textContent?.trim() || '',
                    thirdPageRows: thirdPage?.querySelectorAll('tr[data-index]').length || 0
                };
            });

            assert.equal(appendedBlankPageState.thirdPageTo, '');
            assert.equal(appendedBlankPageState.thirdPageRows, 0);

            await harness.page.click('.page-thumb[data-page-index="0"]');
            await choosePageAction(harness.page, 'duplicate');
            await harness.page.waitForFunction(() => document.querySelectorAll('#sell-workspace .inv-page').length === 4);

            const duplicateState = await harness.page.evaluate(() => {
                const duplicatePage = document.querySelector('#sell-workspace .inv-page[data-page="2"]');
                const blankPage = document.querySelector('#sell-workspace .inv-page[data-page="4"]');
                return {
                    duplicateTo: duplicatePage?.querySelector('[data-field="to"]')?.textContent?.trim() || '',
                    duplicateRows: duplicatePage?.querySelectorAll('tr[data-index]').length || 0,
                    blankRows: blankPage?.querySelectorAll('tr[data-index]').length || 0
                };
            });

            assert.equal(duplicateState.duplicateTo, 'Primary Customer');
            assert.equal(duplicateState.duplicateRows, 1);
            assert.equal(duplicateState.blankRows, 0);
            await harness.assertNoFatalError();
        });

        await t.test('preserves edited table data on existing pages when appending new blank pages', async () => {
            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'letterhead');
            await harness.page.waitForTimeout(200);

            await harness.page.evaluate(() => {
                Sell.setView('letterhead');
                Invoice.setLetterheadData({
                    ...Invoice.defaultLetterheadData(),
                    to: 'Append Blank Test',
                    pages: [{ items: [] }]
                });
                Sell.render();

                const firstPageRow = document.querySelector('#sell-workspace .inv-page[data-page="1"] [data-field="name_en"]');
                if (firstPageRow) {
                    firstPageRow.textContent = 'Letterhead Row 1';
                    firstPageRow.dispatchEvent(new Event('input', { bubbles: true }));
                    firstPageRow.dispatchEvent(new Event('blur', { bubbles: true }));
                }
            });

            await choosePageAction(harness.page, 'add');
            await harness.page.waitForFunction(() => document.querySelectorAll('#sell-workspace .inv-page').length === 2);

            const afterSecondPage = await harness.page.evaluate(() => {
                const firstPage = document.querySelector('#sell-workspace .inv-page[data-page="1"]');
                const secondPage = document.querySelector('#sell-workspace .inv-page[data-page="2"]');
                return {
                    firstPageName: firstPage?.querySelector('[data-field="name_en"]')?.textContent?.trim() || '',
                    secondPageName: secondPage?.querySelector('[data-field="name_en"]')?.textContent?.trim() || ''
                };
            });

            assert.equal(afterSecondPage.firstPageName, 'Letterhead Row 1');
            assert.equal(afterSecondPage.secondPageName, '');

            await harness.page.evaluate(() => {
                const secondPageRow = document.querySelector('#sell-workspace .inv-page[data-page="2"] [data-field="name_en"]');
                if (secondPageRow) {
                    secondPageRow.textContent = 'Letterhead Row 2';
                    secondPageRow.dispatchEvent(new Event('input', { bubbles: true }));
                    secondPageRow.dispatchEvent(new Event('blur', { bubbles: true }));
                }
            });

            await choosePageAction(harness.page, 'add');
            await harness.page.waitForFunction(() => document.querySelectorAll('#sell-workspace .inv-page').length === 3);

            const afterThirdPage = await harness.page.evaluate(() => {
                const firstPage = document.querySelector('#sell-workspace .inv-page[data-page="1"]');
                const secondPage = document.querySelector('#sell-workspace .inv-page[data-page="2"]');
                const thirdPage = document.querySelector('#sell-workspace .inv-page[data-page="3"]');
                return {
                    firstPageName: firstPage?.querySelector('[data-field="name_en"]')?.textContent?.trim() || '',
                    secondPageName: secondPage?.querySelector('[data-field="name_en"]')?.textContent?.trim() || '',
                    thirdPageName: thirdPage?.querySelector('[data-field="name_en"]')?.textContent?.trim() || ''
                };
            });

            assert.equal(afterThirdPage.firstPageName, 'Letterhead Row 1');
            assert.equal(afterThirdPage.secondPageName, 'Letterhead Row 2');
            assert.equal(afterThirdPage.thirdPageName, '');

            await harness.page.selectOption('#sell-view-type', 'invoice');
            await harness.page.waitForTimeout(200);
            await harness.page.evaluate(() => {
                Sell.setView('invoice');
                Invoice.setData({
                    ...Invoice.defaultInvoiceData(),
                    invoiceNumber: 'INV-APPEND-BLANK',
                    pages: [{ items: [] }]
                });
                Sell.render();

                const firstInvoiceRow = document.querySelector('#sell-workspace .inv-page[data-page="1"] [data-field="name_en"]');
                if (firstInvoiceRow) {
                    firstInvoiceRow.textContent = 'Invoice Row 1';
                    firstInvoiceRow.dispatchEvent(new Event('input', { bubbles: true }));
                    firstInvoiceRow.dispatchEvent(new Event('blur', { bubbles: true }));
                }
            });

            await choosePageAction(harness.page, 'add');
            await harness.page.waitForFunction(() => document.querySelectorAll('#sell-workspace .inv-page').length === 2);

            const invoiceState = await harness.page.evaluate(() => {
                const firstPage = document.querySelector('#sell-workspace .inv-page[data-page="1"]');
                const secondPage = document.querySelector('#sell-workspace .inv-page[data-page="2"]');
                return {
                    firstPageName: firstPage?.querySelector('[data-field="name_en"]')?.textContent?.trim() || '',
                    secondPageName: secondPage?.querySelector('[data-field="name_en"]')?.textContent?.trim() || ''
                };
            });

            assert.equal(invoiceState.firstPageName, 'Invoice Row 1');
            assert.equal(invoiceState.secondPageName, '');
            await harness.assertNoFatalError();
        });

        await t.test('keeps partial blank-page edits free of auto FILS and zero totals after rerender', async () => {
            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'invoice');
            await harness.page.waitForTimeout(200);

            await harness.page.evaluate(() => {
                Sell.setView('invoice');
                Invoice.setData({
                    ...Invoice.defaultInvoiceData(),
                    invoiceNumber: 'INV-PARTIAL-BLANK',
                    pages: [{ items: [] }]
                });
                Sell.render();
            });

            await choosePageAction(harness.page, 'add');
            await harness.page.waitForFunction(() => document.querySelectorAll('#sell-workspace .inv-page').length === 2);
            await harness.page.evaluate(() => {
                const row = document.querySelector('#sell-workspace .inv-page[data-page="2"] [data-field="name_en"]');
                if (row) {
                    row.textContent = 'Partial Invoice Item';
                    row.dispatchEvent(new Event('input', { bubbles: true }));
                    row.dispatchEvent(new Event('blur', { bubbles: true }));
                }
            });

            await choosePageAction(harness.page, 'add');
            await harness.page.waitForFunction(() => document.querySelectorAll('#sell-workspace .inv-page').length === 3);

            const invoicePartialState = await harness.page.evaluate(() => {
                const partialPage = document.querySelector('#sell-workspace .inv-page[data-page="2"]');
                const firstRow = partialPage?.querySelector('.inv-table tbody tr');
                return {
                    name: firstRow?.querySelector('[data-field="name_en"]')?.textContent?.trim() || '',
                    unitPrice: firstRow?.querySelector('[data-field="unit_price"]')?.textContent?.trim() || '',
                    total: firstRow?.querySelector('[data-field="total"]')?.textContent?.trim() || '',
                    subtotal: partialPage?.querySelector('[data-field="page-subtotal"]')?.textContent?.trim() || '',
                    words: partialPage?.querySelector('.inv-aw-text')?.textContent?.trim() || ''
                };
            });

            assert.equal(invoicePartialState.name, 'Partial Invoice Item');
            assert.equal(invoicePartialState.unitPrice, '');
            assert.equal(invoicePartialState.total, '');
            assert.equal(invoicePartialState.subtotal, '');
            assert.equal(invoicePartialState.words, '');

            await harness.page.selectOption('#sell-view-type', 'letterhead');
            await harness.page.waitForTimeout(200);
            await harness.page.evaluate(() => {
                Sell.setView('letterhead');
                Invoice.setLetterheadData({
                    ...Invoice.defaultLetterheadData(),
                    to: 'Partial Letterhead',
                    pages: [{ items: [] }]
                });
                Sell.render();
            });

            await choosePageAction(harness.page, 'add');
            await harness.page.waitForFunction(() => document.querySelectorAll('#sell-workspace .inv-page').length === 2);
            await harness.page.evaluate(() => {
                const row = document.querySelector('#sell-workspace .inv-page[data-page="2"] [data-field="name_en"]');
                if (row) {
                    row.textContent = 'Partial Letterhead Item';
                    row.dispatchEvent(new Event('input', { bubbles: true }));
                    row.dispatchEvent(new Event('blur', { bubbles: true }));
                }
            });

            await choosePageAction(harness.page, 'add');
            await harness.page.waitForFunction(() => document.querySelectorAll('#sell-workspace .inv-page').length === 3);

            const letterheadPartialState = await harness.page.evaluate(() => {
                const partialPage = document.querySelector('#sell-workspace .inv-page[data-page="2"]');
                const firstRow = partialPage?.querySelector('.inv-table tbody tr');
                return {
                    name: firstRow?.querySelector('[data-field="name_en"]')?.textContent?.trim() || '',
                    unitPrice: firstRow?.querySelector('[data-field="unit_price"]')?.textContent?.trim() || '',
                    total: firstRow?.querySelector('[data-field="total"]')?.textContent?.trim() || ''
                };
            });

            assert.equal(letterheadPartialState.name, 'Partial Letterhead Item');
            assert.equal(letterheadPartialState.unitPrice, '');
            assert.equal(letterheadPartialState.total, '');
            await harness.assertNoFatalError();
        });

        await t.test('persists letterhead share contacts and opens Gmail drafts from read-only documents', async () => {
            await harness.page.evaluate(() => Persistence.setSetting('remembered_session', 'true'));
            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'letterhead');
            await harness.page.waitForTimeout(200);

            await seedLetterheadWorkspace(harness.page, {
                addressee: 'Share Customer',
                itemName: 'Share Item',
                barcode: 'LH-SHARE-1',
                unitPriceFils: 750,
                qty: 2,
                productBy: 'Share Vendor'
            });

            await openShareMenu(harness.page);
            await fillAndBlur(harness.page, '#sell-share-email', 'buyer@example.com');
            await fillAndBlur(harness.page, '#sell-share-whatsapp', '99887766');

            const draftValue = await waitForSettingValue(
                harness.electronMain,
                'draft_letterhead',
                (value) => {
                    try {
                        const parsed = JSON.parse(value);
                        return parsed?.payload?.shareContact?.email === 'buyer@example.com'
                            && parsed?.payload?.shareContact?.whatsapp === '99887766';
                    } catch (_) {
                        return false;
                    }
                }
            );

            assert.ok(draftValue, 'letterhead share contacts should persist in drafts');

            await harness.page.reload({ waitUntil: 'domcontentloaded' });
            await harness.page.waitForFunction(() => {
                const overlay = document.getElementById('login-overlay');
                const app = document.getElementById('app-container');
                return overlay && app && overlay.style.display === 'none' && app.style.display === 'flex';
            });
            await harness.page.waitForSelector('#draft-recovery-modal', { state: 'visible' });
            await harness.page.click('[data-draft-recover="letterhead"]');
            await harness.page.waitForSelector('#draft-recovery-modal', { state: 'hidden' });

            await openShareMenu(harness.page);
            assert.equal(await harness.page.locator('#sell-share-email').inputValue(), 'buyer@example.com');
            assert.equal(await harness.page.locator('#sell-share-whatsapp').inputValue(), '99887766');

            await harness.page.evaluate(async () => {
                await Sell.saveDocument({ docNumber: 'SHARE-LH' });
            });

            const savedRecord = await waitForDbRow(
                harness.electronMain,
                'SELECT id, payload FROM documents WHERE doc_number = ?',
                ['SHARE-LH']
            );

            assert.ok(savedRecord, 'saved letterhead should exist');
            assert.equal(JSON.parse(savedRecord.payload).shareContact.email, 'buyer@example.com');
            assert.equal(JSON.parse(savedRecord.payload).shareContact.whatsapp, '99887766');

            await harness.page.click('#btn-load-template');
            await harness.page.waitForSelector('#template-modal', { state: 'visible' });
            await openHistoryShareMenu(harness.page, savedRecord.id);
            assert.equal(await harness.page.locator(`[data-history-share-email="${savedRecord.id}"]`).inputValue(), 'buyer@example.com');
            await fillAndBlur(harness.page, `[data-history-share-email="${savedRecord.id}"]`, 'historybuyer@example.com');
            const historyActionStart = harness.externalActions.length;
            await harness.page.click(`[data-history-share-action="${savedRecord.id}"][data-history-share-channel="gmail"]`);
            assert.ok(await waitForExternalActions(harness, historyActionStart + 2), 'history gmail share should open external actions');
            const historyShareActions = harness.externalActions.slice(historyActionStart);
            assert.equal(historyShareActions[0].type, 'showItemInFolder');
            assert.equal(historyShareActions[1].type, 'openExternal');
            assert.match(historyShareActions[1].url, /^https:\/\/mail\.google\.com\/mail\/\?/);
            assert.match(historyShareActions[1].url, /to=historybuyer%40example\.com/);
            assert.ok(await waitForFile(historyShareActions[0].filePath), 'history gmail share PDF should be created');
            await harness.page.click('#template-modal .modal-close');
            await harness.page.waitForSelector('#template-modal', { state: 'hidden' });

            await harness.page.evaluate(async () => {
                await Sell.newDocument({ discardUnsaved: true });
            });
            await harness.page.evaluate((id) => Sell.openSavedDocumentById(id), savedRecord.id);
            await openShareMenu(harness.page);

            assert.equal(await harness.page.locator('#sell-share-email').inputValue(), 'buyer@example.com');
            assert.equal(await harness.page.locator('#sell-share-whatsapp').inputValue(), '99887766');
            assert.equal(await harness.page.locator('#sell-share-email').isEditable(), true);
            await fillAndBlur(harness.page, '#sell-share-email', 'overridebuyer@example.com');

            const actionStart = harness.externalActions.length;
            await harness.page.click('#btn-share-gmail');
            assert.ok(await waitForExternalActions(harness, actionStart + 2), 'gmail share should open external actions');

            const shareActions = harness.externalActions.slice(actionStart);
            assert.equal(shareActions[0].type, 'showItemInFolder');
            assert.equal(shareActions[1].type, 'openExternal');
            assert.match(shareActions[1].url, /^https:\/\/mail\.google\.com\/mail\/\?/);
            assert.match(shareActions[1].url, /to=overridebuyer%40example\.com/);
            assert.match(shareActions[1].url, /su=Rapid\+Order\+Sheet\+-\+Share\+Customer/);

            assert.ok(await waitForFile(shareActions[0].filePath), 'share PDF should be created');
            const sharedPdf = await inspectPdf(shareActions[0].filePath, harness.projectRoot);
            assert.match(sharedPdf.text, /Share Customer/);
            assert.match(sharedPdf.text, /Share Item/);
            const persistedRapidSheet = await waitForDbRow(
                harness.electronMain,
                'SELECT payload FROM documents WHERE id = ?',
                [savedRecord.id]
            );
            assert.equal(JSON.parse(persistedRapidSheet.payload).shareContact.email, 'buyer@example.com');
            await harness.assertNoFatalError();
        });

        await t.test('restores invoice share contacts, uses WhatsApp fallback, and avoids save side effects', async () => {
            await harness.page.evaluate(() => Persistence.setSetting('remembered_session', 'true'));
            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'invoice');
            await harness.page.waitForTimeout(200);

            await seedInvoiceWorkspace(harness.page, {
                invoiceNumber: 'INV-SHARE-001',
                customerName: 'Share Invoice Customer',
                itemName: 'Invoice Share Item',
                barcode: 'INV-SHARE-1',
                unitPriceFils: 1200,
                qty: 1,
                productBy: 'Share Vendor'
            });

            await openShareMenu(harness.page);
            await fillAndBlur(harness.page, '#sell-share-email', 'invoice@example.com');
            await fillAndBlur(harness.page, '#sell-share-whatsapp', '99887766');

            const invoiceDraft = await waitForSettingValue(
                harness.electronMain,
                'draft_invoice',
                (value) => {
                    try {
                        const parsed = JSON.parse(value);
                        return parsed?.payload?.shareContact?.email === 'invoice@example.com'
                            && parsed?.payload?.shareContact?.whatsapp === '99887766';
                    } catch (_) {
                        return false;
                    }
                }
            );

            assert.ok(invoiceDraft, 'invoice share contacts should persist in drafts');

            await harness.page.reload({ waitUntil: 'domcontentloaded' });
            await harness.page.waitForFunction(() => {
                const overlay = document.getElementById('login-overlay');
                const app = document.getElementById('app-container');
                return overlay && app && overlay.style.display === 'none' && app.style.display === 'flex';
            });
            await harness.page.waitForSelector('#draft-recovery-modal', { state: 'visible' });
            await harness.page.click('[data-draft-recover="invoice"]');
            await harness.page.waitForSelector('#draft-recovery-modal', { state: 'hidden' });

            await openShareMenu(harness.page);
            assert.equal(await harness.page.locator('#sell-share-email').inputValue(), 'invoice@example.com');
            assert.equal(await harness.page.locator('#sell-share-whatsapp').inputValue(), '99887766');

            await harness.page.evaluate(async () => {
                await Sell.saveDocument({ docNumber: 'INV-SHARE-001' });
            });

            const savedInvoice = await waitForDbRow(
                harness.electronMain,
                'SELECT id, payload FROM documents WHERE doc_number = ?',
                ['INV-SHARE-001']
            );

            assert.ok(savedInvoice, 'saved invoice should exist');
            assert.equal(JSON.parse(savedInvoice.payload).shareContact.email, 'invoice@example.com');
            assert.equal(JSON.parse(savedInvoice.payload).shareContact.whatsapp, '99887766');

            await harness.page.click('#btn-load-template');
            await harness.page.waitForSelector('#template-modal', { state: 'visible' });
            await openHistoryShareMenu(harness.page, savedInvoice.id);
            await fillAndBlur(harness.page, `[data-history-share-whatsapp="${savedInvoice.id}"]`, '12345678');
            const historyActionStart = harness.externalActions.length;
            await harness.page.click(`[data-history-share-action="${savedInvoice.id}"][data-history-share-channel="whatsapp"]`);
            assert.ok(await waitForExternalActions(harness, historyActionStart + 2), 'history whatsapp share should open external actions');
            const historyShareActions = harness.externalActions.slice(historyActionStart);
            assert.equal(historyShareActions[0].type, 'showItemInFolder');
            assert.equal(historyShareActions[1].type, 'openExternal');
            assert.match(historyShareActions[1].url, /^https:\/\/wa\.me\/96512345678\?/);
            await harness.page.click('#template-modal .modal-close');
            await harness.page.waitForSelector('#template-modal', { state: 'hidden' });

            await harness.page.evaluate(async () => {
                await Sell.newDocument({ discardUnsaved: true });
            });
            await harness.page.evaluate((id) => Sell.openSavedDocumentById(id), savedInvoice.id);
            await openShareMenu(harness.page);
            assert.equal(await harness.page.locator('#sell-share-email').inputValue(), 'invoice@example.com');
            assert.equal(await harness.page.locator('#sell-share-email').isEditable(), true);

            await seedInvoiceWorkspace(harness.page, {
                invoiceNumber: 'INV-SHARE-FALLBACK',
                customerName: 'Fallback Customer',
                itemName: 'WhatsApp Item',
                barcode: 'INV-SHARE-2',
                unitPriceFils: 900,
                qty: 2,
                productBy: 'Fallback Vendor'
            });

            await harness.page.evaluate(() => {
                const data = Invoice.getData();
                data.billTo = {
                    ...data.billTo,
                    phone: '12345678'
                };
                data.shareContact = {
                    ...data.shareContact,
                    email: '',
                    whatsapp: ''
                };
                Sell.render();
            });

            const beforeShareCount = await harness.electronMain.invoke(
                'db-get',
                'SELECT COUNT(*) AS count FROM documents WHERE doc_number = ?',
                ['INV-SHARE-FALLBACK']
            );
            const actionStart = harness.externalActions.length;
            await openShareMenu(harness.page);
            await harness.page.evaluate(() => document.getElementById('btn-share-whatsapp')?.click());
            assert.ok(await waitForExternalActions(harness, actionStart + 2), 'whatsapp share should open external actions');

            const shareActions = harness.externalActions.slice(actionStart);
            assert.equal(shareActions[0].type, 'showItemInFolder');
            assert.equal(shareActions[1].type, 'openExternal');
            assert.match(shareActions[1].url, /^https:\/\/wa\.me\/96512345678\?/);
            assert.ok(await waitForFile(shareActions[0].filePath), 'whatsapp share PDF should be created');

            const afterShareCount = await harness.electronMain.invoke(
                'db-get',
                'SELECT COUNT(*) AS count FROM documents WHERE doc_number = ?',
                ['INV-SHARE-FALLBACK']
            );
            assert.equal(afterShareCount.data.count, beforeShareCount.data.count, 'share should not create saved invoices');

            const invoicePdf = await inspectPdf(shareActions[0].filePath, harness.projectRoot);
            assert.match(invoicePdf.text, /INV-SHARE-FALLBACK/);
            assert.match(invoicePdf.text, /WhatsApp Item/);

            await openShareMenu(harness.page);
            const cachedActionStart = harness.externalActions.length;
            await harness.page.evaluate(() => document.getElementById('btn-share-whatsapp')?.click());
            assert.ok(await waitForExternalActions(harness, cachedActionStart + 2), 'repeated whatsapp share should open external actions');
            const cachedShareActions = harness.externalActions.slice(cachedActionStart);
            assert.equal(cachedShareActions[0].type, 'showItemInFolder');
            assert.equal(cachedShareActions[1].type, 'openExternal');
            assert.equal(cachedShareActions[0].filePath, shareActions[0].filePath, 'share PDF should be reused while content is unchanged');

            await openShareMenu(harness.page);
            await fillAndBlur(harness.page, '#sell-share-whatsapp', '12A34');
            const invalidActionCount = harness.externalActions.length;
            await harness.page.evaluate(() => document.getElementById('btn-share-whatsapp')?.click());
            await harness.page.waitForTimeout(300);
            assert.equal(harness.externalActions.length, invalidActionCount, 'invalid explicit numbers should not open external targets');
            await harness.page.waitForFunction(() => {
                return Array.from(document.querySelectorAll('body div'))
                    .some((node) => (node.textContent || '').includes('Enter a valid WhatsApp number'));
            });
            await harness.assertNoFatalError();
        });

        await t.test('splits barcode library saves from product creation and exercises direct print flow', async () => {
            const printJobsBefore = harness.printerJobs.length;

            await harness.page.click('.segment-btn[data-mode="barcode"]');
            await harness.page.waitForSelector('#panel-barcode.active');
            await harness.page.click('#barcode-gen-btn');
            await fillAndBlur(harness.page, '#bc-new-barcode-num', '777000111');
            await fillAndBlur(harness.page, '#bc-new-name-en', 'Sample Label');
            await fillAndBlur(harness.page, '#bc-new-weight', '250g');
            await fillAndBlur(harness.page, '#bc-new-unitprice', '0.450');
            await fillAndBlur(harness.page, '#bc-new-productby', 'Label Vendor');
            await harness.page.click('#bc-generate-btn');

            await harness.page.waitForFunction(() => {
                return BarcodeGen.getGenerated().some((entry) => entry.barcodeNumber === '777000111');
            });
            const libraryOnlyProduct = await waitForDbRow(
                harness.electronMain,
                'SELECT barcode, name_en, weight, unit_price_fils, product_by FROM products WHERE barcode = ?',
                ['777000111']
            );

            assert.equal(libraryOnlyProduct, null, 'library-only barcode save should not create a product');

            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'invoice');
            await harness.page.waitForTimeout(200);
            await harness.page.evaluate(async () => {
                await Sell.newDocument({ discardUnsaved: true });
                Sell.setView('invoice');
                await Sell.handleScan('777000111');
            });
            await harness.page.waitForFunction(() => {
                const data = Invoice.getData();
                return data.pages[0].items.length === 1 && data.pages[0].items[0].barcode === '777000111';
            });
            const libraryOnlySellItem = await harness.page.evaluate(() => Invoice.getData().pages[0].items[0]);
            assert.equal(libraryOnlySellItem.barcode, '777000111');
            assert.equal(libraryOnlySellItem.name_en || '', '');
            assert.equal(libraryOnlySellItem.qty, 1);

            await harness.page.click('.segment-btn[data-mode="barcode"]');
            await harness.page.waitForSelector('#panel-barcode.active');
            await harness.page.click('#barcode-gen-btn');
            await fillAndBlur(harness.page, '#bc-new-barcode-num', '777000112');
            await fillAndBlur(harness.page, '#bc-new-name-en', 'Sample Product Label');
            await fillAndBlur(harness.page, '#bc-new-weight', '250g');
            await fillAndBlur(harness.page, '#bc-new-unitprice', '0.450');
            await fillAndBlur(harness.page, '#bc-new-productby', 'Label Vendor');
            await harness.page.click('#bc-save-product-btn');

            await harness.page.waitForFunction(() => {
                return BarcodeGen.getGenerated().some((entry) => entry.barcodeNumber === '777000112');
            });
            const barcodeProduct = await waitForDbRow(
                harness.electronMain,
                'SELECT barcode, name_en, weight, unit_price_fils, product_by, pack_qty_text, display_order FROM products WHERE barcode = ?',
                ['777000112']
            );

            assert.ok(barcodeProduct, 'save as product should sync barcode into products');
            assert.equal(barcodeProduct.name_en, 'Sample Product Label');
            assert.equal(barcodeProduct.weight, '250g');
            assert.equal(barcodeProduct.unit_price_fils, 450);
            assert.equal(barcodeProduct.product_by, 'Label Vendor');
            assert.equal(barcodeProduct.pack_qty_text, '');
            assert.ok(!/[Ãðâ]/.test(await harness.page.locator('.bc-card-actions').first().textContent()));

            await harness.electronMain.invoke(
                'db-run',
                'UPDATE products SET pack_qty_text = ?, display_order = ? WHERE barcode = ?',
                ['6 Packet', 33, '777000112']
            );

            await harness.page.click('#barcode-gen-btn');
            await fillAndBlur(harness.page, '#bc-new-barcode-num', '777000112');
            await fillAndBlur(harness.page, '#bc-new-name-en', 'Sample Product Label Refresh');
            await fillAndBlur(harness.page, '#bc-new-weight', '250g');
            await fillAndBlur(harness.page, '#bc-new-unitprice', '0.450');
            await fillAndBlur(harness.page, '#bc-new-productby', 'Label Vendor');
            await harness.page.click('#bc-save-product-btn');

            const preservedBarcodeProduct = await waitForDbRow(
                harness.electronMain,
                'SELECT name_en, pack_qty_text, display_order FROM products WHERE barcode = ?',
                ['777000112'],
                (row) => row?.name_en === 'Sample Product Label Refresh'
            );
            assert.equal(preservedBarcodeProduct.name_en, 'Sample Product Label Refresh');
            assert.equal(preservedBarcodeProduct.pack_qty_text, '6 Packet');
            assert.equal(preservedBarcodeProduct.display_order, 33);

            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'invoice');
            await harness.page.waitForTimeout(200);
            await harness.page.evaluate(async () => {
                await Sell.newDocument({ discardUnsaved: true });
                Sell.setView('invoice');
                await Sell.handleScan('777000112');
            });
            await harness.page.waitForFunction(() => {
                const data = Invoice.getData();
                return data.pages[0].items.length === 1 && data.pages[0].items[0].barcode === '777000112';
            });
            const savedProductSellItem = await harness.page.evaluate(() => Invoice.getData().pages[0].items[0]);
            assert.equal(savedProductSellItem.name_en, 'Sample Product Label Refresh');
            assert.equal(savedProductSellItem.product_by, 'Label Vendor');
            assert.equal(savedProductSellItem.unit_price_fils, 450);

            await harness.page.click('.segment-btn[data-mode="barcode"]');
            await harness.page.waitForSelector('#panel-barcode.active');
            await harness.page.evaluate(() => Settings.openSettingsModal());
            await harness.page.waitForSelector('#settings-modal', { state: 'visible' });
            await harness.page.selectOption('#settings-barcode-printer', 'Thermal Label Printer');
            await harness.page.click('#settings-modal .modal-close');
            await harness.page.waitForSelector('#settings-modal', { state: 'hidden' });

            await harness.page.click('.bc-select-btn');
            assert.equal(await harness.page.locator('.bc-selected-overlay').count(), 0);
            assert.match(await harness.page.locator('.bc-select-btn').first().textContent(), /Selected/);
            assert.equal(
                (await harness.page.locator('.bc-delete-btn .bc-delete-icon + span').first().textContent()).trim(),
                'Delete'
            );
            const copiesInput = harness.page.locator('.bc-card-copies input').first();
            await copiesInput.fill('2');
            await copiesInput.blur();
            await harness.page.click('#barcode-print-btn');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'visible' });
            await waitForPreviewReady(harness.page);
            const barcodePrintDialogState = await harness.page.evaluate(() => ({
                copiesDisplay: document.getElementById('pd-copies-group') ? getComputedStyle(document.getElementById('pd-copies-group')).display : '',
                printerTypes: Array.from(document.getElementById('pd-barcode-printer-type')?.options || []).map((option) => option.textContent.trim())
            }));
            assert.equal(barcodePrintDialogState.copiesDisplay, 'none');
            assert.deepEqual(barcodePrintDialogState.printerTypes, [
                'A4 Label Sheet (3 × 10)',
                'A4 Label Sheet (2 × 7)',
                'A4 Label Sheet (4 × 11)',
                'Thermal Barcode (20 × 10 mm)',
                'Thermal Barcode (25 × 15 mm)',
                'Thermal Barcode (30 × 20 mm)',
                'Thermal Barcode (35 × 25 mm)',
                'Thermal Barcode (40 × 30 mm)',
                'Thermal Barcode (50 × 30 mm)',
                'Thermal Barcode (50 × 40 mm)',
                'Thermal Barcode (58 × 40 mm)',
                'Thermal Barcode (60 × 40 mm)',
                'Thermal Barcode (70 × 50 mm)',
                'Thermal Barcode (75 × 50 mm)',
                'Thermal Barcode (80 × 50 mm)',
                'Thermal Barcode (100 × 50 mm)',
                'Thermal Barcode (100 × 75 mm)',
                'Thermal Barcode (100 × 100 mm)',
                'Thermal Barcode (100 × 150 mm)'
            ]);
            await assert.equal(
                await harness.page.evaluate(() => {
                    const doc = document.getElementById('print-preview-frame')?.contentDocument;
                    return doc ? doc.querySelectorAll('.bc-label-text').length : 0;
                }),
                2
            );
            assert.equal(
                await harness.page.evaluate(() => {
                    const doc = document.getElementById('print-preview-frame')?.contentDocument;
                    const text = doc?.body?.textContent || '';
                    return text.includes('Sample Product Label Refresh')
                        && !text.includes('Label Vendor')
                        && !text.includes('250g')
                        && !text.includes('0.450')
                        && !text.includes('FILS');
                }),
                true
            );
            await harness.page.click('#pd-print-btn');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'hidden' });
            await harness.page.waitForTimeout(500);

            assert.ok(harness.printerJobs.length > printJobsBefore, 'direct print should be recorded');
            assert.ok(harness.printerJobs.some(job => job.type === 'print'));
            const barcodePrintJob = harness.printerJobs[harness.printerJobs.length - 1];
            assert.equal(barcodePrintJob.options.deviceName, 'Thermal Label Printer');
            assert.equal(barcodePrintJob.options.silent, true);
            await harness.assertNoFatalError();
        });

        await t.test('uses the configured invoice or letterhead printer for direct print jobs', async () => {
            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.selectOption('#sell-view-type', 'letterhead');
            await harness.page.waitForTimeout(200);

            await harness.page.evaluate(() => Settings.openSettingsModal());
            await harness.page.waitForSelector('#settings-modal', { state: 'visible' });
            assert.match(await harness.page.locator('#settings-modal').textContent(), /Invoice \/ Rapid Order Sheet Printer/);
            await harness.page.selectOption('#settings-invoice-printer', 'Headless Printer');
            await harness.page.click('#settings-modal .modal-close');
            await harness.page.waitForSelector('#settings-modal', { state: 'hidden' });

            await harness.page.evaluate(() => {
                Sell.setView('letterhead');
                Invoice.setLetterheadData({
                    ...Invoice.defaultLetterheadData(),
                    to: 'Printer Routing Test',
                    pages: [{
                        items: [{
                            barcode: 'LH-100',
                            name_en: 'Printer Routed Item',
                            name_ar: '',
                            weight: '1kg',
                            unit_price_fils: 500,
                            qty: 2,
                            product_by: 'Printer Vendor'
                        }]
                    }]
                });
                Sell.render();
            });

            const printJobsBefore = harness.printerJobs.length;
            await harness.page.click('#btn-print-doc');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'visible' });
            await waitForPreviewReady(harness.page);
            await harness.page.selectOption('#pd-destination', 'print');
            assert.notEqual(
                await harness.page.evaluate(() => getComputedStyle(document.getElementById('pd-copies-group')).display),
                'none'
            );
            await harness.page.click('#pd-print-btn');
            await harness.page.waitForSelector('#print-dialog-overlay', { state: 'hidden' });

            assert.ok(harness.printerJobs.length > printJobsBefore, 'letterhead direct print should be recorded');
            const letterheadPrintJob = harness.printerJobs[harness.printerJobs.length - 1];
            assert.equal(letterheadPrintJob.options.deviceName, 'Headless Printer');
            assert.equal(letterheadPrintJob.options.silent, true);
            await harness.assertNoFatalError();
        });

        await t.test('syncs barcode cards from My Stocks without changing print labels directly', async () => {
            await harness.page.click('.segment-btn[data-mode="barcode"]');
            await harness.page.waitForSelector('#panel-barcode.active');

            await harness.page.evaluate(async () => {
                await Persistence.saveBarcodeEntry({
                    barcode_number: '777000113',
                    format: 'code128',
                    name_en: 'Old Card Name',
                    name_ar: 'اسم قديم',
                    weight: '100g',
                    unit_price_fils: 200,
                    product_by: 'Old Vendor'
                });
                BarcodeGen.setGenerated(await Persistence.getBarcodeLibrary());
                await Persistence.upsertProduct({
                    barcode: '777000113',
                    name_en: 'Fresh Stock Name',
                    name_ar: 'اسم جديد',
                    country: '',
                    weight: '250g',
                    unit_price_fils: 250,
                    product_by: 'Fresh Vendor',
                    pack_qty_text: '8 Packet',
                    stock_qty: 8,
                    reorder_level: 5,
                    display_order: 12
                });
            });

            await harness.page.waitForFunction(() => {
                const entry = BarcodeGen.getGenerated().find((item) => item.barcodeNumber === '777000113');
                return !!entry && entry.itemNameEN === 'Old Card Name' && entry.unitPriceFils === 200;
            });

            await harness.page.click('#barcode-sync-cards-btn');
            await harness.page.waitForFunction(() => {
                const entry = BarcodeGen.getGenerated().find((item) => item.barcodeNumber === '777000113');
                return !!entry
                    && entry.itemNameEN === 'Fresh Stock Name'
                    && entry.itemNameAR === 'اسم جديد'
                    && entry.weight === '250g'
                    && entry.unitPriceFils === 250
                    && entry.productBy === 'Fresh Vendor';
            });

            const syncedLibraryRow = await waitForDbRow(
                harness.electronMain,
                'SELECT name_en, name_ar, weight, unit_price_fils, product_by FROM barcode_library WHERE barcode_number = ?',
                ['777000113'],
                (row) => row?.name_en === 'Fresh Stock Name'
            );

            assert.equal(syncedLibraryRow.name_en, 'Fresh Stock Name');
            assert.equal(syncedLibraryRow.name_ar, 'اسم جديد');
            assert.equal(syncedLibraryRow.weight, '250g');
            assert.equal(syncedLibraryRow.unit_price_fils, 250);
            assert.equal(syncedLibraryRow.product_by, 'Fresh Vendor');

            const syncedCardState = await harness.page.evaluate(() => {
                const entry = BarcodeGen.getGenerated().find((item) => item.barcodeNumber === '777000113');
                const card = Array.from(document.querySelectorAll('.bc-card')).find((node) =>
                    node.querySelector('.bc-card-barcode-num')?.textContent?.trim() === '777000113'
                );
                return {
                    entry: entry ? {
                        itemNameEN: entry.itemNameEN,
                        itemNameAR: entry.itemNameAR,
                        weight: entry.weight,
                        unitPriceFils: entry.unitPriceFils,
                        productBy: entry.productBy
                    } : null,
                    detailsText: card?.querySelector('.bc-card-details')?.textContent || ''
                };
            });

            assert.deepEqual(syncedCardState.entry, {
                itemNameEN: 'Fresh Stock Name',
                itemNameAR: 'اسم جديد',
                weight: '250g',
                unitPriceFils: 250,
                productBy: 'Fresh Vendor'
            });
            assert.match(syncedCardState.detailsText, /Fresh Stock Name/);
            assert.match(syncedCardState.detailsText, /250g/);
            assert.match(syncedCardState.detailsText, /0\.250 KD\./);
            assert.match(syncedCardState.detailsText, /Fresh Vendor/);
            await harness.assertNoFatalError();
        });

        await t.test('keeps manual My Stocks entry working after barcode card sync', async () => {
            await harness.page.click('.segment-btn[data-mode="barcode"]');
            await harness.page.waitForSelector('#panel-barcode.active');

            await harness.page.evaluate(async () => {
                await Persistence.saveBarcodeEntry({
                    barcode_number: '777000114',
                    format: 'code128',
                    name_en: 'Sync Guard',
                    name_ar: 'حارس',
                    weight: '120g',
                    unit_price_fils: 120,
                    product_by: 'Guard Vendor'
                });
                BarcodeGen.setGenerated(await Persistence.getBarcodeLibrary());
                await Persistence.upsertProduct({
                    barcode: '777000114',
                    name_en: 'Sync Guard Updated',
                    name_ar: 'حارس محدث',
                    country: '',
                    weight: '180g',
                    unit_price_fils: 180,
                    product_by: 'Guard Vendor Updated',
                    pack_qty_text: '4 Packet',
                    stock_qty: 4,
                    reorder_level: 5,
                    display_order: 13
                });
            });

            await harness.page.click('#barcode-sync-cards-btn');
            await harness.page.waitForFunction(() => {
                const entry = BarcodeGen.getGenerated().find((item) => item.barcodeNumber === '777000114');
                return !!entry && entry.itemNameEN === 'Sync Guard Updated' && entry.unitPriceFils === 180;
            });

            await harness.page.click('.segment-btn[data-mode="stocks"]');
            await harness.page.waitForSelector('#panel-stocks.active');
            await harness.page.click('#stocks-add-row');

            const row = '#stocks-tbody tr:first-child';
            await fillAndBlur(harness.page, `${row} [data-field="barcode"]`, '777000115');
            await fillAndBlur(harness.page, `${row} [data-field="product_by"]`, 'Manual After Sync');
            await fillAndBlur(harness.page, `${row} [data-field="name_en"]`, 'Manual Entry After Sync');
            await fillAndBlur(harness.page, `${row} [data-field="name_ar"]`, 'يدوي بعد المزامنة');
            await fillAndBlur(harness.page, `${row} [data-field="weight"]`, '375g');
            await fillAndBlur(harness.page, `${row} [data-field="pack_qty_text"]`, '5 Packet');
            await fillAndBlur(harness.page, `${row} [data-field="unit_price"]`, '0.375');

            const manualProduct = await waitForDbRow(
                harness.electronMain,
                'SELECT barcode, name_en, name_ar, weight, unit_price_fils, product_by, pack_qty_text FROM products WHERE barcode = ?',
                ['777000115'],
                (rowValue) => rowValue?.name_en === 'Manual Entry After Sync'
            );

            assert.ok(manualProduct, 'manual stock row should still save after barcode sync');
            assert.equal(manualProduct.name_en, 'Manual Entry After Sync');
            assert.equal(manualProduct.weight, '375g');
            assert.equal(manualProduct.unit_price_fils, 375);
            assert.equal(manualProduct.product_by, 'Manual After Sync');
            assert.equal(manualProduct.pack_qty_text, '5 Packet');
            await harness.assertNoFatalError();
        });

        await t.test('persists barcode reprint library entries across reloads', async () => {
            const barcodeLibraryRow = await waitForDbRow(
                harness.electronMain,
                'SELECT barcode_number, name_en, unit_price_fils, product_by FROM barcode_library WHERE barcode_number = ?',
                ['777000111']
            );
            assert.ok(barcodeLibraryRow, 'barcode library row should be stored');
            assert.equal(barcodeLibraryRow.name_en, 'Sample Label');
            assert.equal(barcodeLibraryRow.unit_price_fils, 450);
            assert.equal(barcodeLibraryRow.product_by, 'Label Vendor');

            await harness.page.evaluate(() => Persistence.setSetting('remembered_session', 'true'));
            await harness.page.reload({ waitUntil: 'domcontentloaded' });
            await harness.page.waitForFunction(() => {
                const overlay = document.getElementById('login-overlay');
                const app = document.getElementById('app-container');
                return overlay && app && overlay.style.display === 'none' && app.style.display === 'flex';
            });
            await dismissDraftRecoveryIfVisible(harness.page);

            await harness.page.click('.segment-btn[data-mode="barcode"]');
            await harness.page.waitForSelector('#panel-barcode.active');
            await harness.page.waitForFunction(() =>
                BarcodeGen.getGenerated().some((entry) => entry.barcodeNumber === '777000111')
            );

            await harness.page.fill('#barcode-library-search', '777000111');
            await harness.page.waitForFunction(() => document.querySelectorAll('.bc-card').length === 1);

            const barcodeState = await harness.page.evaluate(() => {
                const entry = BarcodeGen.getGenerated().find((item) => item.barcodeNumber === '777000111');
                return entry ? {
                    barcodeNumber: entry.barcodeNumber,
                    itemNameEN: entry.itemNameEN,
                    unitPriceFils: entry.unitPriceFils,
                    productBy: entry.productBy
                } : null;
            });

            assert.deepEqual(barcodeState, {
                barcodeNumber: '777000111',
                itemNameEN: 'Sample Label',
                unitPriceFils: 450,
                productBy: 'Label Vendor'
            });

            await harness.page.fill('#barcode-library-search', '');
            await harness.assertNoFatalError();
        });

        await t.test('creates backup, exports data, and imports a modified backup', async () => {
            await harness.page.click('.segment-btn[data-mode="sell"]');
            await harness.page.waitForSelector('#panel-sell.active');
            await harness.page.click('#user-btn');
            await harness.page.click('#btn-manage-settings');
            await harness.page.waitForSelector('#settings-modal', { state: 'visible' });

            await harness.page.click('#settings-backup-now');

            const backupRow = await waitForDbRow(
                harness.electronMain,
                'SELECT filepath, size_bytes FROM backups ORDER BY id DESC LIMIT 1'
            );
            assert.ok(backupRow, 'backup row should be created');
            assert.ok(fs.existsSync(backupRow.filepath), 'backup db file should exist');
            assert.ok(backupRow.size_bytes > 0, 'backup file should not be empty');

            const exportPath = path.join(harness.profileDir, 'saved-output', 'export.json');
            fs.mkdirSync(path.dirname(exportPath), { recursive: true });
            harness.queueSaveDialog(exportPath);
            await harness.page.click('#settings-export-btn');

            assert.ok(await waitForFile(exportPath), 'export json should be written');
            const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
            assert.ok(exported.products.some(product => product.barcode === '100100'));
            assert.ok(exported.barcode_library.some(entry => entry.barcode_number === '777000111'));

            await harness.page.evaluate(() => Persistence.setSetting('remembered_session', 'true'));

            const importPath = path.join(harness.profileDir, 'saved-output', 'import.json');
            const importedProduct = await waitForDbRow(
                harness.electronMain,
                'SELECT id FROM products WHERE barcode = ?',
                ['100100']
            );
            exported.products.push({
                barcode: '900900',
                name_en: 'Imported Product',
                name_ar: 'Imported Product',
                country: 'Kuwait',
                weight: '1kg',
                unit_price_fils: 3500,
                product_by: 'Import Test',
                pack_qty_text: '12 Packet',
                stock_qty: 7,
                reorder_level: 2,
                display_order: 44
            });
            exported.templates.push({
                id: 9991,
                name: 'Imported Invoice Template',
                doc_type: 'invoice',
                payload: { invoiceNumber: 'INV-IMPORTED', pages: [{ items: [] }] },
                created_at: '2026-03-06 00:00:00',
                updated_at: '2026-03-06 00:00:00'
            });
            exported.stock_movements.push({
                id: 9992,
                product_id: importedProduct.id,
                document_id: null,
                qty_change: -2,
                reason: 'import-test',
                created_at: '2026-03-06 00:00:00'
            });
            exported.barcode_library.push({
                id: 9993,
                barcode_number: '888123000',
                format: 'code128',
                name_en: 'Imported Label',
                name_ar: 'Imported Label',
                weight: '330g',
                unit_price_fils: 880,
                product_by: 'Import Vendor',
                created_at: '2026-03-06 00:00:00',
                updated_at: '2026-03-06 00:00:00'
            });
            fs.writeFileSync(importPath, JSON.stringify(exported, null, 2));

            harness.queueOpenDialog(importPath);
            await harness.page.click('#settings-import-btn');
            await harness.page.waitForSelector('#import-review-modal', { state: 'visible' });
            const importPreviewText = await harness.page.locator('#import-review-details').textContent();
            assert.ok(importPreviewText.includes('Imported Product'));
            assert.ok(importPreviewText.includes('Imported Invoice Template'));
            await harness.page.click('#import-review-confirm');
            await harness.page.waitForLoadState('domcontentloaded');
            await harness.page.waitForFunction(() => {
                const overlay = document.getElementById('login-overlay');
                const app = document.getElementById('app-container');
                return overlay && app && overlay.style.display === 'none' && app.style.display === 'flex';
            });
            await harness.page.waitForSelector('#sell-workspace .invoice-pages-wrapper');
            await dismissDraftRecoveryIfVisible(harness.page);

            const importedRow = await waitForDbRow(
                harness.electronMain,
                'SELECT name_en, pack_qty_text, stock_qty, display_order FROM products WHERE barcode = ?',
                ['900900']
            );
            assert.ok(importedRow, 'imported product should exist');
            assert.equal(importedRow.name_en, 'Imported Product');
            assert.equal(importedRow.pack_qty_text, '12 Packet');
            assert.equal(importedRow.stock_qty, 12);
            assert.equal(importedRow.display_order, 44);

            const importedTemplate = await waitForDbRow(
                harness.electronMain,
                'SELECT name, doc_type FROM templates WHERE name = ?',
                ['Imported Invoice Template']
            );
            assert.ok(importedTemplate, 'imported template should exist');
            assert.equal(importedTemplate.doc_type, 'invoice');

            const importedMovement = await waitForDbRow(
                harness.electronMain,
                'SELECT reason, qty_change FROM stock_movements WHERE id = ?',
                [9992]
            );
            assert.ok(importedMovement, 'imported stock movement should exist');
            assert.equal(importedMovement.reason, 'import-test');
            assert.equal(importedMovement.qty_change, -2);

            const importedBarcode = await waitForDbRow(
                harness.electronMain,
                'SELECT barcode_number, name_en, unit_price_fils FROM barcode_library WHERE id = ?',
                [9993]
            );
            assert.ok(importedBarcode, 'imported barcode library row should exist');
            assert.equal(importedBarcode.barcode_number, '888123000');
            assert.equal(importedBarcode.name_en, 'Imported Label');
            assert.equal(importedBarcode.unit_price_fils, 880);
            await harness.assertNoFatalError();
        });

        await t.test('logout clears remembered session and password-disabled login accepts blank password', async () => {
            await dismissDraftRecoveryIfVisible(harness.page);
            await harness.page.evaluate(() => Persistence.setSetting('remembered_session', 'true'));
            await harness.page.click('#user-btn');
            await harness.page.click('#btn-logout');
            await harness.page.waitForFunction(() => {
                const overlay = document.getElementById('login-overlay');
                const app = document.getElementById('app-container');
                return overlay && app && overlay.style.display === 'flex' && app.style.display === 'none';
            });

            const rememberedSetting = await waitForDbRow(
                harness.electronMain,
                'SELECT value FROM settings WHERE key = ?',
                ['remembered_session']
            );
            assert.equal(rememberedSetting.value, 'false');

            await harness.electronMain.invoke(
                'db-run',
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                ['has_password', 'false']
            );
            await harness.electronMain.invoke(
                'db-run',
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                ['password', '']
            );

            await harness.page.fill('#login-username', 'admin');
            await harness.page.fill('#login-password', '');
            await harness.page.click('#login-form button[type=\"submit\"]');
            await harness.page.waitForFunction(() => {
                const overlay = document.getElementById('login-overlay');
                const app = document.getElementById('app-container');
                return overlay && app && overlay.style.display === 'none' && app.style.display === 'flex';
            });
            await harness.assertNoFatalError();
        });
    } finally {
        await harness.cleanup();
    }
});
