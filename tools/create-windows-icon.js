const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  const candidates = [
    path.join(__dirname, 'headless', 'node_modules', 'playwright-core'),
    'playwright-core'
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) { }
  }

  throw new Error('playwright-core is not available. Install tools/headless dependencies first.');
}

const { chromium } = loadPlaywright();

const BROWSER_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);

const ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const ASSET_DIR = path.join(ROOT, 'src', 'assets');
const ICO_OUTPUT = path.join(BUILD_DIR, 'icon.ico');
const PNG_OUTPUT = path.join(ASSET_DIR, 'app-icon.png');
const SIZES = [256, 128, 64, 48, 32, 16];

function findBrowserExecutable() {
  for (const candidate of BROWSER_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('No supported Chromium browser was found for icon generation.');
}

function iconMarkup() {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        background: transparent;
        overflow: hidden;
      }

      body {
        display: grid;
        place-items: center;
      }

      svg {
        width: 100%;
        height: 100%;
        display: block;
      }
    </style>
  </head>
  <body>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-label="Nexus icon">
      <defs>
        <linearGradient id="icon-bg" x1="28" y1="18" x2="220" y2="236" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#1d4ca8"/>
          <stop offset="100%" stop-color="#102756"/>
        </linearGradient>
      </defs>

      <rect x="16" y="16" width="224" height="224" rx="56" fill="url(#icon-bg)"/>

      <g transform="translate(128 128) scale(1.08)">
        <path fill="#ffffff" d="M -10 -94.04 L -34 -94.04 A 100 100 0 0 0 -34 94.04 L -24 94.04 L -10 80.04 L -10 12 L -46 12 L -46 38.52 A 60 60 0 0 1 -10 -59.16 Z"/>
        <path fill="#ffffff" d="M 10 94.04 L 34 94.04 A 100 100 0 0 0 34 -94.04 L 24 -94.04 L 10 -80.04 L 10 -12 L 46 -12 L 46 -38.52 A 60 60 0 0 1 10 59.16 Z"/>
      </g>
    </svg>
  </body>
</html>`;
}

function buildIco(pngImages) {
  const header = Buffer.alloc(6 + (16 * pngImages.length));
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngImages.length, 4);

  let offset = header.length;
  pngImages.forEach(({ size, buffer }, index) => {
    const entryOffset = 6 + (index * 16);
    header.writeUInt8(size === 256 ? 0 : size, entryOffset);
    header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(buffer.length, entryOffset + 8);
    header.writeUInt32LE(offset, entryOffset + 12);
    offset += buffer.length;
  });

  return Buffer.concat([header, ...pngImages.map(({ buffer }) => buffer)]);
}

async function renderPng(browser, size) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1
  });

  try {
    await page.setContent(iconMarkup(), { waitUntil: 'load' });
    return await page.screenshot({
      type: 'png',
      omitBackground: true
    });
  } finally {
    await page.close();
  }
}

async function main() {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.mkdirSync(ASSET_DIR, { recursive: true });

  const browser = await chromium.launch({
    executablePath: findBrowserExecutable(),
    headless: true,
    args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check']
  });

  try {
    const pngImages = [];
    for (const size of SIZES) {
      const buffer = await renderPng(browser, size);
      pngImages.push({ size, buffer });
      if (size === 256) {
        fs.writeFileSync(PNG_OUTPUT, buffer);
      }
    }

    fs.writeFileSync(ICO_OUTPUT, buildIco(pngImages));
  } finally {
    await browser.close();
  }

  console.log(`Wrote ${ICO_OUTPUT}`);
  console.log(`Wrote ${PNG_OUTPUT}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
