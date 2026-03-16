const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
    dismissConfirmNewIfVisible,
    dismissDraftRecoveryIfVisible,
    fillAndBlur,
    handleInvoiceBarcodeUpdateIfVisible,
    inspectPdf,
    waitForDbRow,
    waitForFile,
    waitForPreviewReady,
    waitForPreviewSheetCountAtLeast,
    waitForSettingValue
} = require('./helpers');

async function waitForAppVisible(page) {
    await page.waitForFunction(() => {
        const overlay = document.getElementById('login-overlay');
        const app = document.getElementById('app-container');
        return overlay && app && overlay.style.display === 'none' && app.style.display === 'flex';
    });
    await page.waitForSelector('#sell-workspace .invoice-pages-wrapper');
}

async function loginIntoApp(harness) {
    await harness.gotoApp();
    await harness.login();
}

async function seedProduct(harness, overrides = {}) {
    const product = {
        barcode: '100100',
        name_en: 'Cardamom Tea',
        name_ar: 'Tea Arabic',
        country: 'Kuwait',
        weight: '500g',
        unit_price_fils: 1250,
        product_by: 'Nexus Foods',
        pack_qty_text: '2 Packet',
        stock_qty: 2,
        reorder_level: 5,
        display_order: 1,
        ...overrides
    };
    if (!Object.prototype.hasOwnProperty.call(overrides, 'pack_qty_text')) {
        product.pack_qty_text = `${Math.max(0, parseInt(product.stock_qty, 10) || 0)} Packet`;
    }
    product.stock_qty = Math.max(0, parseInt(product.pack_qty_text, 10) || 0);

    const result = await harness.electronMain.invoke(
        'db-run',
        `INSERT OR REPLACE INTO products (
            barcode, name_en, name_ar, country, weight, unit_price_fils, product_by, pack_qty_text, stock_qty, reorder_level, display_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            product.barcode,
            product.name_en,
            product.name_ar,
            product.country,
            product.weight,
            product.unit_price_fils,
            product.product_by,
            product.pack_qty_text,
            product.stock_qty,
            product.reorder_level,
            product.display_order
        ]
    );

    assert.equal(result.success, true, 'product seed should succeed');
    return waitForDbRow(
        harness.electronMain,
        'SELECT * FROM products WHERE barcode = ?',
        [product.barcode]
    );
}

async function seedBarcodeEntry(harness, overrides = {}) {
    const entry = {
        barcode_number: '777000111',
        format: 'code128',
        name_en: 'Sample Label',
        name_ar: 'Sample Label',
        weight: '250g',
        unit_price_fils: 450,
        product_by: 'Label Vendor',
        ...overrides
    };

    const result = await harness.electronMain.invoke(
        'db-run',
        `INSERT OR REPLACE INTO barcode_library (
            barcode_number, format, name_en, name_ar, weight, unit_price_fils, product_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            entry.barcode_number,
            entry.format,
            entry.name_en,
            entry.name_ar,
            entry.weight,
            entry.unit_price_fils,
            entry.product_by
        ]
    );

    assert.equal(result.success, true, 'barcode library seed should succeed');
    return waitForDbRow(
        harness.electronMain,
        'SELECT * FROM barcode_library WHERE barcode_number = ?',
        [entry.barcode_number]
    );
}

async function auditAuthSession(harness) {
    await loginIntoApp(harness);

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
    await harness.page.click('#login-form button[type="submit"]');
    await waitForAppVisible(harness.page);

    return {
        evidence: [
            { label: 'remembered_session after logout', value: rememberedSetting.value },
            { label: 'blank-password login accepted', value: 'true' }
        ]
    };
}

async function auditStocksManagement(harness) {
    await loginIntoApp(harness);

    await harness.page.click('.segment-btn[data-mode="stocks"]');
    await harness.page.waitForSelector('#panel-stocks.active');
    await harness.page.click('#stocks-add-row');

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
    assert.ok(product, 'product should persist');
    assert.equal(product.unit_price_fils, 1250);
    assert.equal(product.pack_qty_text, '6 Packet');

    const stockHeaders = (await harness.page.locator('.stocks-table thead th').allTextContents())
        .map((value) => value.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    assert.equal(stockHeaders.length, 8);
    assert.ok(stockHeaders.includes('S. no.'));
    assert.ok(stockHeaders.includes('Barcode'));
    assert.ok(stockHeaders.includes('Product By'));
    assert.ok(stockHeaders.includes('Item Name'));
    assert.ok(stockHeaders.includes('Qty.'));
    assert.ok(stockHeaders.includes('اسم الصنف'));
    assert.ok(!stockHeaders.includes('Country'));
    assert.ok(!stockHeaders.includes('Stock Qty'));

    await harness.page.fill('#stocks-search', 'Cardamom');
    assert.equal(await harness.page.locator('#stocks-tbody tr').count(), 1);
    assert.equal((await harness.page.locator('#notification-badge').textContent()).trim(), '0');

    await harness.page.check('#stocks-tbody tr:first-child .col-checkbox input');
    await harness.page.click('#stocks-view-history');
    await harness.page.waitForSelector('#stock-history-modal', { state: 'visible' });
    const historyText = await harness.page.locator('#stock-history-list').textContent();
    assert.match(historyText, /No stock movements recorded/i);

    return {
        evidence: [
            { label: 'saved stock barcode', value: product.barcode },
            { label: 'stock headers', value: stockHeaders.join(' | ') },
            { label: 'low-stock badge count', value: '0' },
            { label: 'movement history includes', value: 'No stock movements recorded' }
        ]
    };
}

async function auditScannerRouting(harness) {
    await loginIntoApp(harness);
    await seedProduct(harness, {
        barcode: '310310',
        name_en: 'Scanner Tea',
        product_by: 'Scanner Vendor',
        stock_qty: 5,
        reorder_level: 1
    });
    await seedBarcodeEntry(harness, {
        barcode_number: '200200',
        name_en: 'Library Pepper',
        name_ar: 'Library Pepper AR',
        weight: '750g',
        unit_price_fils: 990,
        product_by: 'Library Vendor'
    });

    await harness.page.click('.segment-btn[data-mode="stocks"]');
    await harness.page.waitForSelector('#panel-stocks.active');
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
    assert.ok(stockRow, 'scan in stocks mode should create stock row');
    assert.equal(stockRow.stock_qty, 2);
    assert.equal(stockRow.name_en, 'Library Pepper');
    assert.equal(stockRow.unit_price_fils, 990);
    assert.equal(stockRow.product_by, 'Library Vendor');

    await harness.page.click('.segment-btn[data-mode="barcode"]');
    await harness.page.waitForSelector('#panel-barcode.active');
    await harness.page.click('#barcode-gen-btn');
    await harness.page.evaluate(() => App.handleScan('300300'));
    assert.equal(await harness.page.locator('#bc-new-barcode-num').inputValue(), '300300');

    await harness.page.click('.segment-btn[data-mode="sell"]');
    await harness.page.waitForSelector('#panel-sell.active');
    await harness.page.selectOption('#sell-view-type', 'invoice');
    await harness.page.waitForTimeout(200);
    await harness.page.evaluate(async () => {
        await Sell.handleScan('310310');
    });
    await harness.page.waitForFunction(() => {
        const data = Invoice.getData();
        return data.pages[0].items.length === 1 && data.pages[0].items[0].barcode === '310310';
    });

    const sellState = await harness.page.evaluate(() => Invoice.getData().pages[0].items[0]);
    assert.equal(sellState.name_en, 'Scanner Tea');

    await harness.page.evaluate(async () => {
        await Sell.newDocument({ discardUnsaved: true });
        Sell.setView('invoice');
        await Sell.handleScan('200200');
    });
    await harness.page.waitForFunction(() => {
        const data = Invoice.getData();
        return data.pages[0].items.length === 1 && data.pages[0].items[0].barcode === '200200';
    });
    const libraryOnlySellState = await harness.page.evaluate(() => Invoice.getData().pages[0].items[0]);
    assert.equal(libraryOnlySellState.name_en, 'Library Pepper');

    return {
        evidence: [
            { label: 'stocks mode scan result', value: `${stockRow.barcode} -> qty ${stockRow.stock_qty}` },
            { label: 'stocks mode autofill', value: `${stockRow.name_en} @ ${stockRow.unit_price_fils}` },
            { label: 'barcode mode scan target', value: '#bc-new-barcode-num' },
            { label: 'sell mode scan item', value: sellState.name_en },
            { label: 'sell mode library scan item', value: libraryOnlySellState.name_en }
        ]
    };
}

async function auditInvoiceLifecycle(harness) {
    await loginIntoApp(harness);
    await seedProduct(harness);

    await harness.page.click('.segment-btn[data-mode="sell"]');
    await harness.page.waitForSelector('#panel-sell.active');
    await harness.page.selectOption('#sell-view-type', 'invoice');
    await harness.page.waitForTimeout(200);

    await harness.page.evaluate(async () => {
        await Sell.handleScan('100100');
        await Sell.handleScan('100100');
    });
    await harness.page.waitForFunction(() => {
        const data = Invoice.getData();
        return data.pages[0].items.length === 1 && data.pages[0].items[0].qty === 2;
    });

    await harness.page.evaluate(async () => {
        await Sell.saveDocument();
    });

    const documentRow = await waitForDbRow(
        harness.electronMain,
        'SELECT id, doc_type, doc_number, total_fils FROM documents ORDER BY id DESC LIMIT 1'
    );
    assert.ok(documentRow, 'saved document should exist');
    assert.equal(documentRow.doc_type, 'invoice');
    assert.equal(documentRow.total_fils, 2500);

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
    assert.equal(afterCount.data.count, beforeCount.data.count);
    assert.equal(afterNextNumber.value, beforeNextNumber.value);

    await harness.page.click('#btn-new-doc');
    await dismissConfirmNewIfVisible(harness.page);
    await harness.page.waitForFunction(() => Invoice.getData().pages[0].items.length === 0);
    assert.equal(await harness.page.evaluate(() => Invoice.getData().invoiceNumber), 'INV-0002');

    await harness.page.click('#btn-load-template');
    await harness.page.waitForSelector('#template-modal', { state: 'visible' });
    await harness.page.evaluate(async (documentId) => {
        await Sell.openSavedDocumentById(documentId);
    }, documentRow.id);
    await harness.page.waitForFunction(() => Invoice.getData().pages[0].items.length === 1);
    await harness.page.waitForFunction(() => Sell.getViewMode() === 'view');
    await harness.page.click('#sell-view-edit-original');
    await harness.page.waitForFunction(() => Sell.getViewMode() === 'edit-original');

    const reopenedItem = await harness.page.evaluate(() => Invoice.getData().pages[0].items[0]);
    assert.equal(reopenedItem.qty, 2);
    assert.equal(reopenedItem.name_en, 'Cardamom Tea Deluxe');

    return {
        evidence: [
            { label: 'saved invoice number', value: documentRow.doc_number },
            { label: 'invoice total (fils)', value: String(documentRow.total_fils) },
            { label: 'reopened item name', value: reopenedItem.name_en }
        ]
    };
}

async function auditDraftRecovery(harness) {
    await loginIntoApp(harness);

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
    assert.ok(draftValue, 'draft should persist');

    await harness.page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppVisible(harness.page);
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

    const savedDocument = await waitForDbRow(
        harness.electronMain,
        'SELECT payload FROM documents ORDER BY id DESC LIMIT 1'
    );
    const clearedDraft = await waitForSettingValue(
        harness.electronMain,
        'draft_invoice',
        (value) => value === ''
    );

    assert.equal(JSON.parse(savedDocument.payload).pages[0].items[0].name_en, 'Draft Recovery Item');
    assert.equal(clearedDraft, '');

    return {
        evidence: [
            { label: 'draft saved in settings', value: 'true' },
            { label: 'recovered line item', value: 'Draft Recovery Item' },
            { label: 'draft cleared after save', value: 'true' }
        ]
    };
}

async function auditPrintPipeline(harness) {
    await loginIntoApp(harness);
    await seedProduct(harness);

    await harness.page.click('.segment-btn[data-mode="sell"]');
    await harness.page.waitForSelector('#panel-sell.active');
    await harness.page.selectOption('#sell-view-type', 'invoice');
    await harness.page.waitForTimeout(200);

    await harness.page.evaluate(async () => {
        await Sell.handleScan('100100');
        await Sell.handleScan('100100');
        await Sell.saveDocument();
    });

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
    const pdfInfo = await inspectPdf(pdfPath);
    assert.ok(pdfInfo.pageCount >= 1);
    assert.match(pdfInfo.text, /Cardamom Tea/i);

    const productRow = await waitForDbRow(
        harness.electronMain,
        'SELECT stock_qty FROM products WHERE barcode = ?',
        ['100100']
    );
    assert.equal(productRow.stock_qty, 0);

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
    assert.ok(linkedMovement && linkedMovement.document_id, 'sale movement should link back to a document');

    return {
        evidence: [
            { label: 'pdf pages', value: String(pdfInfo.pageCount) },
            { label: 'printer job types', value: harness.printerJobs.map(job => job.type).join(', ') },
            { label: 'linked sale reason', value: `${linkedMovement.reason} (${linkedMovement.doc_number})` }
        ]
    };
}

async function auditBarcodeLibrary(harness) {
    await loginIntoApp(harness);

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

    await harness.page.waitForFunction(() => BarcodeGen.getGenerated().length === 1);
    const barcodeRow = await waitForDbRow(
        harness.electronMain,
        'SELECT barcode_number, name_en, unit_price_fils, product_by FROM barcode_library WHERE barcode_number = ?',
        ['777000111']
    );
    assert.ok(barcodeRow, 'barcode library entry should persist');

    await harness.page.click('.bc-select-btn');
    const copiesInput = harness.page.locator('.bc-card-copies input').first();
    await copiesInput.fill('2');
    await copiesInput.blur();
    await harness.page.click('#barcode-print-btn');
    await harness.page.waitForSelector('#print-dialog-overlay', { state: 'visible' });
    await waitForPreviewReady(harness.page);
    const previewLabelCount = await harness.page.evaluate(() => {
        const doc = document.getElementById('print-preview-frame')?.contentDocument;
        return doc ? doc.querySelectorAll('.bc-label-text').length : 0;
    });
    assert.equal(previewLabelCount, 2);
    await harness.page.click('#pd-print-btn');
    await harness.page.waitForSelector('#print-dialog-overlay', { state: 'hidden' });
    await harness.page.waitForTimeout(300);

    assert.ok(harness.printerJobs.length > printJobsBefore, 'direct print should be recorded');

    await harness.page.evaluate(() => Persistence.setSetting('remembered_session', 'true'));
    await harness.page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppVisible(harness.page);
    await dismissDraftRecoveryIfVisible(harness.page);

    await harness.page.click('.segment-btn[data-mode="barcode"]');
    await harness.page.waitForSelector('#panel-barcode.active');
    await harness.page.waitForFunction(() =>
        BarcodeGen.getGenerated().some((entry) => entry.barcodeNumber === '777000111')
    );
    await harness.page.fill('#barcode-library-search', '777000111');

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

    return {
        evidence: [
            { label: 'barcode library row', value: barcodeRow.barcode_number },
            { label: 'preview copies', value: String(previewLabelCount) },
            { label: 'reload persistence', value: barcodeState.barcodeNumber }
        ]
    };
}

async function auditBackupImport(harness) {
    await loginIntoApp(harness);
    await seedProduct(harness);
    await seedBarcodeEntry(harness);

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
    assert.ok(backupRow, 'backup row should exist');
    assert.ok(fs.existsSync(backupRow.filepath), 'backup file should be created');

    const exportPath = path.join(harness.profileDir, 'saved-output', 'export.json');
    fs.mkdirSync(path.dirname(exportPath), { recursive: true });
    harness.queueSaveDialog(exportPath);
    await harness.page.click('#settings-export-btn');

    assert.ok(await waitForFile(exportPath), 'export file should exist');
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
    await harness.page.click('#import-review-confirm');
    await harness.page.waitForLoadState('domcontentloaded');
    await waitForAppVisible(harness.page);
    await dismissDraftRecoveryIfVisible(harness.page);

    const importedRow = await waitForDbRow(
        harness.electronMain,
        'SELECT name_en, pack_qty_text, stock_qty, display_order FROM products WHERE barcode = ?',
        ['900900']
    );
    const importedTemplate = await waitForDbRow(
        harness.electronMain,
        'SELECT name, doc_type FROM templates WHERE name = ?',
        ['Imported Invoice Template']
    );
    const importedMovement = await waitForDbRow(
        harness.electronMain,
        'SELECT reason, qty_change FROM stock_movements WHERE id = ?',
        [9992]
    );
    const importedBarcode = await waitForDbRow(
        harness.electronMain,
        'SELECT barcode_number, name_en, unit_price_fils FROM barcode_library WHERE id = ?',
        [9993]
    );

    assert.equal(importedRow.name_en, 'Imported Product');
    assert.equal(importedRow.pack_qty_text, '12 Packet');
    assert.equal(importedRow.stock_qty, 12);
    assert.equal(importedRow.display_order, 44);
    assert.equal(importedTemplate.doc_type, 'invoice');
    assert.equal(importedMovement.reason, 'import-test');
    assert.equal(importedBarcode.barcode_number, '888123000');

    return {
        evidence: [
            { label: 'backup size (bytes)', value: String(backupRow.size_bytes) },
            { label: 'exported products count', value: String(exported.products.length) },
            { label: 'imported barcode id', value: importedBarcode.barcode_number }
        ]
    };
}

module.exports = {
    waitForAppVisible,
    auditAuthSession,
    auditStocksManagement,
    auditScannerRouting,
    auditInvoiceLifecycle,
    auditDraftRecovery,
    auditPrintPipeline,
    auditBarcodeLibrary,
    auditBackupImport
};
