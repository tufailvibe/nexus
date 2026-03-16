const fs = require('fs');
const path = require('path');
const http = require('http');

const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.wasm': 'application/wasm'
};

function startStaticServer(rootDir) {
    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        const relativePath = decodeURIComponent(url.pathname === '/' ? '/src/index.html' : url.pathname);
        const normalizedPath = path.normalize(relativePath).replace(/^([/\\])+/, '');
        const filePath = path.join(rootDir, normalizedPath);

        if (!filePath.startsWith(rootDir)) {
            response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Forbidden');
            return;
        }

        fs.stat(filePath, (error, stats) => {
            if (error || !stats.isFile()) {
                response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                response.end('Not Found');
                return;
            }

            const ext = path.extname(filePath).toLowerCase();
            response.writeHead(200, {
                'Cache-Control': 'no-store',
                'Content-Type': MIME_TYPES[ext] || 'application/octet-stream'
            });

            const stream = fs.createReadStream(filePath);
            stream.pipe(response);
            stream.on('error', () => {
                if (!response.headersSent) {
                    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                }
                response.end('Failed to read file');
            });
        });
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({
                origin: `http://127.0.0.1:${address.port}`,
                close: () => new Promise((done, fail) => server.close(err => (err ? fail(err) : done())))
            });
        });
    });
}

module.exports = {
    startStaticServer
};
