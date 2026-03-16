#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
);
const distDir = path.join(projectRoot, 'dist');
const rceditPath = path.join(
  projectRoot,
  'node_modules',
  'electron-winstaller',
  'vendor',
  'rcedit.exe'
);

function toWindowsVersion(version) {
  const parts = String(version || '1.0.0')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));

  while (parts.length < 4) {
    parts.push(0);
  }

  return parts.slice(0, 4).join('.');
}

function collectExeTargets() {
  const targets = new Set();
  if (!fs.existsSync(distDir)) return [];

  const productName = packageJson.build?.productName || packageJson.productName || packageJson.name;
  const unpackedDirNames = ['win-unpacked', 'win-ia32-unpacked', 'win-arm64-unpacked'];

  for (const dirName of unpackedDirNames) {
    const unpackedExePath = path.join(distDir, dirName, `${productName}.exe`);
    if (fs.existsSync(unpackedExePath)) {
      targets.add(unpackedExePath);
    }
  }

  return Array.from(targets);
}

function stampExecutable(exePath, metadata) {
  const exeName = path.basename(exePath);
  const internalName = path.basename(exePath, path.extname(exePath));
  const fileDescription = /setup/i.test(exeName)
    ? `${metadata.productName} Setup`
    : metadata.productName;

  const args = [
    exePath,
    '--set-version-string', 'ProductName', metadata.productName,
    '--set-version-string', 'FileDescription', fileDescription,
    '--set-version-string', 'CompanyName', metadata.companyName,
    '--set-version-string', 'LegalCopyright', metadata.legalCopyright,
    '--set-version-string', 'OriginalFilename', exeName,
    '--set-version-string', 'InternalName', internalName,
    '--set-file-version', metadata.version,
    '--set-product-version', metadata.version
  ];

  const result = spawnSync(rceditPath, args, {
    cwd: projectRoot,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    throw new Error(`rcedit failed for ${exeName} with exit code ${result.status || 1}.`);
  }
}

function main() {
  if (!fs.existsSync(rceditPath)) {
    throw new Error(`rcedit.exe was not found at ${rceditPath}`);
  }

  const targets = collectExeTargets();
  if (targets.length === 0) {
    console.log('No Windows executables found in dist. Skipping metadata stamp.');
    return;
  }

  const metadata = {
    productName: packageJson.build?.productName || packageJson.productName || packageJson.name,
    companyName: 'Private Deployment',
    legalCopyright: packageJson.build?.copyright || 'Copyright (C) 2026. All rights reserved.',
    version: toWindowsVersion(packageJson.version)
  };

  for (const exePath of targets) {
    stampExecutable(exePath, metadata);
    console.log(`Stamped metadata: ${path.relative(projectRoot, exePath)}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
