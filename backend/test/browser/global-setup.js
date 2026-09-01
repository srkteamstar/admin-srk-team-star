const { spawn } = require('child_process');
const path = require('path');

module.exports = async function globalSetup() {
    const harness = process.env.SRK_TEST_BUILT_ASSETS === '1'
        ? path.join(__dirname, 'built-assets-harness.js')
        : path.join(__dirname, '..', 'authz-harness.js');
    const server = spawn(process.execPath, [harness], {
        env: Object.assign({}, process.env, { HARNESS_PORT: '3557' }),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    const output = [];
    server.stdout.on('data', chunk => output.push(String(chunk)));
    server.stderr.on('data', chunk => output.push(String(chunk)));

    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        if (server.exitCode !== null) {
            throw new Error('Browser harness exited during startup:\n' + output.join(''));
        }
        try {
            const response = await fetch('http://127.0.0.1:3557/');
            if (response.ok) {
                return async () => {
                    if (!server.killed) server.kill();
                };
            }
        } catch (error) {}
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    if (!server.killed) server.kill();
    throw new Error('Browser harness did not start in 20 seconds:\n' + output.join(''));
};
