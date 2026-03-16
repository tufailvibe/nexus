const StockHelpers = (() => {
    function normalizePackQtyText(packQtyText) {
        return String(packQtyText || '')
            .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
            .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
            .replace(/[＋]/g, '+')
            .replace(/[－]/g, '-')
            .replace(/[，]/g, ',');
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
        const source = String(packQtyText || '').trim();
        const safeQty = Math.max(0, parseInt(qtyValue, 10) || 0);
        const match = source.match(/[+-]?\d+/);

        if (!match) {
            if (!source) return String(safeQty);
            return `${safeQty} ${source}`;
        }

        const start = match.index || 0;
        const end = start + match[0].length;
        return `${source.slice(0, start)}${safeQty}${source.slice(end)}`;
    }

    function adjustPackQtyText(packQtyText, qtyDelta) {
        const source = String(packQtyText || '');
        const safeDelta = parseInt(qtyDelta, 10) || 0;
        const matches = Array.from(normalizePackQtyText(source).matchAll(/[+-]?\d+/g));

        if (matches.length === 0) {
            if (safeDelta <= 0) return source;
            const trimmed = source.trim();
            if (!trimmed) return String(safeDelta);
            return `${safeDelta} ${trimmed}`;
        }

        const targetMatch = matches[0];
        const start = targetMatch.index || 0;
        const end = start + targetMatch[0].length;
        const currentQty = parseInt(targetMatch[0], 10) || 0;
        const nextQty = currentQty + safeDelta;
        return `${source.slice(0, start)}${nextQty}${source.slice(end)}`;
    }

    function createStockItem(overrides = {}) {
        return {
            barcode: '',
            name_en: '',
            name_ar: '',
            country: '',
            weight: '',
            unit_price_fils: 0,
            product_by: '',
            pack_qty_text: '',
            stock_qty: 0,
            reorder_level: 5,
            display_order: 0,
            archived_at: null,
            _selected: false,
            ...overrides
        };
    }

    function normalizeStockItem(item = {}) {
        const quantityFromText = parsePackQtyValue(item.pack_qty_text);
        return createStockItem({
            ...item,
            pack_qty_text: item.pack_qty_text || '',
            stock_qty: Math.max(0, quantityFromText == null ? 0 : quantityFromText),
            reorder_level: Math.max(0, parseInt(item.reorder_level, 10) || 5),
            unit_price_fils: Number(item.unit_price_fils || 0) || 0,
            display_order: Math.max(0, parseInt(item.display_order, 10) || 0),
            archived_at: item.archived_at || null,
            _selected: Boolean(item._selected)
        });
    }

    function isArchived(item) {
        return !!item?.archived_at;
    }

    function identifyItem(item) {
        return item?.name_en || item?.barcode || 'stock row';
    }

    function getEffectiveDisplayOrder(item) {
        return Math.max(0, parseInt(item?.display_order, 10) || 0) || Math.max(0, parseInt(item?.id, 10) || 0);
    }

    function getNextDisplayOrder(items = []) {
        return items.reduce((maxValue, item) => Math.max(maxValue, getEffectiveDisplayOrder(item)), 0) + 1;
    }

    return {
        createStockItem,
        normalizeStockItem,
        parsePackQtyValue,
        setPackQtyValue,
        adjustPackQtyText,
        isArchived,
        identifyItem,
        getEffectiveDisplayOrder,
        getNextDisplayOrder
    };
})();
