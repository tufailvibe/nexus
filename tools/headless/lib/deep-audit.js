const fs = require('fs');
const path = require('path');
const { createHarness } = require('./harness');
const { FEATURE_AUDITS } = require('./feature-audit-catalog');
const { collectStaticAudit } = require('./static-audit');
const {
    auditAuthSession,
    auditBackupImport,
    auditBarcodeLibrary,
    auditDraftRecovery,
    auditInvoiceLifecycle,
    auditPrintPipeline,
    auditScannerRouting,
    auditStocksManagement
} = require('./runtime-audit-scenarios');

const SEVERITY_ORDER = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3
};

const RUNTIME_SCENARIOS = {
    'auth-session': auditAuthSession,
    'stocks-management': auditStocksManagement,
    'scanner-routing': auditScannerRouting,
    'invoice-lifecycle': auditInvoiceLifecycle,
    'draft-recovery': auditDraftRecovery,
    'print-pipeline': auditPrintPipeline,
    'barcode-library': auditBarcodeLibrary,
    'backup-import': auditBackupImport
};

function runtimeFinding(severity, title, summary) {
    return { severity, title, summary };
}

function summarizeTelemetry(telemetry) {
    return {
        consoleErrors: telemetry.consoleMessages.filter((entry) => entry.type === 'error').length,
        consoleWarnings: telemetry.consoleMessages.filter((entry) => entry.type === 'warning').length,
        pageErrors: telemetry.pageErrors.length,
        requestFailures: telemetry.requestFailures.length,
        httpErrors: telemetry.httpErrors.length,
        ipcFailures: telemetry.ipcCalls.filter((entry) => entry.success === false).length,
        printerJobs: telemetry.printerJobs.length,
        fatalErrorText: telemetry.fatalErrorText || ''
    };
}

function isIgnorableRequestFailure(requestFailure) {
    return /fonts\.(gstatic|googleapis)\.com/i.test(requestFailure.url || '')
        && /ERR_ABORTED/i.test(requestFailure.failureText || '');
}

function isIgnorableConsoleError(consoleError, telemetry) {
    return /Failed to load resource: the server responded with a status of 404 \(Not Found\)/i.test(consoleError.text || '')
        && telemetry.httpErrors.length === 0
        && telemetry.requestFailures.filter((entry) => !isIgnorableRequestFailure(entry)).length === 0;
}

function collectRuntimeFindings(telemetry) {
    const findings = [];
    const actionableRequestFailures = telemetry.requestFailures.filter((entry) => !isIgnorableRequestFailure(entry));
    const actionableConsoleErrors = telemetry.consoleMessages.filter((entry) => {
        return entry.type === 'error' && !isIgnorableConsoleError(entry, telemetry);
    });

    if (telemetry.fatalErrorText) {
        findings.push(runtimeFinding('critical', 'Fatal UI error overlay surfaced', telemetry.fatalErrorText));
    }

    for (const pageError of telemetry.pageErrors.slice(0, 5)) {
        findings.push(runtimeFinding(
            'critical',
            'Unhandled renderer exception',
            pageError.message || 'Unknown page error'
        ));
    }

    for (const requestFailure of actionableRequestFailures.slice(0, 5)) {
        findings.push(runtimeFinding(
            'high',
            'Failed network or asset request',
            `${requestFailure.method} ${requestFailure.url} -> ${requestFailure.failureText}`
        ));
    }

    for (const httpError of telemetry.httpErrors.slice(0, 5)) {
        findings.push(runtimeFinding(
            'high',
            'HTTP error while loading app assets',
            `${httpError.status} ${httpError.statusText} for ${httpError.url}`
        ));
    }

    for (const ipcFailure of telemetry.ipcCalls.filter((entry) => entry.success === false).slice(0, 5)) {
        findings.push(runtimeFinding(
            'high',
            'IPC call failed',
            `${ipcFailure.channel}: ${ipcFailure.error || 'Unknown error'}`
        ));
    }

    for (const consoleError of actionableConsoleErrors.slice(0, 5)) {
        findings.push(runtimeFinding(
            'medium',
            'Console error captured during feature run',
            consoleError.text
        ));
    }

    return findings;
}

function scoreFeatureStatus(findings) {
    if (findings.some((finding) => finding.severity === 'critical')) return 'fail';
    if (findings.some((finding) => finding.severity === 'high' || finding.severity === 'medium')) return 'warn';
    return 'pass';
}

async function runFeatureAudit(definition) {
    const harness = await createHarness();
    const startedAt = Date.now();
    const telemetryMarker = harness.createTelemetryMarker();
    let scenarioResult = { evidence: [] };

    try {
        scenarioResult = await RUNTIME_SCENARIOS[definition.id](harness);
        await harness.assertNoFatalError();
        const telemetry = await harness.getTelemetrySince(telemetryMarker);
        const findings = collectRuntimeFindings(telemetry);
        return {
            id: definition.id,
            title: definition.title,
            intent: definition.intent,
            interfaces: definition.interfaces,
            entities: definition.entities,
            status: scoreFeatureStatus(findings),
            intentFulfilled: true,
            durationMs: Date.now() - startedAt,
            evidence: scenarioResult.evidence || [],
            findings,
            telemetry: summarizeTelemetry(telemetry),
            suggestions: definition.suggestions || []
        };
    } catch (error) {
        const telemetry = await harness.getTelemetrySince(telemetryMarker);
        const findings = [
            runtimeFinding(
                'critical',
                'Feature intent was not fulfilled',
                error && error.message ? error.message : String(error)
            ),
            ...collectRuntimeFindings(telemetry)
        ];
        return {
            id: definition.id,
            title: definition.title,
            intent: definition.intent,
            interfaces: definition.interfaces,
            entities: definition.entities,
            status: 'fail',
            intentFulfilled: false,
            durationMs: Date.now() - startedAt,
            evidence: scenarioResult.evidence || [],
            findings,
            telemetry: summarizeTelemetry(telemetry),
            suggestions: definition.suggestions || []
        };
    } finally {
        await harness.cleanup();
    }
}

function flattenSuggestions(runtimeAudits, staticFindings) {
    const suggestions = [];

    for (const audit of runtimeAudits) {
        for (const suggestion of audit.suggestions || []) {
            suggestions.push({
                source: audit.id,
                title: suggestion.title,
                type: suggestion.type,
                rationale: suggestion.rationale,
                impact: suggestion.impact,
                effort: suggestion.effort
            });
        }
    }

    if (staticFindings.some((finding) => finding.title.includes('raw SQL'))) {
        suggestions.push({
            source: 'static-audit',
            title: 'Domain-specific IPC boundary',
            type: 'Hardening',
            rationale: 'Replacing raw SQL IPC with explicit commands will reduce blast radius when future features expand the renderer surface.',
            impact: 'High',
            effort: 'Medium'
        });
    }

    if (staticFindings.some((finding) => finding.title.includes('sandbox'))) {
        suggestions.push({
            source: 'static-audit',
            title: 'Renderer sandbox re-enable plan',
            type: 'Hardening',
            rationale: 'A staged sandbox hardening plan will reduce security debt without blocking current feature work.',
            impact: 'High',
            effort: 'Medium'
        });
    }

    const unique = new Map();
    for (const suggestion of suggestions) {
        if (!unique.has(suggestion.title)) {
            unique.set(suggestion.title, suggestion);
        }
    }

    return Array.from(unique.values());
}

function buildSummary(runtimeAudits, staticFindings, suggestions) {
    const runtimeCounts = runtimeAudits.reduce((acc, audit) => {
        acc[audit.status] = (acc[audit.status] || 0) + 1;
        return acc;
    }, { pass: 0, warn: 0, fail: 0 });

    const severityCounts = staticFindings.reduce((acc, finding) => {
        acc[finding.severity] = (acc[finding.severity] || 0) + 1;
        return acc;
    }, { critical: 0, high: 0, medium: 0, low: 0 });

    return {
        runtime: {
            total: runtimeAudits.length,
            pass: runtimeCounts.pass || 0,
            warn: runtimeCounts.warn || 0,
            fail: runtimeCounts.fail || 0
        },
        staticFindings: {
            total: staticFindings.length,
            critical: severityCounts.critical || 0,
            high: severityCounts.high || 0,
            medium: severityCounts.medium || 0,
            low: severityCounts.low || 0
        },
        suggestions: suggestions.length
    };
}

function formatEvidence(evidence) {
    return (evidence || []).map((item) => `- ${item.label}: ${item.value}`).join('\n');
}

function formatFindings(findings) {
    if (!findings || findings.length === 0) return '- none';
    return findings
        .slice()
        .sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity])
        .map((finding) => `- [${finding.severity}] ${finding.title}: ${finding.summary}`)
        .join('\n');
}

function formatStaticFindings(findings) {
    if (findings.length === 0) return '- none';
    return findings.map((finding) => {
        const lineText = finding.line ? `:${finding.line}` : '';
        return `- [${finding.severity}] ${finding.title} (${finding.file}${lineText})\n  ${finding.summary}\n  Recommendation: ${finding.recommendation}`;
    }).join('\n');
}

function formatSuggestions(suggestions) {
    if (suggestions.length === 0) return '- none';
    return suggestions.map((suggestion) => {
        return `- ${suggestion.title} [${suggestion.type}, impact ${suggestion.impact}, effort ${suggestion.effort}]\n  ${suggestion.rationale}`;
    }).join('\n');
}

function createMarkdownReport(report) {
    const runtimeSections = report.runtimeAudits.map((audit) => {
        return `## ${audit.title}

- Status: ${audit.status.toUpperCase()}
- Intent fulfilled: ${audit.intentFulfilled ? 'yes' : 'no'}
- Intent: ${audit.intent}
- Interfaces: ${audit.interfaces.join(', ')}
- Entities: ${audit.entities.join(', ')}
- Duration: ${audit.durationMs} ms

Evidence
${formatEvidence(audit.evidence)}

Findings
${formatFindings(audit.findings)}
`;
    }).join('\n');

    return `# Al Ghanim Nexus Deep Audit Report

Generated at: ${report.generatedAt}

## Summary

- Runtime audits: ${report.summary.runtime.total}
- Runtime pass/warn/fail: ${report.summary.runtime.pass}/${report.summary.runtime.warn}/${report.summary.runtime.fail}
- Static findings: ${report.summary.staticFindings.total}
- Static high severity findings: ${report.summary.staticFindings.critical + report.summary.staticFindings.high}
- Suggestions: ${report.summary.suggestions}

## Runtime Audits

${runtimeSections}
## Static Findings

${formatStaticFindings(report.staticFindings)}

## Suggested Improvements

${formatSuggestions(report.suggestions)}
`;
}

async function writeReportFiles(projectRoot, report) {
    const reportDir = path.join(projectRoot, 'tools', 'headless', 'reports');
    fs.mkdirSync(reportDir, { recursive: true });

    const jsonPath = path.join(reportDir, 'latest-audit.json');
    const markdownPath = path.join(reportDir, 'latest-audit.md');

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(markdownPath, createMarkdownReport(report));

    return {
        jsonPath,
        markdownPath
    };
}

async function runDeepAudit(projectRoot = path.resolve(__dirname, '..', '..', '..')) {
    const runtimeAudits = [];

    for (const definition of FEATURE_AUDITS) {
        runtimeAudits.push(await runFeatureAudit(definition));
    }

    const staticFindings = collectStaticAudit(projectRoot);
    const suggestions = flattenSuggestions(runtimeAudits, staticFindings);
    const summary = buildSummary(runtimeAudits, staticFindings, suggestions);
    const report = {
        generatedAt: new Date().toISOString(),
        summary,
        runtimeAudits,
        staticFindings,
        suggestions
    };
    const reportPaths = await writeReportFiles(projectRoot, report);

    return {
        ...report,
        reportPaths
    };
}

module.exports = {
    runDeepAudit
};
