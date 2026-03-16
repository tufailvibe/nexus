const FEATURE_AUDITS = [
    {
        id: 'auth-session',
        title: 'Authentication and session gate',
        intent: 'User should enter the app safely, keep trusted-session behavior predictable, and exit cleanly.',
        interfaces: ['#login-form', '#login-username', '#login-password', '#btn-logout', 'Login module'],
        entities: ['settings.has_password', 'settings.password', 'settings.remembered_session'],
        suggestions: [
            {
                title: 'Login activity timeline',
                type: 'Product gap',
                rationale: 'Deep audits would become more actionable if failed attempts, last login time, and forced logout events were visible in settings.',
                impact: 'High',
                effort: 'Medium'
            }
        ]
    },
    {
        id: 'stocks-management',
        title: 'Stocks CRUD and movement integrity',
        intent: 'A stock manager should be able to create, search, adjust, and audit inventory without losing movement history.',
        interfaces: ['#stocks-add-row', '#stocks-search', '#stocks-view-history', 'Stocks module'],
        entities: ['products', 'stock_movements'],
        suggestions: [
            {
                title: 'Adjustment reason presets',
                type: 'Product gap',
                rationale: 'Stock movement history is present, but predefined adjustment reasons would improve auditability and reduce ambiguous manual edits.',
                impact: 'High',
                effort: 'Low'
            }
        ]
    },
    {
        id: 'scanner-routing',
        title: 'Scanner intent routing',
        intent: 'A barcode scan should affect the currently active workflow only, so users do not mutate the wrong entity by accident.',
        interfaces: ['segment buttons', 'App.handleScan()', 'Scanner module'],
        entities: ['products', 'invoice pages', 'barcode draft input'],
        suggestions: []
    },
    {
        id: 'invoice-lifecycle',
        title: 'Invoice lifecycle and saved-history integrity',
        intent: 'A seller should be able to build, save, reopen, and update invoices without corrupting numbering or saved state.',
        interfaces: ['#sell-view-type', '#btn-save-template', '#btn-load-template', '#btn-new-doc', 'Sell module'],
        entities: ['documents', 'settings.next_invoice_number', 'invoice payload'],
        suggestions: [
            {
                title: 'Saved-document diff preview',
                type: 'Product gap',
                rationale: 'Before overwriting an existing invoice, a compact diff would make intent validation clearer and reduce silent content drift.',
                impact: 'Medium',
                effort: 'Medium'
            }
        ]
    },
    {
        id: 'draft-recovery',
        title: 'Draft recovery resilience',
        intent: 'Unsaved work should survive reloads and be easy to recover or clear without duplicating saved documents.',
        interfaces: ['#draft-recovery-modal', '[data-draft-recover]', 'Sell draft persistence'],
        entities: ['settings.draft_invoice', 'settings.draft_letterhead'],
        suggestions: []
    },
    {
        id: 'print-pipeline',
        title: 'Print preview, PDF, and stock-deduction flow',
        intent: 'Printing should preview the right document, produce usable output, and only mutate stock when the flow is confirmed.',
        interfaces: ['#btn-print-doc', '#stock-deduction-modal', '#print-dialog-overlay', 'PrintManager'],
        entities: ['printer jobs', 'documents', 'stock_movements', 'products'],
        suggestions: [
            {
                title: 'Saved printer presets',
                type: 'Product gap',
                rationale: 'Operators often repeat the same layout, margins, grayscale, and page-size choices; saved presets would reduce print friction.',
                impact: 'High',
                effort: 'Medium'
            }
        ]
    },
    {
        id: 'barcode-library',
        title: 'Barcode generation and reprint library',
        intent: 'A user should be able to create barcode labels once, reprint them later, and keep product metadata in sync.',
        interfaces: ['#barcode-gen-btn', '#barcode-print-btn', '#barcode-library-search', 'BarcodeGen module'],
        entities: ['barcode_library', 'products'],
        suggestions: [
            {
                title: 'Bulk barcode generation from stocks',
                type: 'Product gap',
                rationale: 'The current flow is strong for one-off labels; batch generation from filtered stock results would close a major operational gap.',
                impact: 'High',
                effort: 'Medium'
            }
        ]
    },
    {
        id: 'backup-import',
        title: 'Backup, export, and import integrity',
        intent: 'Operational data should be exportable, recoverable, and importable without silent corruption across tables.',
        interfaces: ['#settings-backup-now', '#settings-export-btn', '#settings-import-btn', 'Settings module'],
        entities: ['backups', 'products', 'templates', 'stock_movements', 'barcode_library'],
        suggestions: []
    }
];

function getFeatureAuditById(id) {
    return FEATURE_AUDITS.find((feature) => feature.id === id) || null;
}

module.exports = {
    FEATURE_AUDITS,
    getFeatureAuditById
};
