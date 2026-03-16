/**
 * invoice-math.js — Integer fils arithmetic for KD currency
 * All monetary values stored as integer fils (KD × 1000)
 * Prevents floating-point rounding errors
 * 3-decimal precision throughout
 */
const InvoiceMath = (() => {
    // ── Conversion Helpers ──
    function extractNumericText(value) {
        if (value == null) return '';
        return String(value).replace(/[^0-9.\-]/g, '').trim();
    }

    function hasNumericInput(value) {
        return extractNumericText(value) !== '';
    }

    function kdToFils(kd) {
        if (typeof kd === 'string') kd = parseFloat(kd) || 0;
        return Math.round(kd * 1000);
    }

    function filsToKD(fils) {
        return (fils / 1000).toFixed(3);
    }

    function formatKD(fils) {
        const kd = fils / 1000;
        return kd.toFixed(3) + ' KD';
    }

    function parseFils(str) {
        if (typeof str === 'number') return Math.round(str);
        if (!str) return 0;
        const numeric = extractNumericText(str);
        if (!numeric) return 0;
        return Math.round(parseFloat(numeric) * 1000) || 0;
    }

    // ── Calculations ──
    function rowTotal(qtyStr, unitPriceFils) {
        const qty = parseInt(qtyStr) || 0;
        const price = (typeof unitPriceFils === 'string') ? parseFils(unitPriceFils) : unitPriceFils;
        return qty * price;
    }

    function subtotal(items) {
        let total = 0;
        for (const item of items) {
            const fils = (typeof item.total_fils === 'number')
                ? item.total_fils
                : rowTotal(item.qty, item.unit_price_fils || item.unitPrice);
            total += fils;
        }
        return total;
    }

    // Alias for clarity in page-context
    function pageSubtotal(items) {
        return subtotal(items);
    }

    function grandTotal(pages) {
        let total = 0;
        for (const page of pages) {
            total += subtotal(page.items || []);
        }
        return total;
    }

    // ── Amount in Words ──
    function amountInWords(fils) {
        const kd = Math.floor(fils / 1000);
        const remainFils = fils % 1000;

        const kdWords = numberToWords(kd);
        const filsWords = numberToWords(remainFils);

        let result = '';
        if (kd > 0) {
            result += kdWords + ' Dinar' + (kd !== 1 ? 's' : '');
        }
        if (remainFils > 0) {
            if (kd > 0) result += ' ';
            result += filsWords + ' Fils';
        }
        if (kd === 0 && remainFils === 0) {
            result = 'Zero Dinars';
        }
        return result + ' Only';
    }

    function numberToWords(n) {
        if (n === 0) return 'Zero';

        const onesWords = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
            'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
        const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
        const thousands = ['', 'Thousand', 'Million', 'Billion'];

        let parts = [];
        let chunkIndex = 0;

        while (n > 0) {
            const chunk = n % 1000;
            if (chunk !== 0) {
                let chunkStr = chunkToWords(chunk, onesWords, tens);
                if (thousands[chunkIndex]) {
                    chunkStr += ' ' + thousands[chunkIndex];
                }
                parts.unshift(chunkStr);
            }
            n = Math.floor(n / 1000);
            chunkIndex++;
        }

        return parts.join(' ');
    }

    function chunkToWords(n, onesWords, tens) {
        let str = '';
        if (n >= 100) {
            str += onesWords[Math.floor(n / 100)] + ' Hundred';
            n %= 100;
            if (n > 0) str += ' ';
        }
        if (n >= 20) {
            str += tens[Math.floor(n / 10)];
            if (n % 10 > 0) str += ' ' + onesWords[n % 10];
        } else if (n > 0) {
            str += onesWords[n];
        }
        return str;
    }

    return {
        extractNumericText, hasNumericInput,
        kdToFils, filsToKD, formatKD, parseFils,
        rowTotal, subtotal, pageSubtotal, grandTotal,
        amountInWords, numberToWords
    };
})();
