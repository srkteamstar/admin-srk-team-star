const path = require('path');
const { spawnSync } = require('child_process');
const { buildPublic } = require('./build-vercel-public');

const backend = path.resolve(__dirname, '../backend');
buildPublic();
const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli', { paths: [backend] }), 'test'], {
    cwd: backend,
    env: { ...process.env, SRK_TEST_BUILT_ASSETS: '1' },
    windowsHide: true,
    stdio: 'inherit'
});
if (result.error) throw result.error;
process.exit(result.status === null ? 1 : result.status);
