#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const deliveryDir = path.join(projectRoot, 'NEXUS DELIVERY');
const artifactPrefix = 'Nexus-Setup-';
const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
);

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function clearGeneratedInstallers(directoryPath) {
  if (!fs.existsSync(directoryPath)) return;

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(artifactPrefix) || path.extname(entry.name).toLowerCase() !== '.exe') {
      continue;
    }
    fs.unlinkSync(path.join(directoryPath, entry.name));
  }
}

function collectInstallers() {
  if (!fs.existsSync(distDir)) {
    throw new Error('dist folder was not found. Build the app before creating the delivery folder.');
  }

  const installers = fs.readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(artifactPrefix) && path.extname(name).toLowerCase() === '.exe')
    .sort((left, right) => left.localeCompare(right));

  const universalName = `Nexus-Setup-${packageJson.version}.exe`;
  if (installers.includes(universalName)) {
    return [universalName];
  }

  return installers;
}

function main() {
  const installers = collectInstallers();
  if (installers.length === 0) {
    throw new Error('No Windows installer executables were found in dist.');
  }

  ensureDirectory(deliveryDir);
  clearGeneratedInstallers(deliveryDir);

  for (const installerName of installers) {
    const sourcePath = path.join(distDir, installerName);
    const targetPath = path.join(deliveryDir, installerName);
    fs.copyFileSync(sourcePath, targetPath);
    console.log(`Copied: ${path.relative(projectRoot, targetPath)}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
