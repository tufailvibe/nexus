/**
 * print.js - Dedicated print composition engine for preview, PDF, and printer output.
 */
const PrintManager = (() => {
    const RAPID_ORDER_SHEET_LABEL = 'Rapid Order Sheet';
    const PRINT_STYLESHEET_PATHS = [
        'css/global.css',
        'css/invoice.css',
        'css/letterhead.css',
        'css/barcode.css',
        'css/print-compose.css'
    ];
    const PAPER_SIZES_MM = {
        A3: { width: 297, height: 420 },
        A4: { width: 210, height: 297 },
        A5: { width: 148, height: 210 },
        Letter: { width: 215.9, height: 279.4 },
        Legal: { width: 215.9, height: 355.6 },
        Thermal58x40: { width: 58, height: 40 },
        Thermal80x50: { width: 80, height: 50 },
        Thermal100x50: { width: 100, height: 50 }
    };
    const MARGIN_PRESETS_MM = {
        default: { top: 10, right: 10, bottom: 10, left: 10 },
        minimum: { top: 5, right: 5, bottom: 5, left: 5 },
        none: { top: 0, right: 0, bottom: 0, left: 0 }
    };
    function formatMeasureMm(value) {
        const rounded = Math.round(Number(value) * 10) / 10;
        return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}mm`;
    }

    function formatMeasurePt(value) {
        const rounded = Math.round(Number(value) * 10) / 10;
        return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}pt`;
    }

    function createA4BarcodeSheetProfile(config) {
        return {
            id: config.id,
            label: config.label,
            hint: config.hint,
            paperSizeName: 'A4',
            paperSizeMm: { width: 210, height: 297 },
            orientation: 'portrait',
            marginsMode: 'none',
            pagesPerSheet: 1,
            scaleMode: 'default',
            scaleCustom: '100',
            labelsPerSheet: config.cols * config.rows,
            gridTemplateColumns: `repeat(${config.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${config.rows}, minmax(0, 1fr))`,
            sheetPadding: config.sheetPadding,
            sheetGap: config.sheetGap,
            labelPadding: config.labelPadding,
            barcodeWidth: config.barcodeWidth,
            barcodeHeight: config.barcodeHeight,
            fontSize: config.fontSize,
            lineHeight: config.lineHeight,
            textGap: config.textGap,
            fillEmptySlots: true
        };
    }

    function createThermalBarcodeProfile(widthMm, heightMm) {
        const shortSide = Math.min(widthMm, heightMm);
        const paddingMm = clamp(shortSide * 0.08, 1.2, 3.2);
        const barcodeWidthMm = clamp(
            widthMm - (paddingMm * 2) - Math.max(1.6, widthMm * 0.08),
            Math.max(12, widthMm * 0.62),
            Math.max(12, widthMm - (paddingMm * 2))
        );
        const availableBarcodeHeightMm = Math.max(4.2, heightMm - (paddingMm * 2) - Math.max(2.2, heightMm * 0.18));
        const barcodeHeightMm = clamp(heightMm * 0.34, 4.2, availableBarcodeHeightMm);
        const fontSizePt = clamp(shortSide * 0.24, 3.4, 10.5);
        const textGapMm = clamp(shortSide * 0.025, 0.2, 1.4);
        const lineHeight = shortSide <= 10
            ? '1.02'
            : (shortSide <= 15
                ? '1.06'
                : (shortSide <= 25 ? '1.12' : (shortSide <= 40 ? '1.18' : '1.22')));

        return {
            id: `thermal-${widthMm}x${heightMm}`,
            label: `Thermal Barcode (${widthMm} × ${heightMm} mm)`,
            hint: `Single-label thermal format tuned for ${widthMm} × ${heightMm} mm barcode media.`,
            paperSizeName: `Thermal${widthMm}x${heightMm}`,
            paperSizeMm: { width: widthMm, height: heightMm },
            orientation: heightMm > widthMm ? 'portrait' : 'landscape',
            marginsMode: 'none',
            pagesPerSheet: 1,
            scaleMode: 'default',
            scaleCustom: '100',
            labelsPerSheet: 1,
            gridTemplateColumns: 'minmax(0, 1fr)',
            gridTemplateRows: 'minmax(0, 1fr)',
            sheetPadding: formatMeasureMm(paddingMm),
            sheetGap: '0',
            labelPadding: formatMeasureMm(paddingMm),
            barcodeWidth: formatMeasureMm(barcodeWidthMm),
            barcodeHeight: formatMeasureMm(barcodeHeightMm),
            fontSize: formatMeasurePt(fontSizePt),
            lineHeight,
            textGap: formatMeasureMm(textGapMm),
            fillEmptySlots: false
        };
    }

    const DEFAULT_BARCODE_PRINTER_PROFILE_ID = 'a4-sheet-30';
    const BARCODE_PRINTER_PROFILE_ORDER = [
        'a4-sheet-30',
        'a4-sheet-14',
        'a4-sheet-44',
        'thermal-20x10',
        'thermal-25x15',
        'thermal-30x20',
        'thermal-35x25',
        'thermal-40x30',
        'thermal-50x30',
        'thermal-50x40',
        'thermal-58x40',
        'thermal-60x40',
        'thermal-70x50',
        'thermal-75x50',
        'thermal-80x50',
        'thermal-100x50',
        'thermal-100x75',
        'thermal-100x100',
        'thermal-100x150'
    ];
    const BARCODE_PRINTER_PROFILES = {
        'a4-sheet-30': {
            id: 'a4-sheet-30',
            label: 'A4 Label Sheet (3 × 10)',
            hint: 'Best for standard A4 sticker sheets. Prints 30 labels per page and keeps the live preview on an A4 layout.',
            paperSizeName: 'A4',
            paperSizeMm: { width: 210, height: 297 },
            orientation: 'portrait',
            marginsMode: 'none',
            pagesPerSheet: 1,
            scaleMode: 'default',
            scaleCustom: '100',
            labelsPerSheet: 30,
            gridTemplateColumns: 'repeat(3, 66.7mm)',
            gridTemplateRows: 'repeat(10, 25.4mm)',
            sheetPadding: '12.7mm 5mm 12.7mm 5mm',
            sheetGap: '0 3.2mm',
            labelPadding: '2mm',
            barcodeWidth: '60mm',
            barcodeHeight: '12mm',
            fontSize: '6pt',
            lineHeight: '1.28',
            textGap: '1mm',
            fillEmptySlots: true
        },
        'thermal-58x40': {
            id: 'thermal-58x40',
            label: 'Thermal Barcode (58 × 40 mm)',
            hint: 'Single-label thermal format for compact barcode printers with automatic one-label preview sizing.',
            paperSizeName: 'Thermal58x40',
            paperSizeMm: { width: 58, height: 40 },
            orientation: 'landscape',
            marginsMode: 'none',
            pagesPerSheet: 1,
            scaleMode: 'default',
            scaleCustom: '100',
            labelsPerSheet: 1,
            gridTemplateColumns: 'minmax(0, 1fr)',
            gridTemplateRows: 'minmax(0, 1fr)',
            sheetPadding: '1.6mm',
            sheetGap: '0',
            labelPadding: '1.6mm',
            barcodeWidth: '49mm',
            barcodeHeight: '13mm',
            fontSize: '8pt',
            lineHeight: '1.18',
            textGap: '0.9mm',
            fillEmptySlots: false
        },
        'thermal-80x50': {
            id: 'thermal-80x50',
            label: 'Thermal Barcode (80 × 50 mm)',
            hint: 'Wider thermal ticket with larger barcode sizing for retail and counter labels.',
            paperSizeName: 'Thermal80x50',
            paperSizeMm: { width: 80, height: 50 },
            orientation: 'landscape',
            marginsMode: 'none',
            pagesPerSheet: 1,
            scaleMode: 'default',
            scaleCustom: '100',
            labelsPerSheet: 1,
            gridTemplateColumns: 'minmax(0, 1fr)',
            gridTemplateRows: 'minmax(0, 1fr)',
            sheetPadding: '2.2mm',
            sheetGap: '0',
            labelPadding: '2mm',
            barcodeWidth: '69mm',
            barcodeHeight: '16mm',
            fontSize: '9pt',
            lineHeight: '1.2',
            textGap: '1.1mm',
            fillEmptySlots: false
        },
        'thermal-100x50': {
            id: 'thermal-100x50',
            label: 'Thermal Barcode (100 × 50 mm)',
            hint: 'Large shipping-style thermal label with more breathing room for barcode and product text.',
            paperSizeName: 'Thermal100x50',
            paperSizeMm: { width: 100, height: 50 },
            orientation: 'landscape',
            marginsMode: 'none',
            pagesPerSheet: 1,
            scaleMode: 'default',
            scaleCustom: '100',
            labelsPerSheet: 1,
            gridTemplateColumns: 'minmax(0, 1fr)',
            gridTemplateRows: 'minmax(0, 1fr)',
            sheetPadding: '2.4mm',
            sheetGap: '0',
            labelPadding: '2.2mm',
            barcodeWidth: '88mm',
            barcodeHeight: '18mm',
            fontSize: '10pt',
            lineHeight: '1.22',
            textGap: '1.2mm',
            fillEmptySlots: false
        },
        'a4-sheet-14': createA4BarcodeSheetProfile({
            id: 'a4-sheet-14',
            label: 'A4 Label Sheet (2 × 7)',
            hint: 'Larger A4 sticker format with 14 labels per page for more readable barcode and product text.',
            cols: 2,
            rows: 7,
            sheetPadding: '8mm',
            sheetGap: '3mm 4mm',
            labelPadding: '2.4mm',
            barcodeWidth: '82mm',
            barcodeHeight: '15mm',
            fontSize: '7.6pt',
            lineHeight: '1.18',
            textGap: '0.9mm'
        }),
        'a4-sheet-44': createA4BarcodeSheetProfile({
            id: 'a4-sheet-44',
            label: 'A4 Label Sheet (4 × 11)',
            hint: 'Dense A4 sticker format with 44 labels per page for compact barcode labels.',
            cols: 4,
            rows: 11,
            sheetPadding: '6mm',
            sheetGap: '2mm',
            labelPadding: '1.4mm',
            barcodeWidth: '42mm',
            barcodeHeight: '10mm',
            fontSize: '5.2pt',
            lineHeight: '1.2',
            textGap: '0.55mm'
        }),
        'thermal-20x10': createThermalBarcodeProfile(20, 10),
        'thermal-25x15': createThermalBarcodeProfile(25, 15),
        'thermal-30x20': createThermalBarcodeProfile(30, 20),
        'thermal-35x25': createThermalBarcodeProfile(35, 25),
        'thermal-40x30': createThermalBarcodeProfile(40, 30),
        'thermal-50x30': createThermalBarcodeProfile(50, 30),
        'thermal-50x40': createThermalBarcodeProfile(50, 40),
        'thermal-60x40': createThermalBarcodeProfile(60, 40),
        'thermal-70x50': createThermalBarcodeProfile(70, 50),
        'thermal-75x50': createThermalBarcodeProfile(75, 50),
        'thermal-100x75': createThermalBarcodeProfile(100, 75),
        'thermal-100x100': createThermalBarcodeProfile(100, 100),
        'thermal-100x150': createThermalBarcodeProfile(100, 150)
    };

    let currentViewType = '';
    let currentPrintPayload = null;
    let currentPdfBuffer = null;
    let currentJob = null;
    let refreshTimeout = null;
    let listenersInitialized = false;
    let refreshGeneration = 0;
    let previewStylesCache = null;
    let currentPendingDeductions = null;

    function getViewTypeLabel(viewType = currentViewType) {
        switch (viewType) {
            case 'invoice':
                return 'Invoice';
            case 'letterhead':
                return RAPID_ORDER_SHEET_LABEL;
            case 'barcode':
                return 'Barcode';
            default:
                return 'Print';
        }
    }

    function getBarcodePrinterProfile(profileId) {
        const normalizedId = String(profileId || '').trim();
        return BARCODE_PRINTER_PROFILES[normalizedId] || BARCODE_PRINTER_PROFILES[DEFAULT_BARCODE_PRINTER_PROFILE_ID];
    }

    function getSelectedBarcodePrinterProfile() {
        const selectedId = document.getElementById('pd-barcode-printer-type')?.value || DEFAULT_BARCODE_PRINTER_PROFILE_ID;
        return getBarcodePrinterProfile(selectedId);
    }

    function populateBarcodePrinterTypeOptions() {
        const select = document.getElementById('pd-barcode-printer-type');
        if (!select) return;

        const selectedId = String(select.value || DEFAULT_BARCODE_PRINTER_PROFILE_ID);
        select.innerHTML = BARCODE_PRINTER_PROFILE_ORDER
            .map((profileId) => {
                const profile = getBarcodePrinterProfile(profileId);
                return `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.label)}</option>`;
            })
            .join('');
        select.value = BARCODE_PRINTER_PROFILES[selectedId] ? selectedId : DEFAULT_BARCODE_PRINTER_PROFILE_ID;
    }

    function setDisabledState(element, disabled) {
        if (!element) return;
        if ('disabled' in element) {
            element.disabled = !!disabled;
        }
        element.classList.toggle('is-disabled', !!disabled);
    }

    function updateBarcodePrinterUi() {
        const isBarcodeView = currentViewType === 'barcode';
        const group = document.getElementById('pd-barcode-printer-group');
        const hint = document.getElementById('pd-barcode-printer-hint');

        if (group) group.hidden = !isBarcodeView;

        const linkedControlIds = [
            'pd-paper-size',
            'pd-pages-per-sheet',
            'pd-margins',
            'pd-scale',
            'pd-scale-custom',
            'pd-margin-top',
            'pd-margin-right',
            'pd-margin-bottom',
            'pd-margin-left'
        ];
        linkedControlIds.forEach((id) => setDisabledState(document.getElementById(id), isBarcodeView));
        document.querySelectorAll('#pd-layout-toggle .layout-btn').forEach((button) => setDisabledState(button, isBarcodeView));

        if (!isBarcodeView) return;

        const profile = getSelectedBarcodePrinterProfile();
        if (hint) {
            hint.textContent = profile.hint;
        }
    }

    function applyBarcodePrinterProfileToUi(profileId) {
        const profile = getBarcodePrinterProfile(profileId);
        const profileSelect = document.getElementById('pd-barcode-printer-type');
        if (profileSelect) profileSelect.value = profile.id;

        setSelectValue('pd-paper-size', profile.paperSizeName);
        setSelectValue('pd-pages-per-sheet', String(profile.pagesPerSheet || 1));
        setSelectValue('pd-margins', profile.marginsMode || 'none');
        setSelectValue('pd-scale', profile.scaleMode || 'default');
        setInputValue('pd-scale-custom', profile.scaleCustom || '100');
        setLayoutValue(profile.orientation || 'portrait');
        updateBarcodePrinterUi();
        handleSettingChange('pd-margins');
        handleSettingChange('pd-scale');
    }

    function getDefaultPresetSettings(viewType = currentViewType) {
        return {
            destination: viewType === 'barcode' ? 'print' : 'pdf',
            colorMode: 'color',
            paperSizeName: 'A4',
            pagesPerSheet: 1,
            marginsMode: viewType === 'barcode' ? 'default' : 'none',
            marginTop: '',
            marginRight: '',
            marginBottom: '',
            marginLeft: '',
            scaleMode: 'default',
            scaleCustom: '100',
            copies: 1,
            collate: true,
            displayHeaderFooter: false,
            printBackground: true,
            orientation: viewType === 'letterhead' ? 'landscape' : 'portrait'
        };
    }

    function normalizePresetConfig(viewType = currentViewType, value = {}) {
        const defaults = getDefaultPresetSettings(viewType);
        const source = value && typeof value === 'object' ? value : {};
        const allowedMargins = ['default', 'none', 'minimum', 'custom'];
        const allowedScaleModes = ['default', 'fit', 'custom'];
        const allowedDestinations = ['pdf', 'print'];
        const allowedOrientations = ['portrait', 'landscape'];
        const allowedPagesPerSheet = [1, 2, 4, 6, 9, 16];
        const paperSizeName = PAPER_SIZES_MM[source.paperSizeName] ? source.paperSizeName : defaults.paperSizeName;
        const pagesPerSheet = allowedPagesPerSheet.includes(parseInt(source.pagesPerSheet, 10))
            ? parseInt(source.pagesPerSheet, 10)
            : defaults.pagesPerSheet;
        const toMarginValue = (raw) => {
            if (raw === '' || raw == null) return '';
            const parsed = Math.max(0, parseFloat(raw) || 0);
            return Number.isFinite(parsed) ? String(parsed) : '';
        };

        return {
            destination: allowedDestinations.includes(source.destination) ? source.destination : defaults.destination,
            colorMode: source.colorMode === 'bw' ? 'bw' : defaults.colorMode,
            paperSizeName,
            pagesPerSheet,
            marginsMode: allowedMargins.includes(source.marginsMode) ? source.marginsMode : defaults.marginsMode,
            marginTop: toMarginValue(source.marginTop),
            marginRight: toMarginValue(source.marginRight),
            marginBottom: toMarginValue(source.marginBottom),
            marginLeft: toMarginValue(source.marginLeft),
            scaleMode: allowedScaleModes.includes(source.scaleMode) ? source.scaleMode : defaults.scaleMode,
            scaleCustom: String(clamp(parseFloat(source.scaleCustom) || parseFloat(defaults.scaleCustom), 10, 200)),
            copies: Math.max(1, parseInt(source.copies, 10) || defaults.copies),
            collate: source.collate !== false,
            displayHeaderFooter: !!source.displayHeaderFooter,
            printBackground: source.printBackground !== false,
            orientation: allowedOrientations.includes(source.orientation) ? source.orientation : defaults.orientation
        };
    }

    function getPrintPresetState() {
        if (typeof Settings?.getPrintPresets === 'function') {
            return Settings.getPrintPresets();
        }
        return { items: [], selectedByView: {} };
    }

    async function savePrintPresetState(state) {
        if (typeof Settings?.savePrintPresets === 'function') {
            await Settings.savePrintPresets(state);
            return;
        }
        await Persistence.setSetting('settings_printPresets', JSON.stringify(state || { items: [], selectedByView: {} }));
    }

    function getCurrentViewPresets(state = getPrintPresetState()) {
        return (state.items || [])
            .filter((item) => item.viewType === currentViewType)
            .sort((left, right) => left.name.localeCompare(right.name));
    }

    function findPresetById(state, presetId) {
        if (!presetId) return null;
        return getCurrentViewPresets(state).find((item) => item.id === presetId) || null;
    }

    function getSelectedPresetForView(viewType) {
        const state = getPrintPresetState();
        const presetId = String(state.selectedByView?.[viewType] || '');
        if (!presetId) return null;
        return (state.items || []).find((item) => item.viewType === viewType && item.id === presetId) || null;
    }

    function buildPrintSettingsFromPreset(viewType, presetValue = {}) {
        const preset = normalizePresetConfig(viewType, {
            ...(presetValue || {}),
            destination: 'print'
        });
        const paperSizeName = preset.paperSizeName || 'A4';
        const orientation = (preset.orientation || getDefaultPresetSettings(viewType).orientation || 'portrait').toLowerCase();
        const isLandscape = orientation === 'landscape';
        const size = PAPER_SIZES_MM[paperSizeName] || PAPER_SIZES_MM.A4;
        const sheetSizeMm = isLandscape
            ? { width: size.height, height: size.width }
            : { width: size.width, height: size.height };
        const marginsMode = preset.marginsMode || 'default';
        const marginsMm = marginsMode === 'custom'
            ? {
                top: Math.max(0, parseFloat(preset.marginTop || '0') || 0),
                right: Math.max(0, parseFloat(preset.marginRight || '0') || 0),
                bottom: Math.max(0, parseFloat(preset.marginBottom || '0') || 0),
                left: Math.max(0, parseFloat(preset.marginLeft || '0') || 0)
            }
            : { ...(MARGIN_PRESETS_MM[marginsMode] || MARGIN_PRESETS_MM.default) };
        const scaleMode = preset.scaleMode || 'default';
        const scale = scaleMode === 'custom'
            ? clamp((parseFloat(preset.scaleCustom || '100') || 100) / 100, 0.1, 2)
            : 1;

        return {
            destination: 'print',
            paperSizeName,
            orientation,
            landscape: isLandscape,
            sheetSizeMm,
            marginsMode,
            marginsMm,
            scaleMode,
            scale,
            pagesPerSheet: Math.max(1, parseInt(preset.pagesPerSheet, 10) || 1),
            colorMode: preset.colorMode === 'bw' ? 'bw' : 'color',
            printBackground: preset.printBackground !== false,
            displayHeaderFooter: !!preset.displayHeaderFooter,
            copies: viewType === 'barcode' ? 1 : Math.max(1, parseInt(preset.copies, 10) || 1),
            collate: preset.collate !== false,
            pageSelection: { mode: 'all', custom: '' },
            pageCssSize: `${paperSizeName} ${orientation}`
        };
    }

    function buildPresetSettingsFromUi() {
        return normalizePresetConfig(currentViewType, {
            destination: document.getElementById('pd-destination')?.value || '',
            colorMode: document.getElementById('pd-color')?.value || '',
            paperSizeName: document.getElementById('pd-paper-size')?.value || '',
            pagesPerSheet: document.getElementById('pd-pages-per-sheet')?.value || '',
            marginsMode: document.getElementById('pd-margins')?.value || '',
            marginTop: document.getElementById('pd-margin-top')?.value || '',
            marginRight: document.getElementById('pd-margin-right')?.value || '',
            marginBottom: document.getElementById('pd-margin-bottom')?.value || '',
            marginLeft: document.getElementById('pd-margin-left')?.value || '',
            scaleMode: document.getElementById('pd-scale')?.value || '',
            scaleCustom: document.getElementById('pd-scale-custom')?.value || '',
            copies: currentViewType === 'barcode' ? '1' : (document.getElementById('pd-copies')?.value || ''),
            collate: !!document.getElementById('pd-collate')?.checked,
            displayHeaderFooter: !!document.getElementById('pd-headers-footers')?.checked,
            printBackground: !!document.getElementById('pd-background')?.checked,
            orientation: document.getElementById('pd-layout')?.value || ''
        });
    }

    function setSelectValue(id, value) {
        const element = document.getElementById(id);
        if (element) element.value = value;
    }

    function setInputValue(id, value) {
        const element = document.getElementById(id);
        if (element) element.value = value;
    }

    function setCheckboxValue(id, checked) {
        const element = document.getElementById(id);
        if (element) element.checked = !!checked;
    }

    function setLayoutValue(layoutValue) {
        const normalized = layoutValue === 'landscape' ? 'landscape' : 'portrait';
        const hiddenInput = document.getElementById('pd-layout');
        if (hiddenInput) hiddenInput.value = normalized;

        const layoutToggle = document.getElementById('pd-layout-toggle');
        if (layoutToggle) {
            layoutToggle.querySelectorAll('.layout-btn').forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.value === normalized);
            });
        }
    }

    function applyPresetSettingsToUi(value) {
        const preset = normalizePresetConfig(currentViewType, value);
        setSelectValue('pd-destination', preset.destination);
        setSelectValue('pd-color', preset.colorMode);
        setSelectValue('pd-paper-size', preset.paperSizeName);
        setSelectValue('pd-pages-per-sheet', String(preset.pagesPerSheet));
        setSelectValue('pd-margins', preset.marginsMode);
        setInputValue('pd-margin-top', preset.marginTop);
        setInputValue('pd-margin-right', preset.marginRight);
        setInputValue('pd-margin-bottom', preset.marginBottom);
        setInputValue('pd-margin-left', preset.marginLeft);
        setSelectValue('pd-scale', preset.scaleMode);
        setInputValue('pd-scale-custom', preset.scaleCustom);
        setInputValue('pd-copies', String(preset.copies));
        setCheckboxValue('pd-collate', preset.collate);
        setCheckboxValue('pd-headers-footers', preset.displayHeaderFooter);
        setCheckboxValue('pd-background', preset.printBackground);
        setLayoutValue(preset.orientation);
    }

    function syncPresetControls(selectedPresetId = null) {
        const select = document.getElementById('pd-preset-select');
        const nameInput = document.getElementById('pd-preset-name');
        const deleteBtn = document.getElementById('pd-preset-delete');
        const hint = document.getElementById('pd-preset-hint');
        if (!select || !nameInput || !deleteBtn || !hint) return;

        const state = getPrintPresetState();
        const presets = getCurrentViewPresets(state);
        const savedSelection = selectedPresetId == null
            ? String(state.selectedByView?.[currentViewType] || '')
            : String(selectedPresetId || '');
        const activePreset = presets.find((preset) => preset.id === savedSelection) || null;
        const viewLabel = getViewTypeLabel();

        select.innerHTML = '<option value="">Default settings</option>' + presets.map((preset) => (
            `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`
        )).join('');
        select.value = activePreset ? activePreset.id : '';
        nameInput.value = activePreset ? activePreset.name : '';
        nameInput.placeholder = `Save ${viewLabel.toLowerCase()} preset`;
        deleteBtn.disabled = !activePreset;
        hint.textContent = activePreset
            ? `${viewLabel} preset auto-applies each time you open this dialog.`
            : `Save reusable ${viewLabel.toLowerCase()} print settings for one-click reuse.`;
    }

    function initializePresetControls() {
        const state = getPrintPresetState();
        const selectedPresetId = String(state.selectedByView?.[currentViewType] || '');
        const preset = findPresetById(state, selectedPresetId);
        syncPresetControls(preset ? preset.id : '');
        if (preset) {
            applyPresetSettingsToUi(preset.settings);
        }
    }

    async function handlePresetSelectionChange() {
        const select = document.getElementById('pd-preset-select');
        if (!select) return;

        const nextPresetId = String(select.value || '');
        const state = getPrintPresetState();
        state.selectedByView = {
            ...(state.selectedByView || {}),
            [currentViewType]: nextPresetId
        };
        await savePrintPresetState(state);

        const preset = findPresetById(state, nextPresetId);
        if (preset) {
            applyPresetSettingsToUi(preset.settings);
        } else {
            resetPresetManagedFields(currentViewType);
        }

        syncPresetControls(preset ? preset.id : '');
        handleSettingChange('pd-destination');
        handleSettingChange('pd-margins');
        handleSettingChange('pd-scale');
        await refreshPreview();
    }

    async function handlePresetSave() {
        const nameInput = document.getElementById('pd-preset-name');
        const select = document.getElementById('pd-preset-select');
        if (!nameInput || !select) return;

        const name = String(nameInput.value || '').trim();
        if (!name) {
            Notification.show('Enter a preset name first.', 'warning');
            nameInput.focus();
            return;
        }

        const state = getPrintPresetState();
        const selectedPresetId = String(select.value || '');
        const selectedPreset = findPresetById(state, selectedPresetId);
        const matchingNamePreset = getCurrentViewPresets(state).find((preset) => (
            preset.name.toLowerCase() === name.toLowerCase()
        ));
        const presetSettings = buildPresetSettingsFromUi();
        let targetPreset = null;
        let created = false;

        if (selectedPreset) {
            targetPreset = {
                ...selectedPreset,
                name,
                settings: presetSettings
            };
            state.items = (state.items || []).map((preset) => preset.id === targetPreset.id ? targetPreset : preset);
        } else if (matchingNamePreset) {
            const confirmed = window.confirm(`Overwrite the existing "${matchingNamePreset.name}" preset?`);
            if (!confirmed) return;
            targetPreset = {
                ...matchingNamePreset,
                name,
                settings: presetSettings
            };
            state.items = (state.items || []).map((preset) => preset.id === targetPreset.id ? targetPreset : preset);
        } else {
            targetPreset = {
                id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                viewType: currentViewType,
                name,
                settings: presetSettings
            };
            state.items = [...(state.items || []), targetPreset];
            created = true;
        }

        state.selectedByView = {
            ...(state.selectedByView || {}),
            [currentViewType]: targetPreset.id
        };
        await savePrintPresetState(state);
        syncPresetControls(targetPreset.id);
        Notification.show(created ? 'Print preset saved.' : 'Print preset updated.', 'success');
    }

    async function handlePresetDelete() {
        const select = document.getElementById('pd-preset-select');
        if (!select) return;

        const presetId = String(select.value || '');
        if (!presetId) {
            Notification.show('Select a saved preset to delete.', 'info');
            return;
        }

        const state = getPrintPresetState();
        const preset = findPresetById(state, presetId);
        if (!preset) return;

        const confirmed = window.confirm(`Delete the "${preset.name}" preset?`);
        if (!confirmed) return;

        state.items = (state.items || []).filter((item) => item.id !== preset.id);
        state.selectedByView = {
            ...(state.selectedByView || {}),
            [currentViewType]: ''
        };
        await savePrintPresetState(state);
        syncPresetControls('');
        Notification.show('Print preset deleted.', 'success');
    }

    function initGlobalShortcuts() {
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                const sellWorkspace = document.getElementById('sell-workspace');
                if (!sellWorkspace || sellWorkspace.style.display === 'none') {
                    Notification.show(`Open an invoice or ${RAPID_ORDER_SHEET_LABEL.toLowerCase()} to print.`, 'info');
                    return;
                }
                const activeView = Sell.getView ? Sell.getView() : 'invoice';
                startPrintFlow(activeView);
            }
        });
    }

    function initListeners() {
        if (listenersInitialized) return;
        listenersInitialized = true;

        populateBarcodePrinterTypeOptions();

        const layoutToggle = document.getElementById('pd-layout-toggle');
        if (layoutToggle) {
            layoutToggle.querySelectorAll('.layout-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    layoutToggle.querySelectorAll('.layout-btn').forEach(node => node.classList.remove('active'));
                    btn.classList.add('active');
                    const hiddenInput = document.getElementById('pd-layout');
                    if (hiddenInput) hiddenInput.value = btn.dataset.value;
                    debouncedRefresh();
                });
            });
        }

        const barcodePrinterType = document.getElementById('pd-barcode-printer-type');
        if (barcodePrinterType) {
            barcodePrinterType.addEventListener('change', () => {
                applyBarcodePrinterProfileToUi(barcodePrinterType.value);
                debouncedRefresh();
            });
        }

        const moreSettingsBtn = document.getElementById('pd-more-settings-toggle');
        const advancedSection = document.getElementById('pd-advanced-settings');
        if (moreSettingsBtn && advancedSection) {
            moreSettingsBtn.addEventListener('click', () => {
                const isOpen = advancedSection.style.display !== 'none';
                advancedSection.style.display = isOpen ? 'none' : 'block';
                moreSettingsBtn.classList.toggle('open', !isOpen);
            });
        }

        document.getElementById('pd-preset-select')?.addEventListener('change', () => {
            void handlePresetSelectionChange();
        });
        document.getElementById('pd-preset-save')?.addEventListener('click', () => {
            void handlePresetSave();
        });
        document.getElementById('pd-preset-delete')?.addEventListener('click', () => {
            void handlePresetDelete();
        });
        document.getElementById('pd-preset-name')?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                void handlePresetSave();
            }
        });

        [
            'pd-destination',
            'pd-pages-select',
            'pd-color',
            'pd-paper-size',
            'pd-pages-per-sheet',
            'pd-margins',
            'pd-scale',
            'pd-copies',
            'pd-pages-custom',
            'pd-scale-custom',
            'pd-margin-top',
            'pd-margin-bottom',
            'pd-margin-left',
            'pd-margin-right',
            'pd-collate',
            'pd-headers-footers',
            'pd-background'
        ].forEach(id => {
            const element = document.getElementById(id);
            if (!element) return;
            const eventType = (element.tagName === 'SELECT' || element.type === 'checkbox') ? 'change' : 'input';
            element.addEventListener(eventType, () => {
                handleSettingChange(id);
                debouncedRefresh();
            });
        });

        document.getElementById('pd-cancel-btn')?.addEventListener('click', closeDialog);
        document.getElementById('print-dialog-close')?.addEventListener('click', closeDialog);
        document.getElementById('pd-print-btn')?.addEventListener('click', executeFinalPrint);

        window.addEventListener('keydown', handleOverlayKeydown);
    }

    function handleOverlayKeydown(e) {
        const overlay = document.getElementById('print-dialog-overlay');
        if (!overlay || overlay.style.display === 'none') return;

        if (e.key === 'Enter' && !e.target.closest('textarea') && e.target.id !== 'pd-preset-name') {
            executeFinalPrint();
        } else if (e.key === 'Escape') {
            closeDialog();
        }
    }

    function handleSettingChange(id) {
        if (id === 'pd-destination') {
            const destination = document.getElementById('pd-destination')?.value || 'pdf';
            const copiesGroup = document.getElementById('pd-copies-group');
            const printBtn = document.getElementById('pd-print-btn');
            const isPdf = destination === 'pdf';
            const showCopies = !isPdf && currentViewType !== 'barcode';

            if (copiesGroup) copiesGroup.style.display = showCopies ? 'block' : 'none';
            if (printBtn) printBtn.textContent = isPdf ? 'Save Document' : 'Print Document';
        }

        if (id === 'pd-pages-select') {
            const value = document.getElementById('pd-pages-select')?.value || 'all';
            const customInput = document.getElementById('pd-pages-custom');
            if (customInput) customInput.style.display = value === 'custom' ? 'block' : 'none';
        }

        if (id === 'pd-margins') {
            const value = document.getElementById('pd-margins')?.value || 'default';
            const customUi = document.getElementById('pd-margins-custom-ui');
            if (customUi) customUi.style.display = value === 'custom' ? 'grid' : 'none';
        }

        if (id === 'pd-scale') {
            const value = document.getElementById('pd-scale')?.value || 'default';
            const customInput = document.getElementById('pd-scale-custom');
            if (customInput) customInput.style.display = value === 'custom' ? 'block' : 'none';
        }
    }

    function debouncedRefresh() {
        if (refreshTimeout) clearTimeout(refreshTimeout);
        refreshTimeout = setTimeout(() => {
            refreshPreview();
        }, 250);
    }

    function resetDialogSettings(viewType) {
        resetPresetManagedFields(viewType);

        const pagesSelect = document.getElementById('pd-pages-select');
        if (pagesSelect) pagesSelect.value = 'all';

        const pagesCustom = document.getElementById('pd-pages-custom');
        if (pagesCustom) pagesCustom.value = '';

        if (viewType === 'barcode') {
            applyBarcodePrinterProfileToUi(DEFAULT_BARCODE_PRINTER_PROFILE_ID);
            return;
        }

        updateBarcodePrinterUi();
    }

    function resetPresetManagedFields(viewType) {
        const defaults = getDefaultPresetSettings(viewType);

        const destination = document.getElementById('pd-destination');
        if (destination) destination.value = defaults.destination;

        const paperSize = document.getElementById('pd-paper-size');
        if (paperSize) paperSize.value = defaults.paperSizeName;

        const pagesPerSheet = document.getElementById('pd-pages-per-sheet');
        if (pagesPerSheet) pagesPerSheet.value = String(defaults.pagesPerSheet);

        const color = document.getElementById('pd-color');
        if (color) color.value = defaults.colorMode;

        const margins = document.getElementById('pd-margins');
        if (margins) margins.value = defaults.marginsMode;

        const scale = document.getElementById('pd-scale');
        if (scale) scale.value = defaults.scaleMode;

        const copies = document.getElementById('pd-copies');
        if (copies) copies.value = String(defaults.copies);

        const scaleCustom = document.getElementById('pd-scale-custom');
        if (scaleCustom) scaleCustom.value = defaults.scaleCustom;

        ['pd-margin-top', 'pd-margin-right', 'pd-margin-bottom', 'pd-margin-left'].forEach((id) => {
            const input = document.getElementById(id);
            if (input) input.value = '';
        });

        const collate = document.getElementById('pd-collate');
        if (collate) collate.checked = defaults.collate;

        const headersFooters = document.getElementById('pd-headers-footers');
        if (headersFooters) headersFooters.checked = defaults.displayHeaderFooter;

        const background = document.getElementById('pd-background');
        if (background) background.checked = defaults.printBackground;

        setLayoutValue(defaults.orientation);
    }

    async function startPrintFlow(viewType, options = {}) {
        currentViewType = viewType;
        currentPrintPayload = { ...(options || {}) };
        currentPendingDeductions = null;

        if (viewType === 'barcode') {
            if (!Array.isArray(options.labels) || options.labels.length === 0) {
                Notification.show('Select barcodes to print.', 'warning');
                return;
            }
        } else {
            if (!options.snapshot) {
                const workspace = document.getElementById('sell-workspace');
                if (!workspace || !workspace.querySelector('.invoice-pages-wrapper')) {
                    Notification.show('No content to print.', 'warning');
                    return;
                }
            }

            if (viewType === 'invoice' && !options.skipDeduction) {
                const barcodeUpdateState = await Sell.resolveInvoiceBarcodeUpdatesBeforePrint();
                if (!barcodeUpdateState?.proceed) return;
                const deductionState = await showStockDeductionModal();
                if (!deductionState.proceed) return;
                currentPendingDeductions = deductionState.deductions;
            }
        }

        initListeners();
        populateBarcodePrinterTypeOptions();

        const overlay = document.getElementById('print-dialog-overlay');
        if (overlay) overlay.style.display = 'flex';

        resetDialogSettings(viewType);
        updateBarcodePrinterUi();
        handleSettingChange('pd-destination');
        handleSettingChange('pd-pages-select');
        handleSettingChange('pd-margins');
        handleSettingChange('pd-scale');

        await refreshPreview();
    }

    function normalizePrintSettings() {
        const barcodeProfile = currentViewType === 'barcode' ? getSelectedBarcodePrinterProfile() : null;
        const paperSizeName = barcodeProfile?.paperSizeName || document.getElementById('pd-paper-size')?.value || 'A4';
        const orientation = (barcodeProfile?.orientation || document.getElementById('pd-layout')?.value || 'portrait').toLowerCase();
        const marginsMode = document.getElementById('pd-margins')?.value || 'default';
        const scaleMode = document.getElementById('pd-scale')?.value || 'default';
        const pagesPerSheet = barcodeProfile
            ? 1
            : Math.max(1, parseInt(document.getElementById('pd-pages-per-sheet')?.value || '1', 10));
        const destination = document.getElementById('pd-destination')?.value || 'pdf';
        const colorMode = document.getElementById('pd-color')?.value === 'bw' ? 'bw' : 'color';
        const isLandscape = orientation === 'landscape';
        const size = PAPER_SIZES_MM[paperSizeName] || PAPER_SIZES_MM.A4;
        const profileSheetSize = barcodeProfile?.paperSizeMm || null;
        const sheetSizeMm = profileSheetSize
            ? { width: profileSheetSize.width, height: profileSheetSize.height }
            : (isLandscape
                ? { width: size.height, height: size.width }
                : { width: size.width, height: size.height });
        const pageCssSize = profileSheetSize
            ? `${sheetSizeMm.width}mm ${sheetSizeMm.height}mm`
            : `${paperSizeName} ${orientation}`;
        const pageSizeValue = profileSheetSize
            ? {
                width: Math.round(sheetSizeMm.width * 1000),
                height: Math.round(sheetSizeMm.height * 1000)
            }
            : paperSizeName;

        return {
            destination,
            paperSizeName,
            orientation,
            landscape: isLandscape,
            sheetSizeMm,
            marginsMode,
            marginsMm: resolveMarginsMm(marginsMode),
            scaleMode,
            scale: resolveScale(scaleMode),
            pagesPerSheet,
            colorMode,
            printBackground: !!document.getElementById('pd-background')?.checked,
            displayHeaderFooter: !!document.getElementById('pd-headers-footers')?.checked,
            copies: currentViewType === 'barcode'
                ? 1
                : Math.max(1, parseInt(document.getElementById('pd-copies')?.value || '1', 10)),
            collate: !!document.getElementById('pd-collate')?.checked,
            pageSelection: {
                mode: document.getElementById('pd-pages-select')?.value || 'all',
                custom: (document.getElementById('pd-pages-custom')?.value || '').trim()
            },
            pageCssSize,
            pageSizeValue
        };
    }

    function buildSharePrintSettings(viewType) {
        const paperSizeName = 'A4';
        const orientation = viewType === 'letterhead' ? 'landscape' : 'portrait';
        const size = PAPER_SIZES_MM[paperSizeName] || PAPER_SIZES_MM.A4;
        const isLandscape = orientation === 'landscape';
        const sheetSizeMm = isLandscape
            ? { width: size.height, height: size.width }
            : { width: size.width, height: size.height };

        return {
            destination: 'pdf',
            paperSizeName,
            orientation,
            landscape: isLandscape,
            sheetSizeMm,
            marginsMode: 'none',
            marginsMm: { ...MARGIN_PRESETS_MM.none },
            scaleMode: 'default',
            scale: 1,
            pagesPerSheet: 1,
            colorMode: 'color',
            printBackground: true,
            displayHeaderFooter: false,
            copies: 1,
            collate: true,
            pageSelection: {
                mode: 'all',
                custom: ''
            },
            pageCssSize: `${paperSizeName} ${orientation}`
        };
    }

    function resolveMarginsMm(mode) {
        if (mode === 'custom') {
            return {
                top: Math.max(0, parseFloat(document.getElementById('pd-margin-top')?.value || '0') || 0),
                right: Math.max(0, parseFloat(document.getElementById('pd-margin-right')?.value || '0') || 0),
                bottom: Math.max(0, parseFloat(document.getElementById('pd-margin-bottom')?.value || '0') || 0),
                left: Math.max(0, parseFloat(document.getElementById('pd-margin-left')?.value || '0') || 0)
            };
        }

        return { ...(MARGIN_PRESETS_MM[mode] || MARGIN_PRESETS_MM.default) };
    }

    function resolveScale(scaleMode) {
        if (scaleMode === 'custom') {
            const raw = parseFloat(document.getElementById('pd-scale-custom')?.value || '100') || 100;
            return clamp(raw / 100, 0.1, 2);
        }

        if (scaleMode === 'fit') {
            return 1;
        }

        return 1;
    }

    async function refreshPreview() {
        const refreshId = ++refreshGeneration;
        showLoading(true);

        try {
            const job = await composePrintJobFromUi();
            if (refreshId !== refreshGeneration) return;

            currentJob = job;
            currentPdfBuffer = null;
            await renderPreview(job, refreshId);
        } catch (error) {
            console.error('Preview generation failed:', error);
            currentPdfBuffer = null;
            currentJob = null;
            renderPreviewError(error.message || 'Unable to generate preview.');
        } finally {
            if (refreshId === refreshGeneration) showLoading(false);
        }
    }

    async function composePrintJobFromUi() {
        const snapshot = currentPrintPayload?.snapshot
            || (currentViewType === 'barcode'
                ? getBarcodePrintSnapshot(currentPrintPayload?.labels || [], getSelectedBarcodePrinterProfile().id)
                : (Sell.getPrintSnapshot ? Sell.getPrintSnapshot(currentViewType) : null));
        if (!snapshot) {
            throw new Error('No printable content is available.');
        }

        const settings = normalizePrintSettings();
        return composePrintJob(snapshot, settings);
    }

    async function composePrintJob(snapshot, settings) {
        await waitForPrintAssets(snapshot);

        const dimensions = buildDimensions(settings);
        const composition = buildComposition(snapshot, settings, dimensions);
        const root = renderPrintJob(snapshot, settings, dimensions, composition.pages);

        const job = {
            snapshot,
            settings,
            dimensions,
            pages: composition.pages,
            totalLogicalPages: composition.totalLogicalPages,
            root
        };

        applyComposedPrintDocument(job);
        job.sheetCount = job.root.querySelectorAll('.print-sheet').length;
        const documents = buildPrintDocuments(job);
        job.htmlContent = documents.printHtml;
        job.previewHtml = documents.previewHtml;
        job.printRequest = buildPrintServiceConfig(job, false);
        job.pdfRequest = buildPrintServiceConfig(job, true);
        return job;
    }

    async function exportSnapshotToPdf(snapshot, options = {}) {
        if (!snapshot) {
            throw new Error('No printable snapshot is available.');
        }
        if (!window.electronAPI?.generateCustomPrintPdf) {
            throw new Error('PDF export is not available in this environment.');
        }

        const preset = options.preset || 'share';
        const settings = preset === 'share'
            ? buildSharePrintSettings(snapshot.viewType)
            : buildSharePrintSettings(snapshot.viewType);
        const job = await composePrintJob(snapshot, settings);
        const pdfBuffer = await window.electronAPI.generateCustomPrintPdf(job.pdfRequest);

        if (!pdfBuffer) {
            throw new Error('PDF generation returned no data.');
        }

        return toUint8Array(pdfBuffer);
    }

    function buildDefaultPdfFileName(viewType = currentViewType) {
        const baseName = viewType === 'letterhead'
            ? 'rapid-order-sheet'
            : (viewType || 'document');
        return `${baseName}_${new Date().toISOString().slice(0, 10)}.pdf`;
    }

    async function savePdfBytesWithDialog(pdfBytes, options = {}) {
        const binaryData = toUint8Array(pdfBytes);
        const result = await window.electronAPI.showSaveDialog({
            defaultPath: options.defaultPath || buildDefaultPdfFileName(options.viewType),
            filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
        });

        if (!result || !result.filePath) {
            return { canceled: true, filePath: '' };
        }

        const saveResult = await window.electronAPI.writeFile(result.filePath, binaryData);
        if (!saveResult?.success) {
            throw new Error(saveResult?.error || 'Unable to save the PDF file.');
        }

        return {
            canceled: false,
            filePath: result.filePath
        };
    }

    async function saveSnapshotAsPdf(snapshot, options = {}) {
        if (!snapshot) {
            throw new Error('No printable snapshot is available.');
        }

        const pdfBytes = await exportSnapshotToPdf(snapshot, options);
        return savePdfBytesWithDialog(pdfBytes, {
            defaultPath: options.defaultPath || buildDefaultPdfFileName(snapshot.viewType),
            viewType: snapshot.viewType || currentViewType
        });
    }

    async function quickPrintCurrentView(viewType, options = {}) {
        const preset = getSelectedPresetForView(viewType);
        if (!preset) {
            Notification.show(`Save a ${getViewTypeLabel(viewType).toLowerCase()} print preset before using Quick Print.`, 'info');
            return false;
        }

        const preferredPrinter = resolvePreferredPrinterName(viewType);
        if (!preferredPrinter) {
            Notification.show('Choose a preferred printer in Settings before using Quick Print.', 'warning');
            return false;
        }

        currentViewType = viewType;
        currentPrintPayload = { ...(options || {}) };
        currentPendingDeductions = null;
        showLoading(true);

        try {
            let snapshot = options.snapshot || null;
            if (!snapshot) {
                snapshot = viewType === 'barcode'
                    ? getBarcodePrintSnapshot(options.labels || [], getSelectedBarcodePrinterProfile().id)
                    : (Sell.getPrintSnapshot ? Sell.getPrintSnapshot(viewType) : null);
            }
            if (!snapshot) {
                Notification.show('No content is available to print.', 'warning');
                return false;
            }

            if (viewType === 'invoice' && !options.skipDeduction) {
                const barcodeUpdateState = await Sell.resolveInvoiceBarcodeUpdatesBeforePrint();
                if (!barcodeUpdateState?.proceed) {
                    return false;
                }
                const deductionState = await showStockDeductionModal();
                if (!deductionState.proceed) {
                    return false;
                }
                currentPendingDeductions = deductionState.deductions;
            }

            const settings = buildPrintSettingsFromPreset(viewType, preset.settings);
            const job = await composePrintJob(snapshot, settings);
            currentJob = job;
            await handleDirectPrint(job);
            return true;
        } catch (error) {
            console.error('Quick print failed:', error);
            Notification.show(`Quick print failed: ${error.message}`, 'error');
            return false;
        } finally {
            showLoading(false);
        }
    }

    function buildDimensions(settings) {
        const sheetWidthMm = settings.sheetSizeMm.width;
        const sheetHeightMm = settings.sheetSizeMm.height;
        const innerWidthMm = Math.max(40, sheetWidthMm - settings.marginsMm.left - settings.marginsMm.right);
        const innerHeightMm = Math.max(40, sheetHeightMm - settings.marginsMm.top - settings.marginsMm.bottom);

        return {
            sheetWidthMm,
            sheetHeightMm,
            innerWidthMm,
            innerHeightMm,
            contentWidthPx: mmToPx(innerWidthMm / settings.scale),
            contentHeightPx: mmToPx(innerHeightMm / settings.scale)
        };
    }

    function buildComposition(snapshot, settings, dimensions) {
        const livePages = buildLivePreviewPages(snapshot);
        if (snapshot.viewType !== 'barcode' && livePages.length > 0) {
            const filteredPages = filterPagesBySelection(livePages, settings.pageSelection);

            if (filteredPages.length === 0) {
                throw new Error('No pages match the selected page range.');
            }

            return {
                pages: filteredPages,
                totalLogicalPages: livePages.length
            };
        }

        const measure = createMeasureToolkit(snapshot, settings, dimensions);

        try {
            const rawPages = snapshot.viewType === 'invoice'
                ? paginateInvoice(snapshot, dimensions, measure)
                : snapshot.viewType === 'letterhead'
                    ? paginateLetterhead(snapshot, dimensions, measure)
                    : paginateBarcode(snapshot);
            const filteredPages = filterPagesBySelection(rawPages, settings.pageSelection);

            if (filteredPages.length === 0) {
                throw new Error('No pages match the selected page range.');
            }

            return {
                pages: filteredPages,
                totalLogicalPages: rawPages.length
            };
        } finally {
            measure.cleanup();
        }
    }

    function createMeasureToolkit(snapshot, settings, dimensions) {
        const printContainer = document.getElementById('print-container');
        const measureRoot = document.createElement('div');
        measureRoot.className = 'print-measure-root';

        const frame = document.createElement('div');
        frame.className = buildFrameClassName(settings);
        frame.style.width = `${dimensions.contentWidthPx}px`;
        measureRoot.appendChild(frame);
        printContainer.appendChild(measureRoot);

        return {
            cleanup() {
                measureRoot.remove();
            },
            measureFragment(html) {
                frame.innerHTML = `<div class="print-measure-fragment">${html || ''}</div>`;
                return frame.firstElementChild?.getBoundingClientRect().height || 0;
            },
            measureTableHead(tableClassName, theadHtml) {
                frame.innerHTML = `<div class="inv-table-wrap"><table class="${escapeHtml(tableClassName)}">${theadHtml}<tbody></tbody></table></div>`;
                return frame.querySelector('thead')?.getBoundingClientRect().height || 0;
            },
            measureTableRow(tableClassName, theadHtml, rowHtml) {
                frame.innerHTML = `<div class="inv-table-wrap"><table class="${escapeHtml(tableClassName)}">${theadHtml}<tbody>${rowHtml}</tbody></table></div>`;
                return frame.querySelector('tbody tr')?.getBoundingClientRect().height || 0;
            }
        };
    }

    function paginateInvoice(snapshot, dimensions, measure) {
        const sections = getItemSections(snapshot);
        const totals = computeInvoiceTotals(snapshot.document);
        const totalsOverride = normalizeInvoiceTotalsOverride(snapshot.document?.totalsOverride);
        const tableClassName = snapshot.fragments.tableClassName;
        const tableHeadHtml = snapshot.fragments.tableHeadHtml;
        const headerHeight = measure.measureFragment(snapshot.fragments.headerHtml);
        const footerHeight = measure.measureFragment(buildInvoiceFooterMarkup(snapshot, 1));
        const tableHeadHeight = measure.measureTableHead(tableClassName, tableHeadHtml);
        const subtotalHeight = measure.measureTableRow(tableClassName, tableHeadHtml, buildInvoiceSubtotalRowMarkup(0));
        const blankRowHeight = Math.max(1, measure.measureTableRow(tableClassName, tableHeadHtml, buildInvoiceBlankRowMarkup(1)));
        const totalsHeight = measure.measureFragment(
            buildInvoiceTotalsMarkup(
                snapshot.amountWordsText || snapshot.document?.amountWordsText || InvoiceMath.amountInWords(Math.max(0, totals.payable)),
                0,
                0,
                totals.payable,
                totals.discount,
                totalsOverride
            )
        );
        const regularBudget = dimensions.contentHeightPx - headerHeight - footerHeight - tableHeadHeight - subtotalHeight;
        const finalBudget = regularBudget - totalsHeight;

        if (regularBudget <= 0 || finalBudget <= 0) {
            throw new Error('Selected paper size, margins, or scale leave no room for the invoice layout.');
        }

        const pages = [];
        let serial = 1;

        sections.forEach((items, sectionId) => {
            const rows = items.map(item => {
                const row = {
                    item,
                    serial,
                    totalFils: rowTotalFils(item),
                    height: measure.measureTableRow(tableClassName, tableHeadHtml, buildInvoiceItemRowMarkup(item, serial))
                };
                serial += 1;
                return row;
            });

            if (rows.length === 0) {
                pages.push({ sectionId, rows: [] });
                return;
            }

            let index = 0;
            while (index < rows.length) {
                const pageRows = [];
                let usedHeight = 0;

                while (index < rows.length) {
                    const nextRow = rows[index];
                    if (pageRows.length > 0 && usedHeight + nextRow.height > regularBudget) break;
                    pageRows.push(nextRow);
                    usedHeight += nextRow.height;
                    index += 1;
                    if (usedHeight >= regularBudget) break;
                }

                if (pageRows.length === 0) {
                    pageRows.push(rows[index]);
                    index += 1;
                }

                pages.push({ sectionId, rows: pageRows });
            }
        });

        if (pages.length === 0) {
            pages.push({ sectionId: 0, rows: [] });
        }

        rebalanceInvoiceFinalSection(pages, regularBudget, finalBudget);

        let previousPagesTotal = 0;
        return pages.map((page, index) => {
            const pageSubtotal = page.rows.reduce((sum, row) => sum + row.totalFils, 0);
            const availableBudget = index === pages.length - 1 ? finalBudget : regularBudget;
            const usedHeight = page.rows.reduce((sum, row) => sum + row.height, 0);
            const descriptor = {
                type: 'invoice',
                pageNumber: index + 1,
                isFinal: index === pages.length - 1,
                rows: page.rows,
                pageSubtotal,
                previousPagesTotal,
                blankRowCount: Math.max(0, Math.floor(Math.max(0, availableBudget - usedHeight) / blankRowHeight))
            };

            previousPagesTotal += pageSubtotal;
            return descriptor;
        });
    }

    function paginateLetterhead(snapshot, dimensions, measure) {
        const sections = getItemSections(snapshot);
        const tableClassName = snapshot.fragments.tableClassName;
        const tableHeadHtml = snapshot.fragments.tableHeadHtml;
        const headerHeight = measure.measureFragment(snapshot.fragments.headerHtml);
        const footerHeight = measure.measureFragment(snapshot.fragments.footerHtml);
        const tableHeadHeight = measure.measureTableHead(tableClassName, tableHeadHtml);
        const blankRowHeight = Math.max(1, measure.measureTableRow(tableClassName, tableHeadHtml, buildLetterheadBlankRowMarkup(1)));
        const pageBudget = dimensions.contentHeightPx - headerHeight - footerHeight - tableHeadHeight;

        if (pageBudget <= 0) {
            throw new Error(`Selected paper size, margins, or scale leave no room for the ${RAPID_ORDER_SHEET_LABEL.toLowerCase()} layout.`);
        }

        const pages = [];
        let serial = 1;

        sections.forEach((items, sectionId) => {
            const rows = items.map(item => {
                const row = {
                    item,
                    serial,
                    totalFils: rowTotalFils(item),
                    height: measure.measureTableRow(tableClassName, tableHeadHtml, buildLetterheadItemRowMarkup(item, serial))
                };
                serial += 1;
                return row;
            });

            if (rows.length === 0) {
                pages.push({ sectionId, rows: [] });
                return;
            }

            let index = 0;
            while (index < rows.length) {
                const pageRows = [];
                let usedHeight = 0;

                while (index < rows.length) {
                    const nextRow = rows[index];
                    if (pageRows.length > 0 && usedHeight + nextRow.height > pageBudget) break;
                    pageRows.push(nextRow);
                    usedHeight += nextRow.height;
                    index += 1;
                    if (usedHeight >= pageBudget) break;
                }

                if (pageRows.length === 0) {
                    pageRows.push(rows[index]);
                    index += 1;
                }

                pages.push({ sectionId, rows: pageRows });
            }
        });

        if (pages.length === 0) {
            pages.push({ sectionId: 0, rows: [] });
        }

        return pages.map((page, index) => {
            const usedHeight = page.rows.reduce((sum, row) => sum + row.height, 0);
            return {
                type: 'letterhead',
                pageNumber: index + 1,
                rows: page.rows,
                blankRowCount: Math.max(0, Math.floor(Math.max(0, pageBudget - usedHeight) / blankRowHeight))
            };
        });
    }

    function rebalanceInvoiceFinalSection(pages, regularBudget, finalBudget) {
        if (pages.length === 0) return;

        while (sumRowHeights(pages[pages.length - 1].rows) > finalBudget) {
            const lastPage = pages[pages.length - 1];
            const movedRow = lastPage.rows.shift();
            if (!movedRow) break;

            let targetPage = pages[pages.length - 2];
            if (!targetPage || targetPage.sectionId !== lastPage.sectionId || sumRowHeights(targetPage.rows) + movedRow.height > regularBudget) {
                targetPage = { sectionId: lastPage.sectionId, rows: [] };
                pages.splice(pages.length - 1, 0, targetPage);
            }

            targetPage.rows.push(movedRow);
        }
    }

    function paginateBarcode(snapshot) {
        const labels = Array.isArray(snapshot.labels) ? snapshot.labels : [];
        if (labels.length === 0) {
            throw new Error('No barcode labels are available to print.');
        }

        const pages = [];
        const profile = getBarcodePrinterProfile(snapshot.barcodeProfileId);
        const labelsPerSheet = Math.max(1, parseInt(profile.labelsPerSheet, 10) || 1);
        for (let index = 0; index < labels.length; index += labelsPerSheet) {
            pages.push({
                type: 'barcode',
                pageNumber: pages.length + 1,
                labels: labels.slice(index, index + labelsPerSheet),
                barcodeProfileId: profile.id
            });
        }

        return pages;
    }

    function filterPagesBySelection(pages, selection) {
        if (selection.mode === 'all') return pages.slice();
        if (selection.mode === 'odd') return pages.filter(page => page.pageNumber % 2 === 1);
        if (selection.mode === 'even') return pages.filter(page => page.pageNumber % 2 === 0);

        const selectedPages = parseCustomPageSelection(selection.custom, pages.length);
        return pages.filter(page => selectedPages.has(page.pageNumber));
    }

    function parseCustomPageSelection(input, maxPage) {
        if (!input) {
            throw new Error('Enter a page range such as 1-3, 5.');
        }

        const selected = new Set();
        const segments = input.split(',').map(segment => segment.trim()).filter(Boolean);
        if (segments.length === 0) {
            throw new Error('Enter a valid page range.');
        }

        segments.forEach(segment => {
            const rangeMatch = segment.match(/^(\d+)\s*-\s*(\d+)$/);
            if (rangeMatch) {
                let from = parseInt(rangeMatch[1], 10);
                let to = parseInt(rangeMatch[2], 10);
                if (to < from) {
                    const swap = from;
                    from = to;
                    to = swap;
                }
                for (let page = from; page <= to; page += 1) {
                    if (page >= 1 && page <= maxPage) selected.add(page);
                }
                return;
            }

            const single = parseInt(segment, 10);
            if (!Number.isInteger(single)) {
                throw new Error(`Invalid page selection: ${segment}`);
            }
            if (single >= 1 && single <= maxPage) {
                selected.add(single);
            }
        });

        if (selected.size === 0) {
            throw new Error('No pages match the requested range.');
        }
        return selected;
    }

    function renderPrintJob(snapshot, settings, dimensions, pages) {
        const root = document.createElement('div');
        root.className = 'print-job';
        root.style.setProperty('--sheet-width', `${dimensions.sheetWidthMm}mm`);
        root.style.setProperty('--sheet-height', `${dimensions.sheetHeightMm}mm`);

        const sheetList = document.createElement('div');
        sheetList.className = 'print-sheet-list';
        root.appendChild(sheetList);

        const sheets = buildSheetPlan(pages, dimensions, settings.pagesPerSheet);
        sheets.forEach(sheet => {
            sheetList.appendChild(createSheetElement(snapshot, settings, dimensions, sheet));
        });

        if (sheets.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'print-empty-state';
            emptyState.textContent = 'No printable pages were generated.';
            root.appendChild(emptyState);
        }

        return root;
    }

    function buildSheetPlan(pages, dimensions, pagesPerSheet) {
        const layout = resolveNupLayout(pagesPerSheet, dimensions.sheetWidthMm, dimensions.sheetHeightMm);
        const gapMm = pagesPerSheet === 1 ? 0 : 4;
        const paddingMm = pagesPerSheet === 1 ? 0 : 4;
        const cellWidthMm = (dimensions.sheetWidthMm - (paddingMm * 2) - (gapMm * (layout.cols - 1))) / layout.cols;
        const cellHeightMm = (dimensions.sheetHeightMm - (paddingMm * 2) - (gapMm * (layout.rows - 1))) / layout.rows;
        const scale = pagesPerSheet === 1 ? 1 : Math.min(cellWidthMm / dimensions.sheetWidthMm, cellHeightMm / dimensions.sheetHeightMm);
        const sheets = [];

        for (let index = 0; index < pages.length; index += pagesPerSheet) {
            sheets.push({
                pages: pages.slice(index, index + pagesPerSheet),
                layout,
                gapMm,
                paddingMm,
                scale
            });
        }

        return sheets;
    }

    function resolveNupLayout(pagesPerSheet, sheetWidthMm, sheetHeightMm) {
        const isLandscapeSheet = sheetWidthMm > sheetHeightMm;

        switch (pagesPerSheet) {
            case 2:
                return isLandscapeSheet ? { rows: 1, cols: 2 } : { rows: 2, cols: 1 };
            case 4:
                return { rows: 2, cols: 2 };
            case 6:
                return isLandscapeSheet ? { rows: 2, cols: 3 } : { rows: 3, cols: 2 };
            case 9:
                return { rows: 3, cols: 3 };
            case 16:
                return { rows: 4, cols: 4 };
            case 1:
            default:
                return { rows: 1, cols: 1 };
        }
    }

    function createSheetElement(snapshot, settings, dimensions, sheet) {
        const sheetElement = document.createElement('section');
        sheetElement.className = 'print-sheet';
        sheetElement.style.setProperty('--sheet-width', `${dimensions.sheetWidthMm}mm`);
        sheetElement.style.setProperty('--sheet-height', `${dimensions.sheetHeightMm}mm`);

        const surface = document.createElement('div');
        surface.className = 'print-sheet-surface';
        sheetElement.appendChild(surface);

        const grid = document.createElement('div');
        grid.className = `print-sheet-grid${sheet.layout.rows === 1 && sheet.layout.cols === 1 ? ' print-sheet-grid--single' : ''}`;
        grid.style.gridTemplateColumns = `repeat(${sheet.layout.cols}, 1fr)`;
        grid.style.gridTemplateRows = `repeat(${sheet.layout.rows}, 1fr)`;
        grid.style.setProperty('--nup-gap', `${sheet.gapMm}mm`);
        grid.style.setProperty('--nup-padding', `${sheet.paddingMm}mm`);
        surface.appendChild(grid);

        const cellCount = sheet.layout.rows * sheet.layout.cols;
        for (let index = 0; index < cellCount; index += 1) {
            const cell = document.createElement('div');
            cell.className = 'print-sheet-cell';
            grid.appendChild(cell);

            const page = sheet.pages[index];
            if (!page) continue;

            const content = document.createElement('div');
            content.className = 'print-sheet-cell-content';
            content.style.width = `${dimensions.sheetWidthMm * sheet.scale}mm`;
            content.style.height = `${dimensions.sheetHeightMm * sheet.scale}mm`;

            const scaledInner = document.createElement('div');
            scaledInner.style.width = `${dimensions.sheetWidthMm}mm`;
            scaledInner.style.height = `${dimensions.sheetHeightMm}mm`;
            scaledInner.style.transform = `scale(${sheet.scale})`;
            scaledInner.style.transformOrigin = 'top left';

            const template = document.createElement('template');
            template.innerHTML = buildLogicalPageMarkup(snapshot, settings, dimensions, page).trim();
            if (template.content.firstElementChild) {
                scaledInner.appendChild(template.content.firstElementChild);
            }

            content.appendChild(scaledInner);
            cell.appendChild(content);
        }

        return sheetElement;
    }

    function buildLogicalPageMarkup(snapshot, settings, dimensions, page) {
        if (page.type === 'barcode') {
            const styleVars = [
                `--sheet-width:${dimensions.sheetWidthMm}mm`,
                `--sheet-height:${dimensions.sheetHeightMm}mm`,
                `--margin-top:${settings.marginsMm.top}mm`,
                `--margin-right:${settings.marginsMm.right}mm`,
                `--margin-bottom:${settings.marginsMm.bottom}mm`,
                `--margin-left:${settings.marginsMm.left}mm`,
                `--content-scale:${settings.scale}`
            ].join(';');

            return `
                <article class="print-logical-page" style="${styleVars}">
                    <div class="print-page-inner">
                        <div class="print-page-scaled">
                            <div class="${buildFrameClassName(settings)}">
                                ${buildBarcodeSheetMarkup(page, snapshot.barcodeProfile)}
                            </div>
                        </div>
                    </div>
                </article>
            `;
        }

        if (page.domHtml) {
            const styleVars = [
                `--sheet-width:${dimensions.sheetWidthMm}mm`,
                `--sheet-height:${dimensions.sheetHeightMm}mm`,
                `--margin-top:${settings.marginsMm.top}mm`,
                `--margin-right:${settings.marginsMm.right}mm`,
                `--margin-bottom:${settings.marginsMm.bottom}mm`,
                `--margin-left:${settings.marginsMm.left}mm`,
                `--content-scale:${settings.scale}`
            ].join(';');
            const pageClassName = escapeHtml(page.pageClassName || defaultPageClassName(page.type));

            return `
                <article class="print-logical-page" style="${styleVars}">
                    <div class="print-page-inner">
                        <div class="print-page-scaled">
                            <div class="${buildFrameClassName(settings)}">
                                <section class="print-live-page ${pageClassName}">
                                    ${page.domHtml}
                                </section>
                            </div>
                        </div>
                    </div>
                </article>
            `;
        }

        const totals = computeInvoiceTotals(snapshot.document);
        const totalsOverride = normalizeInvoiceTotalsOverride(snapshot.document?.totalsOverride);
        const logicalRowsHtml = page.type === 'invoice'
            ? buildInvoiceRowsMarkup(page)
            : buildLetterheadRowsMarkup(page);
        const footerHtml = page.type === 'invoice'
            ? buildInvoiceFooterMarkup(snapshot, page.pageNumber)
            : snapshot.fragments.footerHtml;
        const totalsHtml = page.type === 'invoice' && page.isFinal
            ? buildInvoiceTotalsMarkup(
                snapshot.amountWordsText || snapshot.document?.amountWordsText || InvoiceMath.amountInWords(Math.max(0, totals.payable)),
                page.pageSubtotal,
                page.previousPagesTotal,
                totals.payable,
                totals.discount,
                totalsOverride
            )
            : '';
        const styleVars = [
            `--sheet-width:${dimensions.sheetWidthMm}mm`,
            `--sheet-height:${dimensions.sheetHeightMm}mm`,
            `--margin-top:${settings.marginsMm.top}mm`,
            `--margin-right:${settings.marginsMm.right}mm`,
            `--margin-bottom:${settings.marginsMm.bottom}mm`,
            `--margin-left:${settings.marginsMm.left}mm`,
            `--content-scale:${settings.scale}`
        ].join(';');

        return `
            <article class="print-logical-page" style="${styleVars}">
                <div class="print-page-inner">
                    <div class="print-page-scaled">
                        <div class="${buildFrameClassName(settings)}">
                            ${snapshot.fragments.headerHtml}
                            <div class="print-table-wrapper">
                                <div class="inv-table-wrap">
                                    <table class="${escapeHtml(snapshot.fragments.tableClassName)}">
                                        ${snapshot.fragments.tableHeadHtml}
                                        <tbody>${logicalRowsHtml}</tbody>
                                    </table>
                                </div>
                            </div>
                            ${totalsHtml}
                            <div class="print-doc-spacer"></div>
                            ${footerHtml}
                        </div>
                    </div>
                </div>
            </article>
        `;
    }

    function buildInvoiceRowsMarkup(page) {
        const itemRowsHtml = page.rows.map(row => buildInvoiceItemRowMarkup(row.item, row.serial)).join('');
        const blankRowsHtml = buildBlankMarkup(page.blankRowCount, page.rows.length > 0 ? page.rows[page.rows.length - 1].serial + 1 : 1, buildInvoiceBlankRowMarkup);
        return `${itemRowsHtml}${blankRowsHtml}${buildInvoiceSubtotalRowMarkup(page.pageSubtotal)}`;
    }

    function buildLetterheadRowsMarkup(page) {
        const itemRowsHtml = page.rows.map(row => buildLetterheadItemRowMarkup(row.item, row.serial)).join('');
        const blankRowsHtml = buildBlankMarkup(page.blankRowCount, page.rows.length > 0 ? page.rows[page.rows.length - 1].serial + 1 : 1, buildLetterheadBlankRowMarkup);
        return `${itemRowsHtml}${blankRowsHtml}`;
    }

    function buildBarcodeSheetMarkup(page, barcodeProfile) {
        const profile = getBarcodePrinterProfile(barcodeProfile?.id || page?.barcodeProfileId);
        const labels = Array.isArray(page.labels) ? page.labels : [];
        const sheetClassName = `bc-label-sheet ${profile.id.startsWith('thermal-') ? 'bc-label-sheet--thermal' : 'bc-label-sheet--a4'}`;
        const sheetStyle = [
            `grid-template-columns:${profile.gridTemplateColumns}`,
            `grid-template-rows:${profile.gridTemplateRows}`,
            `padding:${profile.sheetPadding}`,
            `gap:${profile.sheetGap}`,
            `--bc-label-padding:${profile.labelPadding}`,
            `--bc-barcode-width:${profile.barcodeWidth}`,
            `--bc-barcode-height:${profile.barcodeHeight}`,
            `--bc-label-font-size:${profile.fontSize}`,
            `--bc-label-line-height:${profile.lineHeight}`,
            `--bc-label-text-gap:${profile.textGap}`
        ].join(';');
        let html = `<div class="${sheetClassName}" data-printer-profile="${escapeHtml(profile.id)}" style="${sheetStyle}">`;
        labels.forEach(label => {
            const itemNameEN = String(label.itemNameEN || '').trim();
            const compactClass = profile.id.startsWith('thermal-')
                ? (itemNameEN.length > 30
                    ? ' bc-label--ultra-compact'
                    : (itemNameEN.length > 18 ? ' bc-label--compact' : ''))
                : '';
            html += `
                <div class="bc-label${compactClass}">
                    ${label.svg || ''}
                    ${itemNameEN ? `
                        <div class="bc-label-text bc-label-text--name-only">
                            <div class="bc-label-line bc-label-line--name-en">${escapeHtml(itemNameEN)}</div>
                        </div>
                    ` : ''}
                </div>
            `;
        });

        if (profile.fillEmptySlots) {
            for (let index = labels.length; index < profile.labelsPerSheet; index += 1) {
                html += '<div class="bc-label"></div>';
            }
        }

        html += '</div>';
        return html;
    }

    function buildBlankMarkup(count, startSerial, builder) {
        let html = '';
        for (let index = 0; index < count; index += 1) {
            html += builder(startSerial + index);
        }
        return html;
    }

    function buildInvoiceItemRowMarkup(item, serial) {
        const qty = parseInt(item.qty, 10) || 0;
        const unitPriceFils = resolveItemUnitPriceFils(item);
        const totalFils = rowTotalFils(item);

        return `
            <tr>
                <td class="col-sno">${serial}</td>
                <td>${escapeHtml(item.barcode || '')}</td>
                <td>${escapeHtml(item.product_by || '')}</td>
                <td>${escapeHtml(item.name_en || '')}</td>
                <td dir="rtl">${escapeHtml(item.name_ar || '')}</td>
                <td>${escapeHtml(item.weight || '')}</td>
                <td>${qty > 0 ? qty : ''}</td>
                <td>${InvoiceMath.filsToKD(unitPriceFils)} FILS</td>
                <td>${InvoiceMath.filsToKD(totalFils)} KD.</td>
            </tr>
        `;
    }

    function buildInvoiceBlankRowMarkup(serial) {
        return `
            <tr>
                <td class="col-sno">${serial}</td>
                <td></td>
                <td></td>
                <td></td>
                <td dir="rtl"></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
            </tr>
        `;
    }

    function buildInvoiceSubtotalRowMarkup(pageSubtotal) {
        return `
            <tr class="inv-subtotal-row">
                <td colspan="8" class="inv-subtotal-label"><strong>Subtotal</strong></td>
                <td class="inv-subtotal-value"><strong>${InvoiceMath.filsToKD(pageSubtotal)} KD.</strong></td>
            </tr>
        `;
    }

    function normalizeInvoiceTotalsOverride(value = {}) {
        return {
            subtotal: '',
            previousPagesTotal: '',
            totalPayable: '',
            ...(value || {})
        };
    }

    function resolveInvoiceTotalsDisplay(overrideText, autoText) {
        const override = String(overrideText || '').trim();
        return override || autoText || '';
    }

    function buildInvoiceTotalsMarkup(amountWordsText, pageSubtotal, previousPagesTotal, payableFils, discountFils, totalsOverride = {}) {
        const safeOverride = normalizeInvoiceTotalsOverride(totalsOverride);
        const words = amountWordsText || InvoiceMath.amountInWords(Math.max(0, payableFils));
        const subtotalText = resolveInvoiceTotalsDisplay(safeOverride.subtotal, `${InvoiceMath.filsToKD(pageSubtotal)} KD.`);
        const previousPagesText = resolveInvoiceTotalsDisplay(
            safeOverride.previousPagesTotal,
            previousPagesTotal > 0 ? `${InvoiceMath.filsToKD(previousPagesTotal)} KD.` : ''
        );
        const totalPayableText = resolveInvoiceTotalsDisplay(safeOverride.totalPayable, `${InvoiceMath.filsToKD(Math.max(0, payableFils))} KD.`);

        return `
            <div class="inv-bottom-section">
                <div class="inv-amount-words">
                    <div class="inv-aw-title"><strong>TOTAL AMOUNT IN WORD</strong></div>
                    <div class="inv-aw-text">${escapeHtml(words)}</div>
                </div>
                <div class="inv-totals-box">
                    <table class="inv-totals-table">
                        <tr><td class="inv-tot-label">Subtotal</td><td class="inv-tot-value">${escapeHtml(subtotalText)}</td></tr>
                        ${previousPagesTotal > 0 || previousPagesText ? `<tr><td class="inv-tot-label">Prev. Pages Total</td><td class="inv-tot-value">${escapeHtml(previousPagesText)}</td></tr>` : ''}
                        ${discountFils > 0 ? `<tr><td class="inv-tot-label">Discount</td><td class="inv-tot-value">${InvoiceMath.filsToKD(discountFils)} KD.</td></tr>` : ''}
                        <tr class="inv-tot-grand"><td class="inv-tot-label"><strong>Total Payable Amount</strong></td><td class="inv-tot-value"><strong>${escapeHtml(totalPayableText)}</strong></td></tr>
                    </table>
                </div>
            </div>
        `;
    }

    function buildInvoiceFooterMarkup(snapshot, pageNumber) {
        return `${snapshot.fragments.footerHtml}<div class="inv-page-number">Page No. ${String(pageNumber).padStart(2, '0')}</div>`;
    }

    function buildLetterheadItemRowMarkup(item, serial) {
        const qty = parseInt(item.qty, 10) || 0;
        const unitPriceFils = resolveItemUnitPriceFils(item);
        const totalFils = rowTotalFils(item);

        return `
            <tr>
                <td>${escapeHtml(item.barcode || '')}</td>
                <td>${escapeHtml(item.product_by || '')}</td>
                <td>${InvoiceMath.filsToKD(totalFils)} KD.</td>
                <td>${InvoiceMath.filsToKD(unitPriceFils)} FILS</td>
                <td>${qty > 0 ? qty : ''}</td>
                <td>${escapeHtml(item.weight || '')}</td>
                <td>${escapeHtml(item.name_en || '')}</td>
                <td dir="rtl">${escapeHtml(item.name_ar || '')}</td>
                <td class="col-sno">${String(serial).padStart(2, '0')}</td>
            </tr>
        `;
    }

    function buildLetterheadBlankRowMarkup(serial) {
        return `
            <tr>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td dir="rtl"></td>
                <td class="col-sno">${String(serial).padStart(2, '0')}</td>
            </tr>
        `;
    }

    function getBarcodePrintSnapshot(labels, profileId = DEFAULT_BARCODE_PRINTER_PROFILE_ID) {
        const profile = getBarcodePrinterProfile(profileId);
        const safeLabels = Array.isArray(labels)
            ? labels.map(label => ({
                barcodeNumber: label.barcodeNumber || '',
                itemNameEN: label.itemNameEN || '',
                itemNameAR: label.itemNameAR || '',
                weight: label.weight || '',
                unitPrice: label.unitPrice || '',
                productBy: label.productBy || '',
                svg: label.svg || '',
                format: label.format || 'code128'
            }))
            : [];

        return {
            viewType: 'barcode',
            manualPagination: false,
            document: { pages: [] },
            labels: safeLabels,
            barcodeProfileId: profile.id,
            barcodeProfile: {
                ...profile,
                paperSizeMm: { ...profile.paperSizeMm }
            },
            fragments: {
                headerHtml: '',
                footerHtml: '',
                tableHeadHtml: '',
                tableClassName: '',
                imageSources: []
            },
            createdAt: new Date().toISOString()
        };
    }

    function buildLivePreviewPages(snapshot) {
        const pages = Array.isArray(snapshot.livePreviewPages) ? snapshot.livePreviewPages : [];
        return pages.map((page, index) => ({
            type: page.type || snapshot.viewType,
            pageNumber: Number(page.pageNumber) || index + 1,
            domHtml: page.domHtml || '',
            pageClassName: page.pageClassName || defaultPageClassName(page.type || snapshot.viewType)
        }));
    }

    function getItemSections(snapshot) {
        const pages = Array.isArray(snapshot.document?.pages) ? snapshot.document.pages : [];
        if (snapshot.manualPagination) {
            return pages.map(page => Array.isArray(page.items) ? page.items : []);
        }
        return [pages.flatMap(page => Array.isArray(page.items) ? page.items : [])];
    }

    function computeInvoiceTotals(documentData) {
        const allItems = Array.isArray(documentData?.pages)
            ? documentData.pages.flatMap(page => Array.isArray(page.items) ? page.items : [])
            : [];
        const grandTotal = allItems.reduce((sum, item) => sum + rowTotalFils(item), 0);
        const discount = InvoiceMath.parseFils(documentData?.discount);

        return {
            grandTotal,
            discount,
            payable: grandTotal - discount
        };
    }

    function rowTotalFils(item) {
        const explicitTotal = Number(item?.total_fils);
        if (item?.total_manual_override) {
            return Number.isFinite(explicitTotal) ? Math.max(0, Math.round(explicitTotal)) : 0;
        }
        if (Number.isFinite(explicitTotal) && explicitTotal > 0) {
            return Math.round(explicitTotal);
        }

        const qty = parseInt(item?.qty, 10) || 0;
        const unitPriceFils = resolveItemUnitPriceFils(item);
        return InvoiceMath.rowTotal(qty, unitPriceFils);
    }

    function resolveItemUnitPriceFils(item) {
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

    function buildFrameClassName(settings) {
        const classes = ['print-doc-frame'];
        if (settings.colorMode === 'bw') classes.push('print-doc-frame--grayscale');
        if (!settings.printBackground) classes.push('print-doc-frame--no-backgrounds');
        return classes.join(' ');
    }

    function defaultPageClassName(viewType) {
        if (viewType === 'letterhead') return 'inv-page inv-page-landscape';
        if (viewType === 'invoice') return 'inv-page inv-page-portrait';
        return '';
    }

    async function waitForPrintAssets(snapshot) {
        const tasks = [];
        if (document.fonts?.ready) {
            tasks.push(document.fonts.ready.catch(() => undefined));
        }

        const imageSources = new Set(Array.isArray(snapshot.fragments?.imageSources) ? snapshot.fragments.imageSources : []);
        const livePreviewPages = Array.isArray(snapshot.livePreviewPages) ? snapshot.livePreviewPages : [];
        livePreviewPages.forEach(page => {
            const sources = Array.isArray(page?.imageSources) ? page.imageSources : [];
            sources.forEach(source => imageSources.add(source));
        });
        imageSources.forEach(source => {
            tasks.push(preloadImage(source));
        });

        await Promise.all(tasks);
    }

    function preloadImage(src) {
        return new Promise(resolve => {
            const image = new Image();
            let settled = false;

            const finish = () => {
                if (settled) return;
                settled = true;
                resolve();
            };

            image.addEventListener('load', finish, { once: true });
            image.addEventListener('error', finish, { once: true });
            image.src = src;

            if (image.decode) {
                image.decode().then(finish).catch(finish);
            }
        });
    }

    function applyComposedPrintDocument(job) {
        setPrintPageStyle(job.settings);

        const printContainer = document.getElementById('print-container');
        if (!printContainer) return;

        printContainer.innerHTML = '';
        printContainer.dataset.printReady = 'true';
        printContainer.appendChild(job.root);
    }

    function setPrintPageStyle(settings) {
        let styleNode = document.getElementById('dynamic-print-page-style');
        if (!styleNode) {
            styleNode = document.createElement('style');
            styleNode.id = 'dynamic-print-page-style';
            document.head.appendChild(styleNode);
        }

        styleNode.textContent = `@media print { @page { size: ${settings.pageCssSize}; margin: 0; } }`;
    }

    function buildPrintServiceConfig(job, silent) {
        const preferredPrinter = silent ? '' : resolvePreferredPrinterName(job.snapshot.viewType);
        const usePreferredPrinter = !!preferredPrinter;
        return {
            htmlContent: job.htmlContent,
            orientation: job.settings.orientation,
            color: job.settings.colorMode !== 'bw',
            pageSize: job.settings.pageSizeValue || job.settings.paperSizeName,
            silent: silent ? true : usePreferredPrinter,
            printBackground: job.settings.printBackground,
            displayHeaderFooter: false,
            preferCSSPageSize: true,
            margins: { marginType: 'none' },
            copies: job.settings.copies,
            collate: job.settings.collate,
            pagesPerSheet: 1,
            scale: 1,
            scaleFactor: 100,
            deviceName: usePreferredPrinter ? preferredPrinter : ''
        };
    }

    function resolvePreferredPrinterName(viewType) {
        const settings = typeof Settings?.getSettings === 'function' ? Settings.getSettings() : {};
        const printers = settings?.printers || {};

        if (viewType === 'barcode') {
            return String(printers.barcodePrinter || '').trim();
        }

        return String(printers.invoicePrinter || '').trim();
    }

    function buildPrintDocuments(job) {
        const previewRoot = buildPreviewRoot(job);
        return {
            printHtml: buildPrintDocumentHtml(job, 'print', job.root),
            previewHtml: buildPrintDocumentHtml(job, 'preview', previewRoot || job.root)
        };
    }

    function buildPreviewRoot(job) {
        const snapshotPages = buildLivePreviewPages(job.snapshot);
        if (
            job.snapshot.viewType === 'barcode'
            || snapshotPages.length === 0
            || snapshotPages.length !== job.totalLogicalPages
        ) {
            return job.root;
        }

        const previewPages = filterPagesBySelection(snapshotPages, job.settings.pageSelection);

        if (previewPages.length === 0) {
            return job.root;
        }

        return renderPrintJob(job.snapshot, job.settings, job.dimensions, previewPages);
    }

    function buildPrintDocumentHtml(job, mode, rootNode = job.root) {
        const baseHref = new URL('./', window.location.href).href;
        const links = PRINT_STYLESHEET_PATHS
            .map(href => `<link rel="stylesheet" href="${new URL(href, window.location.href).href}">`)
            .join('');
        const outputContainerId = mode === 'preview' ? 'print-container' : 'print-output-root';
        const outputContainerClass = mode === 'preview' ? 'print-container' : 'print-output-root';
        const previewCss = mode === 'preview' ? getPreviewMediaCssText() : '';
        const previewShell = mode === 'preview'
            ? `
                <style>
                    ${previewCss}
                    html, body {
                        margin: 0;
                        padding: 0;
                        background: #525659;
                        min-height: 100%;
                    }
                    body {
                        overflow: auto;
                    }
                    #print-preview-shell {
                        display: flex;
                        justify-content: center;
                        align-items: flex-start;
                        padding: 24px;
                        min-height: 100vh;
                        box-sizing: border-box;
                    }
                    #print-preview-scale {
                        transform-origin: top center;
                    }
                    #print-container {
                        display: block !important;
                        position: static !important;
                        left: 0 !important;
                        top: 0 !important;
                        width: auto !important;
                        height: auto !important;
                        overflow: visible !important;
                        visibility: visible !important;
                        pointer-events: auto !important;
                        background: transparent !important;
                    }
                    #print-container .print-measure-root {
                        display: none !important;
                    }
                    #print-container .print-sheet {
                        box-shadow: 0 12px 34px rgba(0, 0, 0, 0.32);
                        margin-bottom: 24px;
                    }
                    #print-container .print-sheet:last-child {
                        margin-bottom: 0;
                    }
                </style>
            `
            : `
                <style>
                    html, body {
                        margin: 0;
                        padding: 0;
                        background: #fff;
                        min-height: 100%;
                    }
                    body {
                        overflow: visible;
                    }
                    #print-output-root {
                        display: block !important;
                        position: static !important;
                        width: auto !important;
                        height: auto !important;
                        min-height: 100vh;
                        overflow: visible !important;
                        visibility: visible !important;
                        pointer-events: auto !important;
                        background: #fff !important;
                    }
                    #print-output-root .print-sheet {
                        box-shadow: none !important;
                        margin: 0 !important;
                    }
                    #print-output-root .print-live-page {
                        box-shadow: none !important;
                        margin: 0 !important;
                    }
                    * {
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                </style>
            `;
        const previewScript = mode === 'preview'
            ? `
                <script>
                    (() => {
                        const root = document.getElementById('print-preview-scale');
                        const shell = document.getElementById('print-preview-shell');
                        const updateScale = () => {
                            const firstSheet = document.querySelector('.print-sheet')
                                || document.querySelector('.print-logical-page')
                                || document.querySelector('.inv-page');
                            if (!firstSheet || !root || !shell) {
                                document.body.dataset.previewReady = 'true';
                                return;
                            }

                            root.style.zoom = '1';
                            const naturalWidth = firstSheet.offsetWidth || firstSheet.getBoundingClientRect().width || 1;
                            const naturalHeight = firstSheet.offsetHeight || firstSheet.getBoundingClientRect().height || 1;
                            const availableWidth = Math.max(320, window.innerWidth - 48);
                            const availableHeight = Math.max(320, window.innerHeight - 48);
                            const layout = document.body.dataset.layout || 'portrait';
                            const widthScale = availableWidth / naturalWidth;
                            const heightScale = availableHeight / naturalHeight;
                            const scale = Math.min(1, layout === 'landscape' ? widthScale : Math.min(widthScale, heightScale));
                            root.style.zoom = String(scale);
                            document.body.dataset.previewReady = 'true';
                        };

                        window.addEventListener('resize', updateScale);
                        if (document.fonts && document.fonts.ready) {
                            document.fonts.ready.then(updateScale).catch(updateScale);
                        } else {
                            updateScale();
                        }
                        requestAnimationFrame(() => requestAnimationFrame(updateScale));
                    })();
                </script>
            `
            : '';
        const containerHtml = `<div id="${outputContainerId}" class="${outputContainerClass}" data-print-ready="true">${rootNode.outerHTML}</div>`;

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <base href="${baseHref}">
                <title>Nexus Print</title>
                ${links}
                <style id="dynamic-print-page-style">@page { size: ${job.settings.pageCssSize}; margin: 0; }</style>
                ${previewShell}
            </head>
            <body data-layout="${escapeHtml(job.settings.orientation)}" data-total-pages="${job.sheetCount || 0}" data-view-type="${escapeHtml(job.snapshot.viewType || '')}">
                ${mode === 'preview'
                    ? `<div id="print-preview-shell"><div id="print-preview-scale">${containerHtml}</div></div>`
                    : containerHtml}
                ${previewScript}
            </body>
            </html>
        `;
    }

    function getPreviewMediaCssText() {
        if (previewStylesCache != null) {
            return previewStylesCache;
        }

        const collected = [];
        Array.from(document.styleSheets || []).forEach(styleSheet => {
            try {
                collectPrintRules(styleSheet.cssRules, collected);
            } catch (_) { }
        });

        previewStylesCache = collected.join('\n');
        return previewStylesCache;
    }

    function collectPrintRules(ruleList, collected) {
        Array.from(ruleList || []).forEach(rule => {
            if (rule.type === CSSRule.MEDIA_RULE) {
                const mediaText = rule.conditionText || rule.media?.mediaText || '';
                if (/\bprint\b/i.test(mediaText)) {
                    flattenCssRules(rule.cssRules, collected);
                } else {
                    collectPrintRules(rule.cssRules, collected);
                }
            } else if (rule.cssRules) {
                collectPrintRules(rule.cssRules, collected);
            }
        });
    }

    function flattenCssRules(ruleList, collected) {
        Array.from(ruleList || []).forEach(rule => {
            if (rule.type === CSSRule.MEDIA_RULE) {
                flattenCssRules(rule.cssRules, collected);
                return;
            }
            collected.push(rule.cssText);
        });
    }

    async function renderPreview(job, refreshId) {
        const frame = ensurePreviewFrame();
        await new Promise(resolve => {
            frame.addEventListener('load', () => resolve(), { once: true });
            frame.srcdoc = job.previewHtml;
        });

        await waitForPreviewReady(frame);

        if (refreshId !== refreshGeneration) return;
        updateDialogSummary(job);
    }

    function ensurePreviewFrame() {
        const previewContent = document.getElementById('print-dialog-preview-content');
        if (!previewContent) {
            throw new Error('Preview container is unavailable.');
        }

        let frame = previewContent.querySelector('#print-preview-frame');
        if (!frame) {
            previewContent.innerHTML = '';
            frame = document.createElement('iframe');
            frame.id = 'print-preview-frame';
            frame.className = 'print-preview-frame';
            frame.setAttribute('title', 'Print Preview');
            previewContent.appendChild(frame);
        }

        return frame;
    }

    function renderPreviewError(message) {
        const previewContent = document.getElementById('print-dialog-preview-content');
        if (!previewContent) return;

        previewContent.innerHTML = `<div class="print-preview-error">${escapeHtml(message)}</div>`;
        const totalPages = document.getElementById('pd-total-pages');
        if (totalPages) totalPages.textContent = '0';
    }

    function updateDialogSummary(job) {
        const totalPages = document.getElementById('pd-total-pages');
        if (totalPages) {
            totalPages.textContent = String(job.sheetCount || 0);
        }
    }

    async function waitForPreviewReady(frame) {
        for (let attempt = 0; attempt < 40; attempt += 1) {
            if (frame.contentDocument?.body?.dataset?.previewReady === 'true') {
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    }

    async function executeFinalPrint() {
        showLoading(true);

        try {
            const job = await composePrintJobFromUi();
            currentJob = job;

            if (job.settings.destination === 'pdf') {
                await handleSaveAsPdf(job);
            } else {
                await handleDirectPrint(job);
            }
        } catch (error) {
            console.error('Print failed:', error);
            Notification.show(`Print failed: ${error.message}`, 'error');
        } finally {
            showLoading(false);
        }
    }

    async function handleSaveAsPdf(job) {
        if (!window.electronAPI?.generateCustomPrintPdf) {
            throw new Error('PDF export is not available in this environment.');
        }

        currentPdfBuffer = await window.electronAPI.generateCustomPrintPdf(job.pdfRequest);
        if (!currentPdfBuffer) {
            throw new Error('PDF generation returned no data.');
        }

        const result = await savePdfBytesWithDialog(currentPdfBuffer, {
            viewType: currentViewType
        });
        if (result?.canceled) {
            return;
        }

        await finalizeSuccessfulPrint();
        Notification.show('Document saved successfully!', 'success');
        closeDialog();
    }

    async function handleDirectPrint(job) {
        if (!window.electronAPI?.executeCustomPrint) {
            throw new Error('Printing is not available in this environment.');
        }

        const result = await window.electronAPI.executeCustomPrint(job.printRequest);
        if (!result?.success) {
            throw new Error(result?.error || 'The print job was rejected by the printer.');
        }

        await finalizeSuccessfulPrint();
        Notification.show('Job sent to printer!', 'success');
        closeDialog();
    }

    async function finalizeSuccessfulPrint() {
        if (currentViewType !== 'invoice' || !Array.isArray(currentPendingDeductions) || currentPendingDeductions.length === 0) {
            currentPendingDeductions = null;
            return;
        }

        let documentId = null;
        const saved = await Sell.saveDocument({ silent: true });
        if (!saved?.id) {
            Notification.show('Invoice printed, but the document could not be linked. Stock was not deducted.', 'warning');
            currentPendingDeductions = null;
            return;
        }

        documentId = saved.id;
        await Stocks.confirmDeduction(currentPendingDeductions, documentId);
        currentPendingDeductions = null;
    }

    function showLoading(show) {
        const previewPane = document.getElementById('print-dialog-preview');
        if (!previewPane) return;

        let loader = previewPane.querySelector('.print-loading-overlay');
        if (show) {
            if (!loader) {
                loader = document.createElement('div');
                loader.className = 'print-loading-overlay';
                loader.innerHTML = '<div class="spinner"></div><span style="font-weight:500">Preparing Preview...</span>';
                previewPane.appendChild(loader);
            }
            loader.style.display = 'flex';
        } else if (loader) {
            loader.style.display = 'none';
        }
    }

    function closeDialog() {
        if (refreshTimeout) clearTimeout(refreshTimeout);

        const overlay = document.getElementById('print-dialog-overlay');
        if (overlay) overlay.style.display = 'none';

        const previewContent = document.getElementById('print-dialog-preview-content');
        if (previewContent) {
            previewContent.innerHTML = '';
        }

        const printContainer = document.getElementById('print-container');
        if (printContainer) {
            printContainer.innerHTML = '';
            delete printContainer.dataset.printReady;
        }

        currentPdfBuffer = null;
        currentJob = null;
        currentPrintPayload = null;
        currentPendingDeductions = null;
    }

    async function showStockDeductionModal() {
        const data = Invoice.getData ? Invoice.getData() : { pages: [] };
        const allItems = [];
        (data.pages || []).forEach(page => allItems.push(...(page.items || [])));
        if (allItems.length === 0) return { proceed: true, deductions: [] };

        const itemsWithBarcodes = allItems.filter(item => item.barcode);
        if (itemsWithBarcodes.length === 0) return { proceed: true, deductions: [] };

        const deductions = await Stocks.deductStock(itemsWithBarcodes);
        if (deductions.length === 0) return { proceed: true, deductions: [] };

        const hasInsufficient = deductions.some(item => item.insufficient);
        return new Promise(resolve => {
            const modal = document.getElementById('stock-deduction-modal');
            const body = document.getElementById('stock-deduction-body');
            if (!modal || !body) {
                resolve({ proceed: true, deductions });
                return;
            }

            body.innerHTML = deductions.map(item => `
                <div class="deduction-row ${item.insufficient ? 'insufficient' : ''}">
                    <span>${escapeHtml(item.name_en)}</span>
                    <span>${escapeHtml(String(item.beforeLabel || item.before))} -> ${escapeHtml(String(item.afterLabel || item.after))}</span>
                </div>
            `).join('');

            App?.showModal?.(modal);
            const confirmBtn = document.getElementById('deduction-confirm-btn');
            const cancelBtn = document.getElementById('deduction-cancel-btn');
            const printOnlyBtn = document.getElementById('deduction-print-only-btn');
            if (!confirmBtn || !cancelBtn) {
                App?.hideModal?.(modal);
                resolve({ proceed: false, deductions: [] });
                return;
            }

            const controller = new AbortController();
            const finish = (result) => {
                controller.abort();
                App?.hideModal?.(modal);
                resolve(result);
            };

            confirmBtn.addEventListener('click', async () => {
                if (hasInsufficient) {
                    const allowed = await showAdminOverrideModal();
                    if (!allowed) {
                        finish({ proceed: false, deductions: [] });
                        return;
                    }
                }

                finish({ proceed: true, deductions });
            }, { signal: controller.signal });
            cancelBtn.addEventListener('click', () => {
                finish({ proceed: false, deductions: [] });
            }, { signal: controller.signal });
            printOnlyBtn?.addEventListener('click', () => {
                finish({ proceed: true, deductions: [] });
            }, { signal: controller.signal });
        });
    }

    function showAdminOverrideModal() {
        return new Promise(resolve => {
            const modal = document.getElementById('admin-override-modal');
            const passwordInput = document.getElementById('ao-password');
            const errorEl = document.getElementById('ao-error');
            if (!modal) {
                resolve(false);
                return;
            }

            App?.showModal?.(modal);
            if (passwordInput) passwordInput.value = '';
            if (errorEl) errorEl.textContent = '';
            const confirmBtn = document.getElementById('ao-confirm-btn');
            const cancelBtn = document.getElementById('ao-cancel-btn');
            if (!confirmBtn || !cancelBtn) {
                App?.hideModal?.(modal);
                resolve(false);
                return;
            }

            const controller = new AbortController();
            const finish = (allowed) => {
                controller.abort();
                App?.hideModal?.(modal);
                resolve(allowed);
            };

            confirmBtn.addEventListener('click', async () => {
                const allowed = await validateAdminOverride(passwordInput?.value || '');
                if (!allowed) {
                    if (errorEl) errorEl.textContent = 'Invalid admin password.';
                    if (passwordInput) passwordInput.focus();
                    return;
                }

                finish(true);
            }, { signal: controller.signal });
            cancelBtn.addEventListener('click', () => {
                finish(false);
            }, { signal: controller.signal });
        });
    }

    async function validateAdminOverride(inputPassword) {
        if (typeof Login !== 'undefined' && typeof Login.verifyPassword === 'function') {
            const verification = await Login.verifyPassword(inputPassword);
            return !!verification.success;
        }

        return false;
    }

    function mmToPx(mm) {
        return (mm * 96) / 25.4;
    }

    function sumChildHeights(element) {
        return Array.from(element.children).reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
    }

    function sumRowHeights(rows) {
        return rows.reduce((sum, row) => sum + row.height, 0);
    }

    function toUint8Array(data) {
        if (data instanceof Uint8Array) return data;
        if (data instanceof ArrayBuffer) return new Uint8Array(data);
        if (Array.isArray(data)) return Uint8Array.from(data);
        if (data && Array.isArray(data.data)) return Uint8Array.from(data.data);
        return new Uint8Array(data);
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value || null));
    }

    function escapeHtml(value) {
        const host = document.createElement('div');
        host.textContent = value == null ? '' : String(value);
        return host.innerHTML;
    }

    initGlobalShortcuts();

    return {
        startPrintFlow,
        startBarcodePrintFlow: (labels) => startPrintFlow('barcode', { labels: deepClone(labels || []) }),
        quickPrintCurrentView,
        exportSnapshotToPdf,
        saveSnapshotAsPdf,
        printInvoice: () => startPrintFlow('invoice'),
        printLetterhead: () => startPrintFlow('letterhead')
    };
})();
