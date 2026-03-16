const fs = require('fs');
const path = require('path');

const SEVERITY_ORDER = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3
};

function buildFinding(input) {
    return {
        category: input.category || 'maintainability',
        severity: input.severity || 'medium',
        title: input.title,
        summary: input.summary,
        recommendation: input.recommendation || '',
        file: input.file || '',
        line: input.line || null
    };
}

function lineNumberForIndex(content, index) {
    if (index < 0) return null;
    return content.slice(0, index).split(/\r?\n/).length;
}

function lineNumberForPattern(content, pattern) {
    const index = typeof pattern === 'string'
        ? content.indexOf(pattern)
        : (() => {
            const match = content.match(pattern);
            return match ? match.index : -1;
        })();
    return lineNumberForIndex(content, index);
}

function collectJsFiles(projectRoot) {
    const rendererDir = path.join(projectRoot, 'src', 'js');
    const files = [];

    if (fs.existsSync(rendererDir)) {
        for (const entry of fs.readdirSync(rendererDir, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.endsWith('.js')) {
                files.push(path.join(rendererDir, entry.name));
            }
        }
    }

    files.push(path.join(projectRoot, 'app-main', 'main.js'));
    return files.filter((filePath) => fs.existsSync(filePath));
}

function scanDuplicateFunctions(filePath, content) {
    const findings = [];
    const occurrences = new Map();

    for (const match of content.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
        const functionName = match[1];
        const lines = occurrences.get(functionName) || [];
        lines.push(lineNumberForIndex(content, match.index));
        occurrences.set(functionName, lines);
    }

    for (const [functionName, lines] of occurrences.entries()) {
        if (lines.length < 2) continue;
        findings.push(buildFinding({
            category: 'maintainability',
            severity: 'medium',
            title: `Duplicate function definition: ${functionName}()`,
            summary: `The same function name appears ${lines.length} times in one file, which makes behavior easier to shadow accidentally during refactors.`,
            recommendation: 'Collapse duplicate implementations into one source of truth before adding more feature logic around it.',
            file: filePath,
            line: lines[1]
        }));
    }

    return findings;
}

function scanInlineEventHandlers(filePath, content) {
    const inlineAttributeMatches = [...content.matchAll(/<[^>]+\son[a-z]+\s*=/gi)];
    const directPropertyMatches = [...content.matchAll(/\.\s*on[a-z]+\s*=\s*(?![=])/gi)];
    const matches = [...inlineAttributeMatches, ...directPropertyMatches]
        .sort((left, right) => left.index - right.index);
    if (matches.length === 0) return [];

    return [buildFinding({
        category: 'security',
        severity: 'medium',
        title: 'Inline DOM handlers or direct on* assignments found',
        summary: `Found ${matches.length} inline handler attribute or direct on* assignment references. These are harder to audit, easier to misuse in HTML strings, and make UI behavior less testable.`,
        recommendation: 'Move handler wiring to delegated or scoped addEventListener bindings after render.',
        file: filePath,
        line: lineNumberForIndex(content, matches[0].index)
    })];
}

function scanLargeModules(filePath, content) {
    const lineCount = content.split(/\r?\n/).length;
    if (lineCount < 900) return [];

    return [buildFinding({
        category: 'architecture',
        severity: lineCount >= 1300 ? 'high' : 'medium',
        title: 'Large module with high change surface',
        summary: `This file is ${lineCount} lines long, which increases regression risk when unrelated features are changed together.`,
        recommendation: 'Split the module by workflow or responsibility before further feature expansion.',
        file: filePath,
        line: 1
    })];
}

function scanElectronSecurity(filePath, content) {
    const findings = [];
    const sandboxMatches = [...content.matchAll(/sandbox\s*:\s*false/g)];
    if (sandboxMatches.length > 0) {
        findings.push(buildFinding({
            category: 'security',
            severity: 'high',
            title: 'Electron renderer sandbox is disabled',
            summary: `Found ${sandboxMatches.length} BrowserWindow configuration entries with sandbox disabled. That weakens renderer isolation if future code changes expand IPC exposure.`,
            recommendation: 'Re-enable sandbox where possible and explicitly narrow the preload/API surface first.',
            file: filePath,
            line: lineNumberForIndex(content, sandboxMatches[0].index)
        }));
    }

    if (/ipcMain\.handle\('db-run',\s*async\s*\(_event,\s*sql/i.test(content)
        && /ipcMain\.handle\('db-get',\s*async\s*\(_event,\s*sql/i.test(content)) {
        findings.push(buildFinding({
            category: 'security',
            severity: 'high',
            title: 'Renderer can issue raw SQL over IPC',
            summary: 'The renderer currently sends SQL strings directly into main-process handlers. Verb restrictions help, but the trust boundary is still very broad.',
            recommendation: 'Replace raw SQL IPC with explicit domain-level commands for products, documents, settings, and backups.',
            file: filePath,
            line: lineNumberForPattern(content, "ipcMain.handle('db-run'")
        }));
    }

    return findings;
}

function collectStaticAudit(projectRoot) {
    const findings = [];
    const files = collectJsFiles(projectRoot);

    for (const filePath of files) {
        const content = fs.readFileSync(filePath, 'utf8');
        findings.push(...scanDuplicateFunctions(filePath, content));
        findings.push(...scanInlineEventHandlers(filePath, content));
        findings.push(...scanLargeModules(filePath, content));

        if (filePath.endsWith(path.join('app-main', 'main.js'))) {
            findings.push(...scanElectronSecurity(filePath, content));
        }
    }

    return findings.sort((left, right) => {
        const severityDiff = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
        if (severityDiff !== 0) return severityDiff;
        return (left.file || '').localeCompare(right.file || '');
    });
}

module.exports = {
    collectStaticAudit
};
