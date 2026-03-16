#!/usr/bin/env node
/**
 * start.js — Electron launcher
 * 
 * Spawns the Electron binary directly, bypassing the npm 'electron' cli.js.
 * Uses NODE_PATH trick to make Electron's built-in 'electron' module take priority.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const electronExe = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe');

if (!fs.existsSync(electronExe)) {
    console.error('Electron not found at:', electronExe);
    console.error('Run: npm install');
    process.exit(1);
}

// Use --no-node-snapshot to avoid stale snapshots and
// set NODE_PATH to empty to prevent extra resolution paths
// Build clean env: remove ELECTRON_RUN_AS_NODE entirely to ensure Electron mode
const cleanEnv = { ...process.env };
delete cleanEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronExe, ['.'], {
    stdio: 'inherit',
    windowsHide: false,
    cwd: __dirname,
    env: cleanEnv
});

child.on('close', (code) => process.exit(code || 0));
child.on('error', (err) => {
    console.error('Failed to start Electron:', err.message);
    console.error('Run: npm install');
    process.exit(1);
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
