const path = require('path');
const { runDeepAudit } = require('../lib/deep-audit');

async function main() {
    const projectRoot = path.resolve(__dirname, '..', '..', '..');
    const report = await runDeepAudit(projectRoot);

    console.log('Nexus deep audit completed.');
    console.log(`Runtime audits: ${report.summary.runtime.total} (pass ${report.summary.runtime.pass}, warn ${report.summary.runtime.warn}, fail ${report.summary.runtime.fail})`);
    console.log(`Static findings: ${report.summary.staticFindings.total}`);
    console.log(`Suggestions: ${report.summary.suggestions}`);
    console.log(`Markdown report: ${report.reportPaths.markdownPath}`);
    console.log(`JSON report: ${report.reportPaths.jsonPath}`);

    if (report.summary.runtime.fail > 0) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
