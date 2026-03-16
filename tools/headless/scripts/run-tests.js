const { spawn } = require('child_process');

const extraArgs = process.argv.slice(2);
const args = ['--test', ...extraArgs];

const child = spawn(process.execPath, args, {
    cwd: require('path').join(__dirname, '..'),
    stdio: 'inherit',
    env: process.env
});

child.on('exit', code => process.exit(code || 0));
child.on('error', error => {
    console.error(error);
    process.exit(1);
});
